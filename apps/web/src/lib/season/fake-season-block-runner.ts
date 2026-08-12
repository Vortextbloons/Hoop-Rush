import {
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  blockIndexForRound,
  blockRoundRange,
  seasonDigestHex,
  type SeasonBlockRecap,
  type SeasonCandidateCheckpoint,
  type SeasonCheckpointState,
  type SeasonCompactPlayerLine,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonPlayerAggregate,
  type SeasonScoreline,
  type SeasonStandings,
  type SeasonTeamAggregate,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import {
  seasonRunEngineSeam,
  type SeasonRunSnapshot,
  type SeasonWindowOpenResult,
} from '@hoop-rush/persistence';
import { completeSeasonBlockCommit } from '@hoop-rush/engine';
import { assembleCommittedSnapshot } from '$lib/season/season-block-runner';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from '$lib/season/season-block-runner';
import { getSeasonRunRepository } from '$lib/season/season-repo';
import { gamesToLockForBlock } from '$lib/season/season-lock-preview';

/**
 * TEST-ONLY deterministic fake `SeasonBlockRunner` (e2e seam). The lead's
 * real runner is not required for e2e journeys: this fake simulates a block
 * through the frozen runner interface, streams progress events, and commits
 * the accepted checkpoint through the repository using the AUTHORITATIVE
 * engine seam folds (`seasonRunEngineSeam`), so reload validation and the
 * reconciliation audit pass exactly like a real checkpoint.
 *
 * Activation: the e2e spec sets `window.__HOOP_RUSH_E2E_FAKE_RUNNER__` before
 * navigation; `getSeasonBlockRunner()` then returns this fake. The fake is
 * never used in production.
 *
 * M2.5: the fake writes deterministic health (one active injury + one
 * returned injury with an open recurrence window for the human team),
 * Influence (initial +2 grant and +1 per accepted block for all 30
 * franchises), and grant transactions into every committed checkpoint, so
 * the health strip and the Influence panel render recorded facts. A window
 * flag (`__HOOP_RUSH_E2E_INTERRUPT_ONCE__`) makes the next `startBlock` emit
 * one typed `invalid-roster` interruption with a persisted pending
 * candidate; `resumeBlock` loads the pending candidate, simulates the
 * remaining games, and commits the full block atomically.
 */

const PROGRESS_STEP_MS = 40;
const GAMES_PER_STEP = 15;

function deterministicPoints(gameId: string, base: number): number {
  let hash = 0;
  for (let i = 0; i < gameId.length; i += 1) {
    hash = (hash * 31 + gameId.charCodeAt(i)) >>> 0;
  }
  return base + (hash % 41);
}

/** Deterministic non-tied scores (the engine rejects tied finals). */
function deterministicScores(gameId: string): { homeScore: number; awayScore: number } {
  const homeScore = deterministicPoints(gameId, 100);
  const awayScore = deterministicPoints(`${gameId}x`, 95);
  return homeScore === awayScore
    ? { homeScore, awayScore: awayScore + 1 }
    : { homeScore, awayScore };
}

function emptyLine(playerVersionId: string): SeasonCompactPlayerLine {
  return {
    playerVersionId,
    seconds: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

declare global {
  interface Window {
    /** e2e: when true, the fake stalls the first startBlock until cancelled. */
    __HOOP_RUSH_E2E_STALL_ONCE__?: boolean;
    /** e2e: when true, the next startBlock emits one typed interruption. */
    __HOOP_RUSH_E2E_INTERRUPT_ONCE__?: boolean;
  }
}

/** M2.5 commit extras for the fake (the full commit input is typed against
 * the landed `CommitSeasonBlockInput`; these are the engine-derived facts). */
interface FakeM25CommitInput {
  health: SeasonHealthState;
  transactions: SeasonTransactionEntry[];
  influence: SeasonInfluenceState;
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  window: SeasonWindowOpenResult | null;
}

export class FakeSeasonBlockRunner implements SeasonBlockRunner {
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private cancelled = false;
  private currentBlockIndex: number | null = null;
  private stallingRequestId: string | null = null;
  /** The last submitted start input (resume re-uses its identity facts). */
  private lastStartInput: SeasonBlockStartInput | null = null;

  startBlock(input: SeasonBlockStartInput): string {
    const requestId = `fake-${input.commandId}`;
    this.cancelled = false;
    this.currentBlockIndex = input.blockIndex;
    this.lastStartInput = input;
    this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });

    // e2e cancel/retry seam: the first startBlock stalls between games until
    // cancelled; the retry then runs to completion.
    if (typeof window !== 'undefined' && window.__HOOP_RUSH_E2E_STALL_ONCE__) {
      window.__HOOP_RUSH_E2E_STALL_ONCE__ = false;
      this.stallingRequestId = requestId;
      this.emit({
        type: 'progress',
        requestId,
        blockIndex: input.blockIndex,
        gamesCompleted: 0,
        gamesTotal: 150,
        latestGameId: null,
        latestResult: null,
      });
      return requestId;
    }

    // e2e interruption seam: the next startBlock stops before any game with
    // one typed invalid-roster interruption (persisted pending candidate).
    if (typeof window !== 'undefined' && window.__HOOP_RUSH_E2E_INTERRUPT_ONCE__) {
      window.__HOOP_RUSH_E2E_INTERRUPT_ONCE__ = false;
      void this.interrupt(requestId, input);
      return requestId;
    }

    const { fromRound, toRound } = blockRoundRange(input.blockIndex);
    const blockGames = input.run.games.filter(
      (game) => game.round >= fromRound && game.round <= toRound,
    );
    const gamesTotal = blockGames.length;
    let completed = 0;

    const tick = () => {
      if (this.cancelled) return;
      try {
        const done = Math.min(completed + GAMES_PER_STEP, gamesTotal);
        const latest = blockGames[done - 1];
        const latestResult = latest
          ? this.scorelineFor(latest.gameId, latest.homeFranchiseId, latest.awayFranchiseId)
          : null;
        completed = done;
        this.emit({
          type: 'progress',
          requestId,
          blockIndex: input.blockIndex,
          gamesCompleted: completed,
          gamesTotal,
          latestGameId: latest?.gameId ?? null,
          latestResult,
        });
        if (completed >= gamesTotal) {
          void this.complete(input, requestId);
        } else {
          this.timers.add(setTimeout(tick, PROGRESS_STEP_MS));
        }
      } catch (error) {
        this.emit({
          type: 'error',
          requestId,
          blockIndex: input.blockIndex,
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          seed: input.run.rootSeed,
          gameId: null,
        });
      }
    };
    this.timers.add(setTimeout(tick, PROGRESS_STEP_MS));
    return requestId;
  }

  /**
   * M2.5 frozen runner extension: resumes an interrupted block from its
   * persisted pending candidate, simulates the remaining games, and commits
   * the full block atomically (the commit deletes the pending row).
   * Returns the request id for cancel/terminate routing.
   */
  resumeBlock(input: SeasonBlockResumeInput): string {
    const requestId = `fake-resume-${input.commandId}`;
    if (this.cancelled) return requestId;
    this.cancelled = false;
    this.currentBlockIndex = input.blockIndex;
    void (async () => {
      try {
        const repo = await getSeasonRunRepository();
        const pending = await repo.loadPendingBlock(input.runId);
        if (pending === null) throw new Error('no pending block to resume');
        if (pending.blockIndex !== input.blockIndex) throw new Error('pending block mismatch');
        if (pending.expectedRevision !== input.expectedRevision) {
          throw new Error('pending expectedRevision mismatch');
        }
        if (pending.rotationDigest !== input.rotationDigest) {
          throw new Error('pending rotation digest mismatch');
        }
        const snapshot = await repo.loadActiveRun();
        const run = snapshot?.run ?? this.lastStartInput?.run;
        if (run === undefined) throw new Error('no active run to resume');
        const startInput: SeasonBlockStartInput = {
          run,
          effects: snapshot?.effects ??
            this.lastStartInput?.effects ?? {
              schemaVersion: 1,
              playerStates: [],
              pairStates: [],
            },
          rotations: input.rotations,
          blockIndex: input.blockIndex,
          expectedRevision: input.expectedRevision,
          rotationDigest: input.rotationDigest,
          commandId: input.commandId,
          humanFranchiseId: input.humanFranchiseId,
          objectiveId: pending.objectiveId,
          homeCourt: input.homeCourt,
          catalogUrl: input.catalogUrl,
          catalogHash: input.catalogHash,
          profileUrl: input.profileUrl,
          profileHash: input.profileHash,
        };
        this.lastStartInput = startInput;
        this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });
        const { fromRound, toRound } = blockRoundRange(input.blockIndex);
        const blockGames = run.games
          .filter((game) => game.round >= fromRound && game.round <= toRound)
          .sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
        const remaining = blockGames.filter((game) => game.gameId >= pending.nextGameId);
        const newSummaries = remaining.map((game) =>
          this.summaryFor(
            startInput,
            game.gameId,
            game.round,
            game.homeFranchiseId,
            game.awayFranchiseId,
          ),
        );
        const summaries = [...pending.summaries, ...newSummaries];
        const checkpoint = await this.buildCheckpoint(
          startInput,
          summaries,
          pending.health,
          pending.effects,
        );
        if (this.cancelled) return;
        const committed = this.committedFacts(startInput, checkpoint, pending.commandId);
        await this.commitCheckpoint(startInput, pending.commandId, checkpoint, {
          health: pending.health,
          influence: this.fakeInfluenceFor(startInput, input.blockIndex),
          transactions: this.fakeTransactionsFor(input.blockIndex),
          checkpointState: committed.checkpointState,
          stateRevision: committed.stateRevision,
          stateDigest: committed.stateDigest,
          window: committed.window,
        });
        const committedView = await this.committedSnapshot(
          startInput,
          checkpoint,
          pending.commandId,
          committed,
        );
        this.emit({ type: 'complete', requestId, checkpoint, snapshot: committedView });
      } catch (error) {
        if (this.isCancelled()) return;
        this.emit({
          type: 'error',
          requestId,
          blockIndex: input.blockIndex,
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          seed: null,
          gameId: null,
        });
      }
    })();
    return requestId;
  }

  cancel(requestId: string): void {
    this.cancelled = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.emit({ type: 'cancelled', requestId, blockIndex: this.currentBlockIndex ?? 0 });
  }

  terminate(): void {
    this.cancelled = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  /** Performance pass: the fake needs no packaged asset prewarm. */
  prewarm(): void {
    // no-op (test seam; the fake never fetches packaged assets)
  }

  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SeasonRunnerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private isCancelled(): boolean {
    return this.cancelled;
  }

  /** M2.5: emits one typed interruption and persists the pending candidate. */
  private async interrupt(requestId: string, input: SeasonBlockStartInput): Promise<void> {
    const pending = await this.buildPending(input);
    const repo = await getSeasonRunRepository();
    const humanRotation =
      input.rotations.find((rotation) => rotation.franchiseId === input.humanFranchiseId) ?? null;
    const interruption: SeasonInvalidRosterInterruption = {
      code: 'invalid-roster',
      runId: input.run.runId,
      blockIndex: input.blockIndex,
      commandId: pending.commandId,
      nextGameId: pending.nextGameId,
      humanFranchiseId: input.humanFranchiseId ?? '',
      unavailablePlayerVersionIds: [...(humanRotation?.starters ?? [])],
    };
    await repo.savePendingBlock(pending, interruption);
    this.emit({
      type: 'interrupted',
      requestId,
      runId: input.run.runId,
      blockIndex: input.blockIndex,
      pending,
      interruption,
    });
  }

  private async buildPending(input: SeasonBlockStartInput): Promise<SeasonPendingBlockCandidate> {
    const { fromRound, toRound } = blockRoundRange(input.blockIndex);
    const blockGames = input.run.games
      .filter((game) => game.round >= fromRound && game.round <= toRound)
      .sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
    const nextHumanGame =
      blockGames.find(
        (game) =>
          game.homeFranchiseId === input.humanFranchiseId ||
          game.awayFranchiseId === input.humanFranchiseId,
      ) ?? blockGames[0];
    const schedule = this.scheduleOf(input);
    const current = await loadCurrentSnapshot(schedule);
    const allSummaries = current?.summaries ?? [];
    const played = seasonRunEngineSeam
      .reconstructSeasonGames(schedule, allSummaries)
      .filter((game) => game.status !== 'scheduled');
    return {
      schemaVersion: 1,
      blockVersion: SEASON_BLOCK_VERSION,
      runId: input.run.runId,
      commandId: input.commandId,
      blockIndex: input.blockIndex,
      expectedRevision: input.expectedRevision,
      expectedStateRevision: input.run.stateRevision,
      expectedStateDigest: input.run.stateDigest,
      objectiveId: null,
      nextGameId: nextHumanGame?.gameId ?? 's000001',
      summaries: [],
      retainedDetails: [],
      effects: seasonRunEngineSeam.zeroSeasonEffectsState(input.run.rosters),
      health: this.interruptionHealthFor(input),
      standings: seasonRunEngineSeam.reduceSeasonStandings(input.run.league, played),
      teamAggregates: seasonRunEngineSeam.foldSeasonTeamAggregates(input.run.league, allSummaries),
      playerAggregates: seasonRunEngineSeam.foldSeasonPlayerAggregates(
        input.run.rosters,
        allSummaries,
      ),
      rotationDigest: input.rotationDigest,
    };
  }

  private scorelineFor(
    gameId: string,
    homeFranchiseId: string,
    awayFranchiseId: string,
  ): SeasonScoreline {
    const { homeScore, awayScore } = deterministicScores(gameId);
    return { gameId, homeFranchiseId, homeScore, awayScore, awayFranchiseId };
  }

  private summaryFor(
    input: SeasonBlockStartInput,
    gameId: string,
    round: number,
    homeFranchiseId: string,
    awayFranchiseId: string,
  ): SeasonGameSummary {
    const { homeScore, awayScore } = deterministicScores(gameId);
    const homeRoster =
      input.run.rosters.find((roster) => roster.franchiseId === homeFranchiseId)?.players ?? [];
    const awayRoster =
      input.run.rosters.find((roster) => roster.franchiseId === awayFranchiseId)?.players ?? [];
    const lines = (roster: typeof homeRoster, score: number): SeasonCompactPlayerLine[] => {
      const ten = roster.slice(0, 10).map((entry) => entry.playerVersionId);
      const withPoints = ten.map((playerVersionId, index) => {
        const line = emptyLine(playerVersionId);
        line.seconds = 20 * 60 + index * 45;
        line.points = index === 0 ? score - 20 : 8 + ((index * 5 + score) % 14);
        return line;
      });
      return withPoints;
    };
    return {
      schemaVersion: 1,
      summaryVersion: SEASON_GAME_SUMMARY_VERSION,
      gameId,
      round,
      homeFranchiseId,
      awayFranchiseId,
      status: 'final',
      overtimePeriods: 0,
      homeScore,
      awayScore,
      forfeitLoserFranchiseId: null,
      homeBox: {
        franchiseId: homeFranchiseId,
        points: homeScore,
        fieldGoalsMade: 40,
        fieldGoalsAttempted: 88,
        threePointersMade: 10,
        threePointersAttempted: 30,
        freeThrowsMade: 20,
        freeThrowsAttempted: 26,
        offensiveRebounds: 10,
        defensiveRebounds: 30,
        assists: 24,
        steals: 7,
        blocks: 5,
        turnovers: 13,
        fouls: 19,
        possessions: 96,
      },
      awayBox: {
        franchiseId: awayFranchiseId,
        points: awayScore,
        fieldGoalsMade: 38,
        fieldGoalsAttempted: 86,
        threePointersMade: 9,
        threePointersAttempted: 28,
        freeThrowsMade: 19,
        freeThrowsAttempted: 25,
        offensiveRebounds: 9,
        defensiveRebounds: 29,
        assists: 22,
        steals: 8,
        blocks: 4,
        turnovers: 15,
        fouls: 21,
        possessions: 94,
      },
      homePlayers: lines(homeRoster, homeScore),
      awayPlayers: lines(awayRoster, awayScore),
      injuryEvents: [],
    };
  }

  private async complete(input: SeasonBlockStartInput, requestId: string): Promise<void> {
    if (this.cancelled) return;
    const { fromRound, toRound } = blockRoundRange(input.blockIndex);
    const blockGames = input.run.games.filter(
      (game) => game.round >= fromRound && game.round <= toRound,
    );
    const summaries: SeasonGameSummary[] = blockGames.map((game) =>
      this.summaryFor(input, game.gameId, game.round, game.homeFranchiseId, game.awayFranchiseId),
    );
    const checkpoint = await this.buildCheckpoint(
      input,
      summaries,
      this.fakeHealthFor(input),
      null,
    );
    let committed: {
      checkpointState: SeasonCheckpointState;
      stateRevision: number;
      stateDigest: string;
      window: SeasonWindowOpenResult | null;
    } | null = null;
    try {
      committed = this.committedFacts(input, checkpoint, input.commandId);
      await this.commitCheckpoint(input, input.commandId, checkpoint, {
        health: this.fakeHealthFor(input),
        influence: this.fakeInfluenceFor(input, input.blockIndex),
        transactions: this.fakeTransactionsFor(input.blockIndex),
        checkpointState: committed.checkpointState,
        stateRevision: committed.stateRevision,
        stateDigest: committed.stateDigest,
        window: committed.window,
      });
    } catch (error) {
      if (this.isCancelled()) return;
      this.emit({
        type: 'error',
        requestId,
        blockIndex: input.blockIndex,
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        seed: input.run.rootSeed,
        gameId: null,
      });
      return;
    }
    // `committed` is non-null here: the try above either assigned it or
    // returned on error/cancel. The type-level narrowing is lost across the
    // catch, so the null guard stays.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.isCancelled() || committed === null) return;
    const snapshot = await this.committedSnapshot(input, checkpoint, input.commandId, committed);
    this.emit({ type: 'complete', requestId, checkpoint, snapshot });
  }

  /**
   * Performance pass: the authoritative post-commit snapshot the real runner
   * also emits (mirror of `assembleCommittedSnapshot` over the fake's own
   * committed facts), so the hub renders immediately after the commit.
   */
  private async committedSnapshot(
    input: SeasonBlockStartInput,
    checkpoint: SeasonCandidateCheckpoint,
    commandId: string,
    committed: {
      checkpointState: SeasonCheckpointState;
      stateRevision: number;
      stateDigest: string;
      window: SeasonWindowOpenResult | null;
    },
  ): Promise<SeasonRunSnapshot> {
    const schedule = this.scheduleOf(input);
    // The prior-state read is best effort: without a repository (unit tests,
    // pre-promotion states) the snapshot still assembles over an empty prior.
    let current: SeasonRunSnapshot | null = null;
    try {
      current = await loadCurrentSnapshot(schedule);
    } catch {
      current = null;
    }
    return assembleCommittedSnapshot({
      run: input.run,
      rotations: input.rotations,
      checkpoint,
      commandId,
      rotationDigest: input.rotationDigest,
      window: committed.window,
      checkpointState: committed.checkpointState,
      stateRevision: committed.stateRevision,
      stateDigest: committed.stateDigest,
      schedule,
      priorSummaries: current?.summaries ?? [],
      priorAcceptedBlocks: current?.acceptedBlocks ?? [],
      priorRetainedDetails: current?.retainedDetails ?? [],
    });
  }

  private async buildCheckpoint(
    input: SeasonBlockStartInput,
    summaries: SeasonGameSummary[],
    health: SeasonHealthState,
    effectsOverride: SeasonEffectsState | null,
  ): Promise<SeasonCandidateCheckpoint> {
    const completedRounds = input.blockIndex === 8 ? 82 : (input.blockIndex + 1) * 10;
    const schedule = this.scheduleOf(input);
    const current = await loadCurrentSnapshot(schedule);
    const allSummaries = [...(current?.summaries ?? []), ...summaries];
    const played = seasonRunEngineSeam
      .reconstructSeasonGames(schedule, allSummaries)
      .filter((game) => game.status !== 'scheduled');
    const standings: SeasonStandings = seasonRunEngineSeam.reduceSeasonStandings(
      input.run.league,
      played,
    );
    const teamAggregates: SeasonTeamAggregate[] = seasonRunEngineSeam.foldSeasonTeamAggregates(
      input.run.league,
      allSummaries,
    );
    const playerAggregates: SeasonPlayerAggregate[] =
      seasonRunEngineSeam.foldSeasonPlayerAggregates(input.run.rosters, allSummaries);
    const recap: SeasonBlockRecap = {
      schemaVersion: 1,
      recapVersion: SEASON_RECAP_VERSION,
      runId: input.run.runId,
      blockIndex: input.blockIndex,
      completedRounds,
      humanRecord: null,
      standingsMovement: [],
      notablePerformances: [],
      streaks: [],
      versionSpotlights: [],
      upcomingHumanGames: [],
      injuryEvidence: {
        injuries: 0,
        bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
        sameGameReturns: 0,
        seasonEnding: 0,
        returnedThisBlock: 0,
        activeAtBlockEnd: health.injuries.filter((record) => record.missedGamesRemaining > 0)
          .length,
        humanTeamInjuries: [],
      },
      objectiveEvidence: null,
      tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
      influenceBalance: {
        humanBalance:
          this.fakeInfluenceFor(input, input.blockIndex).balances[input.humanFranchiseId ?? ''] ??
          0,
      },
    };
    const effects =
      effectsOverride ?? seasonRunEngineSeam.zeroSeasonEffectsState(input.run.rosters);
    const stateRevision = input.run.stateRevision + 1;
    return {
      schemaVersion: 1,
      checkpointVersion: SEASON_CHECKPOINT_VERSION,
      runId: input.run.runId,
      rootSeed: input.run.rootSeed,
      versions: {
        blockVersion: SEASON_BLOCK_VERSION,
        summaryVersion: SEASON_GAME_SUMMARY_VERSION,
        aggregatesVersion: SEASON_AGGREGATES_VERSION,
        recapVersion: SEASON_RECAP_VERSION,
        leadersVersion: SEASON_LEADERS_VERSION,
        homeCourtVersion: SEASON_HOME_COURT_VERSION,
        gameVersion: SEASON_GAME_VERSION,
        gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
        seedDerivationVersion: SEASON_SEED_DERIVATION_VERSION,
        staminaVersion: SEASON_STAMINA_VERSION,
        chemistryVersion: SEASON_CHEMISTRY_VERSION,
        effectsTargetsVersion: SEASON_EFFECT_TARGETS_VERSION,
        healthVersion: SEASON_HEALTH_VERSION,
        tradeVersion: SEASON_TRADE_VERSION,
        influenceVersion: SEASON_INFLUENCE_VERSION,
        objectiveVersion: SEASON_OBJECTIVE_VERSION,
        injuryTargetsVersion: SEASON_INJURY_TARGETS_VERSION,
        tradeTargetsVersion: SEASON_TRADE_TARGETS_VERSION,
        influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
      },
      blockIndex: input.blockIndex,
      completedRounds,
      revision: input.expectedRevision,
      rotationDigest: input.rotationDigest,
      standings,
      teamAggregates,
      playerAggregates,
      gameSummaries: summaries,
      retainedDetails: [],
      recap,
      effects,
      health,
      influence: this.fakeInfluenceFor(input, input.blockIndex),
      transactions: this.fakeTransactionsFor(input.blockIndex),
      objective: {
        objectiveId: null,
        success: null,
        evaluation: {
          objectiveId: 'win-six',
          blockIndex: input.blockIndex,
          success: false,
          facts: {
            games: 0,
            wins: 0,
            pointsAllowed: 0,
            reboundMargin: 0,
            tipsWithAtLeastEightAvailable: 0,
            tipsTotal: 0,
            benchMinutes: 0,
            turnovers: 0,
          },
          tipCountedGames: 0,
        },
      },
      expectedStateRevision: input.run.stateRevision,
      expectedStateDigest: input.run.stateDigest,
      stateRevision,
      stateDigest: seasonDigestHex(`${input.run.runId}:${String(stateRevision)}`),
      digest: seasonDigestHex(`${input.run.runId}:${String(input.blockIndex)}`),
    };
  }

  /** Commits the checkpoint with the M2.5 run-state facts (one transaction). */
  private async commitCheckpoint(
    input: SeasonBlockStartInput,
    commandId: string,
    checkpoint: SeasonCandidateCheckpoint,
    m25: FakeM25CommitInput,
  ): Promise<void> {
    const repo = await getSeasonRunRepository();
    await repo.commitSeasonBlock({
      runId: input.run.runId,
      revision: checkpoint.revision + 1,
      commandId,
      rotationDigest: checkpoint.rotationDigest,
      checkpointDigest: checkpoint.digest,
      completedRounds: checkpoint.completedRounds,
      standings: checkpoint.standings,
      teamAggregates: checkpoint.teamAggregates,
      playerAggregates: checkpoint.playerAggregates,
      summaries: checkpoint.gameSummaries,
      retainedDetails: [],
      recap: checkpoint.recap,
      rotations: input.rotations,
      effects: checkpoint.effects,
      health: m25.health,
      transactions: m25.transactions,
      influence: m25.influence,
      trade: null,
      objectives: input.run.objectives,
      checkpointState: m25.checkpointState,
      stateRevision: m25.stateRevision,
      stateDigest: m25.stateDigest,
      expectedStateRevision: input.run.stateRevision,
      expectedStateDigest: input.run.stateDigest,
      window: m25.window,
    });
  }

  /**
   * M2.5: the engine derives the post-block run state chain from the
   * candidate and the LOCKED rotation set (mirror of the real runner, which
   * commits the locked rotations — the human team's pending edit included —
   * so the state digest must cover exactly that set or the reload audit
   * reports a divergence).
   */
  private committedFacts(
    input: SeasonBlockStartInput,
    checkpoint: SeasonCandidateCheckpoint,
    commandId: string,
  ): {
    checkpointState: SeasonCheckpointState;
    stateRevision: number;
    stateDigest: string;
    window: SeasonWindowOpenResult | null;
  } {
    return completeSeasonBlockCommit({
      run: { ...input.run, rotations: input.rotations },
      candidate: checkpoint,
      commandId,
      rotationDigest: input.rotationDigest,
      humanFranchiseId: input.humanFranchiseId,
      effects: checkpoint.effects,
    });
  }

  /** Deterministic M2.5 health: one active injury + one returned injury for
   * the human team (the health strip renders both states). */
  private fakeHealthFor(input: SeasonBlockStartInput): SeasonHealthState {
    const humanRoster =
      input.run.rosters.find((roster) => roster.franchiseId === input.humanFranchiseId)?.players ??
      [];
    const activePlayer = humanRoster[0]?.playerVersionId ?? 'pv-unknown';
    const returnedPlayer = humanRoster[1]?.playerVersionId ?? 'pv-unknown';
    const { toRound } = blockRoundRange(input.blockIndex);
    return {
      schemaVersion: 1,
      healthVersion: SEASON_HEALTH_VERSION,
      injuries: [
        {
          injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          playerVersionId: activePlayer,
          franchiseId: input.humanFranchiseId ?? '',
          gameId: 's000001',
          type: 'soft-tissue',
          severity: 'moderate',
          occurredBeforeHalftime: false,
          sameGameReturn: false,
          sameGameReturned: null,
          missedGamesTotal: 12,
          missedGamesRemaining: 2,
          actualReturnRound: null,
          seasonEnding: false,
          rehabModifier: 0 as const,
          recurrenceWindowRoundsRemaining: 0,
          seedPath: ['e2e', 'fake-runner', 'health', 'active'],
        },
        {
          injuryId: 'inj-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          playerVersionId: returnedPlayer,
          franchiseId: input.humanFranchiseId ?? '',
          gameId: 's000002',
          type: 'upper-body',
          severity: 'minor',
          occurredBeforeHalftime: true,
          sameGameReturn: true,
          sameGameReturned: true,
          missedGamesTotal: 4,
          missedGamesRemaining: 0,
          actualReturnRound: toRound,
          seasonEnding: false,
          rehabModifier: 0 as const,
          recurrenceWindowRoundsRemaining: 6,
          seedPath: ['e2e', 'fake-runner', 'health', 'returned'],
        },
      ],
    };
  }

  /** M2.5 interruption health: all five rotation starters unavailable. */
  private interruptionHealthFor(input: SeasonBlockStartInput): SeasonHealthState {
    const humanRoster =
      input.run.rosters.find((roster) => roster.franchiseId === input.humanFranchiseId)?.players ??
      [];
    const humanRotation =
      input.rotations.find((rotation) => rotation.franchiseId === input.humanFranchiseId) ?? null;
    const starters =
      humanRotation?.starters ?? humanRoster.slice(0, 5).map((p) => p.playerVersionId);
    const injuries = starters.map((playerVersionId, index) => ({
      injuryId: `inj-${String(index).padStart(31, 'c')}`,
      playerVersionId,
      franchiseId: input.humanFranchiseId ?? '',
      gameId: 's000001',
      type: 'lower-body' as const,
      severity: 'major' as const,
      occurredBeforeHalftime: false,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 10,
      missedGamesRemaining: 8,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['e2e', 'fake-runner', 'interruption'],
    }));
    return {
      schemaVersion: 1,
      healthVersion: SEASON_HEALTH_VERSION,
      injuries,
    };
  }

  /** Deterministic M2.5 Influence: +2 initial and +1 per accepted block. */
  private fakeInfluenceFor(input: SeasonBlockStartInput, blockIndex: number): SeasonInfluenceState {
    const franchiseIds = input.run.league.teams.map((team) => team.franchiseId);
    const balance = 2 + blockIndex + 1;
    const ledger: SeasonInfluenceState['ledger'] = [];
    for (const franchiseId of franchiseIds) {
      ledger.push({
        entryId: `influence-initial-${franchiseId}`,
        franchiseId,
        source: 'initial-grant',
        blockIndex: null,
        commandId: null,
        requestedDelta: 2,
        appliedDelta: 2,
        balanceAfter: 2,
        explanation: 'Initial +2 Influence grant at run creation',
      });
      for (let block = 0; block <= blockIndex; block += 1) {
        ledger.push({
          entryId: `influence-block-${String(block)}-${franchiseId}`,
          franchiseId,
          source: 'block-grant',
          blockIndex: block,
          commandId: `grant-${String(block)}`,
          requestedDelta: 1,
          appliedDelta: 1,
          balanceAfter: 3 + block,
          explanation: `+1 Influence grant for accepted block ${String(block + 1)}`,
        });
      }
    }
    return {
      schemaVersion: 1,
      influenceVersion: SEASON_INFLUENCE_VERSION,
      balances: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, balance])),
      ledger,
      windows: {},
      rehabs: {},
    };
  }

  /** Deterministic grant transactions for the accepted blocks 0..blockIndex. */
  private fakeTransactionsFor(blockIndex: number): SeasonTransactionEntry[] {
    const transactions: SeasonTransactionEntry[] = [];
    for (let block = 0; block <= blockIndex; block += 1) {
      transactions.push({
        transactionId: `tx-grant-${String(block)}`,
        commandId: `grant-${String(block)}`,
        franchiseId: null,
        type: 'block-grant',
        blockIndex: block,
        appliedAtStateRevision: block + 1,
        payload: {},
        explanation: `+1 Influence block grant for all franchises (block ${String(block + 1)})`,
      });
    }
    return transactions;
  }

  private scheduleOf(input: SeasonBlockStartInput) {
    return {
      schemaVersion: 1,
      scheduleVersion: SEASON_SCHEDULE_VERSION,
      formulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
      leagueVersion: SEASON_LEAGUE_VERSION,
      generationSeed: '0'.repeat(32),
      rounds: 82,
      games: input.run.games.map((game) => ({
        gameId: game.gameId,
        round: game.round,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
      })),
    } as const;
  }
  static gamesToLock(blockIndex: number): number {
    return gamesToLockForBlock(blockIndex);
  }

  static blockIndexOfRound(round: number): number {
    return blockIndexForRound(round);
  }
}

/** The validated snapshot of the accepted state (schedule-aware loader). */
async function loadCurrentSnapshot(schedule: unknown): Promise<SeasonRunSnapshot | null> {
  const { loadActiveRunWithSchedule } = (await import('@hoop-rush/persistence')) as unknown as {
    loadActiveRunWithSchedule?: (schedule: unknown) => Promise<SeasonRunSnapshot | null>;
  };
  return loadActiveRunWithSchedule ? await loadActiveRunWithSchedule(schedule) : null;
}

export function createFakeSeasonBlockRunner(): SeasonBlockRunner {
  return new FakeSeasonBlockRunner();
}
