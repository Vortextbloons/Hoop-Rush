import {
  SEASON_RUN_SCHEMA_VERSION,
  blockRoundRange,
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  type EraSimulationProfile,
  type SeasonCandidateCheckpoint,
  type SeasonChallengeDeal,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonFreeAgencyIndex,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonRosterTargets,
  type SeasonSchedule,
  type SeasonScoreline,
} from '@hoop-rush/data-contracts';
import {
  assembleSeasonBlockCandidate,
  assembleSeasonPendingBlock,
  auditSeasonBlock,
  completeSeasonBlockCommit,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  seasonBlockGamesOf,
  seasonBlockRejection,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';
import type { SeasonRunRepository } from '@hoop-rush/persistence';
import {
  acceptWorkerResult,
  assembleCommittedSnapshot,
  challengesWithSuccess,
  objectivesWithSuccess,
  type SeasonBlockResumeInput,
  type SeasonBlockRunner,
  type SeasonBlockStartInput,
  type SeasonRunnerEvent,
} from '$lib/season/season-block-runner';
import { getSeasonRunRepository } from '$lib/season/season-repo';
import { loadSeasonSchedule } from './season-assets';

export interface FakeSeasonBlockRunnerDeps {
  repository?: SeasonRunRepository;
  schedule?: SeasonSchedule;
  catalog?: SeasonDraftCatalog;
  profile?: EraSimulationProfile;
}

const PROGRESS_BATCH_GAMES = 10;

function scorelineOf(summary: SeasonGameSummary): SeasonScoreline {
  return {
    gameId: summary.gameId,
    homeFranchiseId: summary.homeFranchiseId,
    homeScore: summary.homeScore,
    awayScore: summary.awayScore,
    awayFranchiseId: summary.awayFranchiseId,
  };
}

function progressFactsOf(summaries: readonly SeasonGameSummary[], humanFranchiseId: string | null) {
  const humanResults: SeasonScoreline[] = [];
  let wins = 0;
  let losses = 0;
  let closest: SeasonScoreline | null = null;
  let closestMargin = Number.POSITIVE_INFINITY;
  let blowout: SeasonScoreline | null = null;
  let blowoutMargin = -1;
  let highestScoring: SeasonScoreline | null = null;
  let highestCombined = -1;
  for (const summary of summaries) {
    const line = scorelineOf(summary);
    const margin = Math.abs(summary.homeScore - summary.awayScore);
    const combined = summary.homeScore + summary.awayScore;
    if (margin < closestMargin) {
      closest = line;
      closestMargin = margin;
    }
    if (margin > blowoutMargin) {
      blowout = line;
      blowoutMargin = margin;
    }
    if (combined > highestCombined) {
      highestScoring = line;
      highestCombined = combined;
    }
    if (
      humanFranchiseId !== null &&
      (summary.homeFranchiseId === humanFranchiseId || summary.awayFranchiseId === humanFranchiseId)
    ) {
      humanResults.push(line);
      const humanScore =
        summary.homeFranchiseId === humanFranchiseId ? summary.homeScore : summary.awayScore;
      const oppScore =
        summary.homeFranchiseId === humanFranchiseId ? summary.awayScore : summary.homeScore;
      if (humanScore > oppScore) wins += 1;
      else losses += 1;
    }
  }
  return {
    humanResults,
    humanRecord: { wins, losses },
    leaguePulse: { closest, blowout, highestScoring },
  };
}

export class FakeSeasonBlockRunner implements SeasonBlockRunner {
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private cancelled: boolean = false;
  private currentBlockIndex: number | null = null;

  constructor(private readonly deps: FakeSeasonBlockRunnerDeps = {}) {}

  startBlock(input: SeasonBlockStartInput): string {
    const requestId = `fake-${input.commandId}`;
    this.cancelled = false;
    this.currentBlockIndex = input.blockIndex;
    this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });
    void this.execute(requestId, input, null);
    return requestId;
  }

  resumeBlock(input: SeasonBlockResumeInput): string {
    const requestId = `fake-resume-${input.commandId}`;
    this.cancelled = false;
    this.currentBlockIndex = input.blockIndex;
    this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });
    void this.executeResume(requestId, input);
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

  prewarm(): void {}

  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SeasonRunnerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private isCancelled(): boolean {
    return this.cancelled;
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, 0);
      this.timers.add(timer);
    });
  }

  private fail(
    requestId: string,
    blockIndex: number,
    code: 'invariant-failure' | 'internal',
    message: string,
    seed: string | null,
  ): void {
    if (this.isCancelled()) return;
    this.emit({ type: 'error', requestId, blockIndex, code, message, seed, gameId: null });
  }

  private async resolveAssets(input: SeasonBlockStartInput): Promise<{
    repository: SeasonRunRepository;
    schedule: SeasonSchedule;
    catalog: SeasonDraftCatalog;
    profile: EraSimulationProfile;
  }> {
    const repository: SeasonRunRepository =
      this.deps.repository ?? (await getSeasonRunRepository());
    let schedule = this.deps.schedule;
    if (schedule === undefined) {
      schedule = await loadSeasonSchedule();
    }
    let catalog = this.deps.catalog;
    if (catalog === undefined) {
      catalog = await loadSeasonDraftCatalog(input.catalogUrl, input.catalogHash);
    }
    let profile = this.deps.profile;
    if (profile === undefined) {
      profile = await loadEraSimulationProfile(input.profileUrl, input.profileHash);
    }
    return { repository, schedule, catalog, profile };
  }

  private async executeResume(requestId: string, input: SeasonBlockResumeInput): Promise<void> {
    try {
      const repository = this.deps.repository ?? (await getSeasonRunRepository());
      if (this.isCancelled()) return;
      const pending = await repository.loadPendingBlock(input.runId);
      if (pending === null) throw new Error('no pending block to resume');
      if (pending.blockIndex !== input.blockIndex) throw new Error('pending block mismatch');
      if (pending.expectedRevision !== input.expectedRevision) {
        throw new Error('pending expectedRevision mismatch');
      }
      if (pending.rotationDigest !== input.rotationDigest) {
        throw new Error('pending rotation digest mismatch');
      }
      const snapshot = await repository.loadActiveRun();
      if (this.isCancelled()) return;
      if (snapshot === null) throw new Error('no active season run to resume');
      await this.execute(
        requestId,
        {
          run: snapshot.run,
          effects: snapshot.effects,
          rotations: input.rotations,
          blockIndex: input.blockIndex,
          expectedRevision: input.expectedRevision,
          rotationDigest: input.rotationDigest,
          commandId: input.commandId,
          humanFranchiseId: input.humanFranchiseId,
          objectiveId: pending.objectiveId ?? null,
          challengeDeal: pending.challengeDeal ?? null,
          campaignOpportunityId:
            (pending as unknown as { campaignOpportunityId?: string | null })
              .campaignOpportunityId ?? null,
          homeCourt: input.homeCourt,
          catalogUrl: input.catalogUrl,
          catalogHash: input.catalogHash,
          profileUrl: input.profileUrl,
          profileHash: input.profileHash,
        },
        pending,
      );
    } catch (error) {
      this.fail(
        requestId,
        input.blockIndex,
        'internal',
        error instanceof Error ? error.message : String(error),
        null,
      );
    }
  }

  private simulationInput(
    start: SeasonBlockStartInput,
    pending: SeasonPendingBlockCandidate | null,
    schedule: SeasonSchedule,
    catalog: SeasonDraftCatalog,
    profile: EraSimulationProfile,
    priorSummaries: readonly SeasonGameSummary[],
    effects: SeasonEffectsState,
    health: SeasonHealthState,
  ): SeasonBlockSimulationInput {
    const run = { ...start.run, rotations: start.rotations };
    const deal: SeasonChallengeDeal | null = start.challengeDeal ?? pending?.challengeDeal ?? null;
    return {
      command: {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        blockVersion: run.versions.blockVersion,
        command: 'submit-season-block',
        commandId: start.commandId,
        runId: run.runId,
        expectedRevision: start.expectedRevision,
        blockIndex: start.blockIndex,
        rotationDigest: start.rotationDigest,
        objectiveId: start.objectiveId ?? null,
        ...(deal !== null ? { challengeIds: [...deal.challengeIds] } : {}),
        campaignOpportunityId: start.campaignOpportunityId ?? null,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
      },
      run,
      expanded: expandSeasonRunRosters(run, catalog),
      schedule,
      catalog,
      profile,
      humanFranchiseId: start.humanFranchiseId,
      rosterPlayerIds: rosterPlayerIdsOf(run),
      priorSummaries: [...priorSummaries],
      effects,
      health,
      objectiveId: start.objectiveId ?? null,
      ...(deal !== null
        ? {
            challengeDeal: deal,
            objectives: (
              run as unknown as {
                objectives?: SeasonBlockSimulationInput['objectives'];
              }
            ).objectives,
          }
        : {}),
      campaignState: (
        run as unknown as {
          campaign?: SeasonBlockSimulationInput['campaignState'];
        }
      ).campaign,
      influence: run.influence,
      transactions: run.transactions,
    };
  }

  private async execute(
    requestId: string,
    start: SeasonBlockStartInput,
    pending: SeasonPendingBlockCandidate | null,
  ): Promise<void> {
    const seed = start.run.rootSeed;
    try {
      const { repository, schedule, catalog, profile } = await this.resolveAssets(start);
      if (this.isCancelled()) return;
      const snapshot = await repository.loadActiveRun().catch(() => null);
      if (this.isCancelled()) return;
      const priorSummaries = snapshot?.summaries ?? [];
      const priorAcceptedBlocks = snapshot?.acceptedBlocks ?? [];
      const priorRetainedDetails = snapshot?.retainedDetails ?? [];
      const simInput = this.simulationInput(
        start,
        pending,
        schedule,
        catalog,
        profile,
        priorSummaries,
        pending?.effects ?? start.effects,
        pending?.health ?? start.run.health,
      );
      const rejection = seasonBlockRejection(simInput);
      if (rejection !== null) {
        throw new Error(`block submission rejected by the engine: ${rejection.code}`);
      }
      const games = seasonBlockGamesOf(schedule, start.blockIndex);
      const startIndex =
        pending === null ? 0 : games.findIndex((game) => game.gameId === pending.nextGameId);
      if (startIndex < 0) {
        throw new Error(
          `startGameId ${String(pending?.nextGameId)} is not a game of block ${String(start.blockIndex)}`,
        );
      }
      const { fromRound } = blockRoundRange(start.blockIndex);
      let previousRound =
        startIndex > 0 ? (games[startIndex - 1]?.round ?? fromRound) : fromRound - 1;
      let effects = simInput.effects;
      let health = simInput.health;
      const summaries: SeasonGameSummary[] = [...(pending?.summaries ?? [])];
      const retainedDetails: SeasonRetainedGameDetail[] = [...(pending?.retainedDetails ?? [])];
      for (let index = startIndex; index < games.length; index += PROGRESS_BATCH_GAMES) {
        if (this.isCancelled()) return;
        const end = Math.min(index + PROGRESS_BATCH_GAMES, games.length);
        for (let gameIndex = index; gameIndex < end; gameIndex += 1) {
          const game = games[gameIndex];
          if (game === undefined) continue;
          const outcome = simulateSeasonBlockGame({
            input: simInput,
            game,
            effects,
            health,
            options: {
              skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
            },
          });
          if ('interruption' in outcome) {
            await this.persistInterruption(
              requestId,
              start,
              simInput,
              { ...outcome.interruption },
              summaries,
              retainedDetails,
              effects,
              health,
              repository,
            );
            return;
          }
          effects = outcome.effects;
          health = outcome.health;
          previousRound = game.round;
          summaries.push(outcome.summary);
          if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);
        }
        const latest = summaries[summaries.length - 1] ?? null;
        const facts = progressFactsOf(summaries, start.humanFranchiseId);
        this.emit({
          type: 'progress',
          requestId,
          blockIndex: start.blockIndex,
          gamesCompleted: summaries.length,
          gamesTotal: games.length,
          latestGameId: latest?.gameId ?? null,
          latestResult: latest !== null ? scorelineOf(latest) : null,
          isHumanGame:
            latest !== null &&
            start.humanFranchiseId !== null &&
            (latest.homeFranchiseId === start.humanFranchiseId ||
              latest.awayFranchiseId === start.humanFranchiseId),
          humanRecordInBlock: facts.humanRecord,
          humanResults: facts.humanResults,
          leaguePulse: facts.leaguePulse,
        });
        await this.delay();
      }
      if (this.isCancelled()) return;
      const candidate = assembleSeasonBlockCandidate({
        input: simInput,
        summaries,
        retainedDetails,
        effects,
        health,
      });
      const auditFailures = auditSeasonBlock(candidate, simInput);
      if (auditFailures.length > 0) {
        this.fail(requestId, start.blockIndex, 'invariant-failure', auditFailures.join('; '), seed);
        return;
      }
      const gateFailures = acceptWorkerResult(candidate, {
        runId: start.run.runId,
        blockIndex: start.blockIndex,
        revision: start.expectedRevision,
        rotationDigest: start.rotationDigest,
        expectedStateRevision: start.run.stateRevision,
        expectedStateDigest: start.run.stateDigest,
      });
      if (gateFailures.length > 0) {
        this.fail(requestId, start.blockIndex, 'invariant-failure', gateFailures.join('; '), seed);
        return;
      }
      await this.commitCandidate(
        requestId,
        start,
        simInput,
        candidate,
        { schedule, catalog, profile },
        { priorSummaries, priorAcceptedBlocks, priorRetainedDetails },
        repository,
      );
    } catch (error) {
      this.fail(
        requestId,
        start.blockIndex,
        'internal',
        error instanceof Error ? error.message : String(error),
        seed,
      );
    }
  }

  private async persistInterruption(
    requestId: string,
    start: SeasonBlockStartInput,
    simInput: SeasonBlockSimulationInput,
    interruption: SeasonInvalidRosterInterruption,
    summaries: readonly SeasonGameSummary[],
    retainedDetails: readonly SeasonRetainedGameDetail[],
    effects: SeasonEffectsState,
    health: SeasonHealthState,
    repository: SeasonRunRepository,
  ): Promise<void> {
    const pending = assembleSeasonPendingBlock({
      run: simInput.run,
      commandId: simInput.command.commandId,
      blockIndex: start.blockIndex,
      expectedRevision: start.expectedRevision,
      expectedStateRevision: start.run.stateRevision,
      expectedStateDigest: start.run.stateDigest,
      objectiveId: start.objectiveId ?? null,
      challengeDeal: simInput.challengeDeal ?? null,
      challengeIds: simInput.command.challengeIds,
      campaignOpportunityId: simInput.command.campaignOpportunityId ?? null,
      nextGameId: interruption.nextGameId,
      summaries,
      retainedDetails,
      effects,
      health,
      rotationDigest: start.rotationDigest,
    });
    await repository.savePendingBlock(pending, interruption);
    if (this.isCancelled()) return;
    this.emit({
      type: 'interrupted',
      requestId,
      runId: pending.runId,
      blockIndex: pending.blockIndex,
      pending,
      interruption,
    });
  }

  private async commitCandidate(
    requestId: string,
    start: SeasonBlockStartInput,
    simInput: SeasonBlockSimulationInput,
    candidate: SeasonCandidateCheckpoint,
    assets: {
      schedule: SeasonSchedule;
      catalog: SeasonDraftCatalog;
      profile: EraSimulationProfile;
    },
    priors: {
      priorSummaries: SeasonGameSummary[];
      priorAcceptedBlocks: import('@hoop-rush/data-contracts').SeasonAcceptedBlock[];
      priorRetainedDetails: SeasonRetainedGameDetail[];
    },
    repository: SeasonRunRepository,
  ): Promise<void> {
    const authoritative: SeasonCandidateCheckpoint = {
      ...candidate,
      freeAgency: start.run.freeAgency,
    };
    let freeAgencyAssets: {
      freeAgencyIndex: SeasonFreeAgencyIndex;
      freeAgencyTargets: SeasonRosterTargets;
    } | null = null;
    if (start.blockIndex === 2 || start.blockIndex === 4 || start.blockIndex === 6) {
      const module = await import('./season-assets');
      const [freeAgencyIndex, freeAgencyTargets] = await Promise.all([
        module.loadSeasonFreeAgencyIndex(),
        module.loadSeasonFreeAgencyTargets(),
      ]);
      freeAgencyAssets = { freeAgencyIndex, freeAgencyTargets };
    }
    if (this.isCancelled()) return;
    const committed = completeSeasonBlockCommit({
      run: { ...start.run, rotations: start.rotations },
      candidate: authoritative,
      commandId: start.commandId,
      rotationDigest: start.rotationDigest,
      humanFranchiseId: start.humanFranchiseId,
      catalog: assets.catalog,
      effects: authoritative.effects,
      freeAgencyIndex: freeAgencyAssets?.freeAgencyIndex,
      freeAgencyTargets: freeAgencyAssets?.freeAgencyTargets,
      profile: start.blockIndex === 3 ? assets.profile : undefined,
      schedule: start.blockIndex === 3 ? assets.schedule : undefined,
      priorSummaries: priors.priorSummaries,
    });
    const window = committed.window;
    const objectives = objectivesWithSuccess(start.run, authoritative);
    const challenges = committed.challenges ?? challengesWithSuccess(start.run, authoritative);
    const campaign = committed.campaign ?? null;
    await repository.commitSeasonBlock({
      runId: authoritative.runId,
      revision: authoritative.revision + 1,
      commandId: start.commandId,
      rotationDigest: authoritative.rotationDigest,
      checkpointDigest: authoritative.digest,
      completedRounds: authoritative.completedRounds,
      standings: authoritative.standings,
      teamAggregates: authoritative.teamAggregates,
      playerAggregates: authoritative.playerAggregates,
      summaries: authoritative.gameSummaries,
      retainedDetails: [...priors.priorRetainedDetails, ...authoritative.retainedDetails],
      recap: authoritative.recap,
      rotations: window !== null ? window.rotations : start.rotations,
      effects: window !== null ? window.effects : authoritative.effects,
      freeAgency: committed.freeAgency,
      health: authoritative.health,
      transactions: window !== null ? window.transactions : authoritative.transactions,
      influence: window !== null ? window.influence : authoritative.influence,
      trade: window !== null ? window.trade : start.run.trade,
      objectives,
      challenges,
      campaign,
      evolution: committed.evolution,
      sponsors: committed.sponsors,
      checkpointState: committed.checkpointState,
      stateRevision: committed.stateRevision,
      stateDigest: committed.stateDigest,
      expectedStateRevision: start.run.stateRevision,
      expectedStateDigest: start.run.stateDigest,
      window,
    });
    if (this.isCancelled()) return;
    const snapshot = assembleCommittedSnapshot({
      run: start.run,
      rotations: start.rotations,
      checkpoint: authoritative,
      commandId: start.commandId,
      rotationDigest: start.rotationDigest,
      window,
      freeAgency: committed.freeAgency,
      campaign,
      challenges,
      evolution: committed.evolution,
      sponsors: committed.sponsors,
      checkpointState: committed.checkpointState,
      stateRevision: committed.stateRevision,
      stateDigest: committed.stateDigest,
      schedule: assets.schedule,
      priorSummaries: priors.priorSummaries,
      priorAcceptedBlocks: priors.priorAcceptedBlocks,
      priorRetainedDetails: priors.priorRetainedDetails,
    });
    if (this.isCancelled()) return;
    this.emit({ type: 'complete', requestId, checkpoint: authoritative, snapshot });
  }
}

export function createFakeSeasonBlockRunner(
  deps: FakeSeasonBlockRunnerDeps = {},
): SeasonBlockRunner {
  return new FakeSeasonBlockRunner(deps);
}
