import {
  SEASON_CHECKPOINT_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  blockIndexForRound,
  blockRoundRange,
  seasonDigestHex,
  type SeasonBlockRecap,
  type SeasonCandidateCheckpoint,
  type SeasonCompactPlayerLine,
  type SeasonGameSummary,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import { seasonRunEngineSeam, type SeasonRunSnapshot } from '@hoop-rush/persistence';
import type {
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
  }
}

export class FakeSeasonBlockRunner implements SeasonBlockRunner {
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private cancelled = false;
  private currentBlockIndex: number | null = null;
  private stallingRequestId: string | null = null;

  startBlock(input: SeasonBlockStartInput): string {
    const requestId = `fake-${input.commandId}`;
    this.cancelled = false;
    this.currentBlockIndex = input.blockIndex;
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
          ? this.summaryFor(
              input,
              latest.gameId,
              latest.round,
              latest.homeFranchiseId,
              latest.awayFranchiseId,
            )
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
    const completedRounds = input.blockIndex === 8 ? 82 : (input.blockIndex + 1) * 10;
    let checkpoint: SeasonCandidateCheckpoint | null = null;
    try {
      const schedule = {
        schemaVersion: 1,
        scheduleVersion: 'schedule-v1',
        formulaVersion: 'schedule-formula-v1',
        leagueVersion: 'league-v1',
        generationSeed: '0'.repeat(32),
        rounds: 82,
        games: input.run.games.map((game) => ({
          gameId: game.gameId,
          round: game.round,
          homeFranchiseId: game.homeFranchiseId,
          awayFranchiseId: game.awayFranchiseId,
        })),
      } as const;
      // The audit folds aggregates over ALL accepted summaries, so the commit
      // must carry cumulative folds, not just this block's rows. The plain
      // repository needs the schedule for loadActiveRun; use the exported
      // schedule-aware loader (same IndexedDB, same validation path).
      const { loadActiveRunWithSchedule } = (await import('@hoop-rush/persistence')) as unknown as {
        loadActiveRunWithSchedule?: (schedule: unknown) => Promise<SeasonRunSnapshot | null>;
      };
      const current = loadActiveRunWithSchedule ? await loadActiveRunWithSchedule(schedule) : null;
      const allSummaries = [...(current?.summaries ?? []), ...summaries];
      const played = seasonRunEngineSeam
        .reconstructSeasonGames(schedule, allSummaries)
        .filter((game) => game.status !== 'scheduled');
      const standings: SeasonStandings = seasonRunEngineSeam.reduceSeasonStandings(
        input.run.league,
        played,
      );
      const teamAggregates = seasonRunEngineSeam.foldSeasonTeamAggregates(
        input.run.league,
        allSummaries,
      );
      const playerAggregates = seasonRunEngineSeam.foldSeasonPlayerAggregates(
        input.run.rosters,
        allSummaries,
      );
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
      };
      checkpoint = {
        schemaVersion: 1,
        checkpointVersion: SEASON_CHECKPOINT_VERSION,
        runId: input.run.runId,
        rootSeed: input.run.rootSeed,
        versions: {
          blockVersion: 'season-block-v1',
          summaryVersion: SEASON_GAME_SUMMARY_VERSION,
          aggregatesVersion: 'season-aggregates-v1',
          recapVersion: SEASON_RECAP_VERSION,
          leadersVersion: SEASON_LEADERS_VERSION,
          homeCourtVersion: SEASON_HOME_COURT_VERSION,
          gameVersion: SEASON_GAME_VERSION,
          gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
          seedDerivationVersion: SEASON_SEED_DERIVATION_VERSION,
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
        digest: seasonDigestHex(`${input.run.runId}:${String(input.blockIndex)}`),
      };
      const repo = await getSeasonRunRepository();
      await repo.commitSeasonBlock({
        runId: input.run.runId,
        revision: input.expectedRevision + 1,
        commandId: input.commandId,
        rotationDigest: input.rotationDigest,
        checkpointDigest: checkpoint.digest,
        completedRounds,
        standings,
        teamAggregates,
        playerAggregates,
        summaries,
        retainedDetails: [],
        recap,
        rotations: input.rotations,
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
    if (this.isCancelled()) return;
    this.emit({ type: 'complete', requestId, checkpoint });
  }
  /** Games in the simulated block (also useful for specs). */
  static gamesToLock(blockIndex: number): number {
    return gamesToLockForBlock(blockIndex);
  }

  static blockIndexOfRound(round: number): number {
    return blockIndexForRound(round);
  }
}

export function createFakeSeasonBlockRunner(): SeasonBlockRunner {
  return new FakeSeasonBlockRunner();
}
