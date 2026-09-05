import type {
  SeasonAcceptedBlock,
  SeasonCandidateCheckpoint,
  SeasonCheckpointState,
  SeasonDraftCatalog,
  SeasonEffectsState,
  SeasonFreeAgencyIndex,
  SeasonFreeAgencyState,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonHomeCourtProfile,
  SeasonInvalidRosterInterruption,
  SeasonObjectiveId,
  SeasonObjectiveState,
  SeasonPendingBlockCandidate,
  SeasonRetainedGameDetail,
  SeasonRosterTargets,
  SeasonRotation,
  SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  franchiseIdSchema,
  seasonAcceptedBlockSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerContinueRequestSchema,
  seasonWorkerMessageSchema,
  seasonWorkerStartRequestSchema,
  seasonWorkerWarmRequestSchema,
  type SeasonScoreline,
  type SeasonWorkerContinueRequest,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  completeSeasonBlockCommit,
  reconstructSeasonGames,
  seasonCheckpointDigest,
  seasonFranchiseLegalFiveFacts,
  seasonNextBlockIndex,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';
import type {
  SeasonRunRepository,
  SeasonRunSnapshot,
  SeasonWindowOpenResult,
} from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import type { SeasonArtifactUrls } from './season-assets';
import { randomUUID } from '$lib/random-id';
export type SeasonRunnerEvent =
  | {
      type: 'started';
      requestId: string;
      blockIndex: number;
    }
  | {
      type: 'progress';
      requestId: string;
      blockIndex: number;
      gamesCompleted: number;
      gamesTotal: number;
      latestGameId: string | null;
      latestResult: SeasonScoreline | null;
    }
  | {
      type: 'complete';
      requestId: string;
      checkpoint: SeasonCandidateCheckpoint;
      snapshot: SeasonRunSnapshot;
    }
  | {
      type: 'interrupted';
      requestId: string;
      runId: string;
      blockIndex: number;
      pending: SeasonPendingBlockCandidate;
      interruption: SeasonInvalidRosterInterruption;
    }
  | {
      type: 'cancelled';
      requestId: string;
      blockIndex: number;
    }
  | {
      type: 'error';
      requestId: string;
      blockIndex: number;
      code: 'invariant-failure' | 'cancelled' | 'internal';
      message: string;
      seed: string | null;
      gameId: string | null;
    };
export interface SeasonBlockStartInput {
  run: SeasonRun;
  effects: SeasonEffectsState;
  rotations: SeasonRotation[];
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: import('@hoop-rush/data-contracts').CommandId;
  humanFranchiseId: import('@hoop-rush/data-contracts').FranchiseId | null;
  objectiveId: SeasonObjectiveId | null;
  campaignOpportunityId?: string | null;
  homeCourt: SeasonHomeCourtProfile;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}
export interface SeasonBlockResumeInput {
  runId: import('@hoop-rush/data-contracts').Id;
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: import('@hoop-rush/data-contracts').CommandId;
  rotations: SeasonRotation[];
  humanFranchiseId: import('@hoop-rush/data-contracts').FranchiseId | null;
  homeCourt: SeasonHomeCourtProfile;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}
export interface SeasonBlockRunner {
  startBlock(input: SeasonBlockStartInput): string;
  resumeBlock(input: SeasonBlockResumeInput): string;
  cancel(requestId: string): void;
  terminate(): void;
  prewarm(): void;
  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void;
}
export interface SeasonBlockRunnerDeps {
  repository?: SeasonRunRepository;
  schedule?: SeasonSchedule;
  workerUrl?: string;
  artifacts?: () => Promise<SeasonArtifactUrls>;
}
export function createSeasonBlockRunner(deps: SeasonBlockRunnerDeps = {}): SeasonBlockRunner {
  const listeners = new Set<(event: SeasonRunnerEvent) => void>();
  let worker: Worker | null = null;
  let currentRequestId: string | null = null;
  const cancelledBeforeWorker = new Set<string>();
  const requestActive = () => currentRequestId !== null;
  let warmRequestId: string | null = null;
  let warmed = false;
  let current: {
    blockIndex: number;
    expectedRevision: number;
    rotationDigest: string;
    commandId: string;
    rotations: SeasonRotation[];
    input: SeasonBlockStartInput;
    resumePending: SeasonPendingBlockCandidate | null;
  } | null = null;
  let runState: {
    runId: string;
    revision: number;
    completedRounds: number;
    commandIds: Set<string>;
    summaries: SeasonGameSummary[];
    blocks: SeasonAcceptedBlock[];
    retainedDetails: SeasonRetainedGameDetail[];
    effects: SeasonEffectsState | null;
    health: SeasonHealthState | null;
    stateRevision: number;
    stateDigest: string;
  } | null = null;
  let workerSummaryRunId: string | null = null;
  let workerSummaryCount = 0;
  let workerRosterKey: string | null = null;
  const rosterKeyCache = new WeakMap<object, string>();
  function rosterKeyOf(rosters: SeasonRun['rosters']): string {
    const cached = rosterKeyCache.get(rosters);
    if (cached !== undefined) return cached;
    const key = rosters
      .map(
        (roster) =>
          `${roster.franchiseId}:${roster.players.map((player) => player.playerVersionId).join(',')}`,
      )
      .join('|');
    rosterKeyCache.set(rosters, key);
    return key;
  }
  const repositoryPromise = deps.repository !== undefined ? Promise.resolve(deps.repository) : null;
  const schedulePromise = deps.schedule !== undefined ? Promise.resolve(deps.schedule) : null;
  function resolveSchedule(): Promise<SeasonSchedule> {
    if (schedulePromise !== null) return schedulePromise;
    return import('./season-assets').then((module) => module.loadSeasonSchedule());
  }
  async function resolveRepository(): Promise<SeasonRunRepository> {
    if (repositoryPromise !== null) return repositoryPromise;
    const schedule = await resolveSchedule();
    const module = await import('@hoop-rush/persistence');
    return new module.DexieSeasonRunRepository(undefined, { schedule });
  }
  function emit(event: SeasonRunnerEvent): void {
    for (const listener of [...listeners]) listener(event);
  }
  function consumePreWorkerCancellation(requestId: string, blockIndex: number): boolean {
    if (!cancelledBeforeWorker.delete(requestId)) return false;
    if (currentRequestId === requestId) {
      currentRequestId = null;
      current = null;
    }
    emit({ type: 'cancelled', requestId, blockIndex });
    return true;
  }
  let catalogCache: {
    url: string;
    hash: string;
    catalog: SeasonDraftCatalog;
  } | null = null;
  let catalogInflight: Promise<SeasonDraftCatalog | null> | null = null;
  async function resolveCatalog(input: SeasonBlockStartInput): Promise<SeasonDraftCatalog | null> {
    if (
      catalogCache !== null &&
      catalogCache.url === input.catalogUrl &&
      catalogCache.hash === input.catalogHash
    ) {
      return catalogCache.catalog;
    }
    if (catalogInflight !== null) return catalogInflight;
    catalogInflight = (async () => {
      try {
        const { loadSeasonDraftCatalog } = await import('@hoop-rush/data-contracts');
        const catalog = await loadSeasonDraftCatalog(input.catalogUrl, input.catalogHash);
        catalogCache = { url: input.catalogUrl, hash: input.catalogHash, catalog };
        return catalog;
      } catch {
        return null;
      } finally {
        catalogInflight = null;
      }
    })();
    return catalogInflight;
  }
  function prefetchCommitAssets(input: SeasonBlockStartInput): void {
    void resolveCatalog(input).catch(() => null);
    if (input.blockIndex === 2 || input.blockIndex === 4 || input.blockIndex === 6) {
      void resolveFreeAgencyAssets().catch(() => null);
    }
  }
  let freeAgencyCache: {
    freeAgencyIndex: SeasonFreeAgencyIndex;
    freeAgencyTargets: SeasonRosterTargets;
  } | null = null;
  let freeAgencyInflight: Promise<{
    freeAgencyIndex: SeasonFreeAgencyIndex;
    freeAgencyTargets: SeasonRosterTargets;
  }> | null = null;
  async function resolveFreeAgencyAssets(): Promise<{
    freeAgencyIndex: SeasonFreeAgencyIndex;
    freeAgencyTargets: SeasonRosterTargets;
  }> {
    if (freeAgencyCache !== null) return freeAgencyCache;
    if (freeAgencyInflight !== null) return freeAgencyInflight;
    freeAgencyInflight = (async () => {
      const module = await import('./season-assets');
      const [freeAgencyIndex, freeAgencyTargets] = await Promise.all([
        module.loadSeasonFreeAgencyIndex(),
        module.loadSeasonFreeAgencyTargets(),
      ]);
      freeAgencyCache = { freeAgencyIndex, freeAgencyTargets };
      return freeAgencyCache;
    })();
    try {
      return await freeAgencyInflight;
    } catch (error) {
      freeAgencyInflight = null;
      throw error;
    }
  }
  function createWorker(): Worker {
    if (worker !== null) return worker;
    worker =
      deps.workerUrl !== undefined
        ? new Worker(deps.workerUrl, { type: 'module' })
        : new Worker(new URL('../../workers/season-block-worker.ts', import.meta.url), {
            type: 'module',
          });
    worker.addEventListener('error', (event) => {
      if (warmRequestId !== null) {
        warmRequestId = null;
        if (currentRequestId === null) warmed = false;
      }
      if (currentRequestId === null || current === null) return;
      const requestId = currentRequestId;
      const blockIndex = current.blockIndex;
      emit({
        type: 'error',
        requestId,
        blockIndex,
        code: 'internal',
        message: event.message,
        seed: null,
        gameId: null,
      });
      currentRequestId = null;
      current = null;
    });
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const raw = event.data as
        | {
            type?: unknown;
            requestId?: unknown;
          }
        | null
        | undefined;
      if (typeof raw === 'object' && raw !== null && raw.type === 'season-block-progress') {
        if (raw.requestId !== currentRequestId) {
          console.warn(
            `[season-block-runner] dropped message for stale requestId ${String(raw.requestId)} (expected ${String(currentRequestId)})`,
          );
          return;
        }
        if (current === null) return;
        const progress = raw as {
          requestId: string;
          blockIndex: unknown;
          gamesCompleted: unknown;
          gamesTotal: unknown;
          latestGameId: unknown;
          latestResult: unknown;
        };
        if (
          typeof progress.blockIndex !== 'number' ||
          typeof progress.gamesCompleted !== 'number' ||
          typeof progress.gamesTotal !== 'number' ||
          progress.blockIndex !== current.blockIndex ||
          progress.gamesCompleted < 0 ||
          progress.gamesTotal < 1 ||
          progress.gamesTotal > 150 ||
          progress.gamesCompleted > progress.gamesTotal
        ) {
          const parsed = seasonWorkerMessageSchema.safeParse(event.data);
          if (!parsed.success || parsed.data.type !== 'season-block-progress') {
            console.warn('[season-block-runner] dropped unparsable worker message', event.data);
            return;
          }
          emit({
            type: 'progress',
            requestId: parsed.data.requestId,
            blockIndex: parsed.data.blockIndex,
            gamesCompleted: parsed.data.gamesCompleted,
            gamesTotal: parsed.data.gamesTotal,
            latestGameId: parsed.data.latestGameId,
            latestResult: parsed.data.latestResult,
          });
          return;
        }
        emit({
          type: 'progress',
          requestId: progress.requestId,
          blockIndex: progress.blockIndex,
          gamesCompleted: progress.gamesCompleted,
          gamesTotal: progress.gamesTotal,
          latestGameId: (progress.latestGameId as string | null) ?? null,
          latestResult: (progress.latestResult as SeasonScoreline | null) ?? null,
        });
        return;
      }
      if (typeof raw === 'object' && raw !== null && raw.type === 'season-block-warm-ack') {
        if (raw.requestId === warmRequestId) {
          warmRequestId = null;
          warmed = true;
        }
        return;
      }
      if (
        typeof raw === 'object' &&
        raw !== null &&
        raw.type === 'season-block-error' &&
        raw.requestId === warmRequestId
      ) {
        warmRequestId = null;
        warmed = false;
        return;
      }
      const parsed = seasonWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        console.warn('[season-block-runner] dropped unparsable worker message', event.data);
        return;
      }
      if (parsed.data.type === 'season-block-warm-ack') {
        if (parsed.data.requestId === warmRequestId) warmRequestId = null;
        return;
      }
      if (parsed.data.requestId !== currentRequestId) {
        console.warn(
          `[season-block-runner] dropped message for stale requestId ${parsed.data.requestId} (expected ${String(currentRequestId)})`,
        );
        return;
      }
      const message = parsed.data;
      if (current === null) return;
      if (message.type === 'season-block-progress') {
        emit({
          type: 'progress',
          requestId: message.requestId,
          blockIndex: message.blockIndex,
          gamesCompleted: message.gamesCompleted,
          gamesTotal: message.gamesTotal,
          latestGameId: message.latestGameId,
          latestResult: message.latestResult,
        });
        return;
      }
      if (message.type === 'season-block-error') {
        const requestId = message.requestId;
        const blockIndex = current.blockIndex;
        if (message.code === 'cancelled') {
          emit({ type: 'cancelled', requestId, blockIndex });
        } else {
          emit({
            type: 'error',
            requestId,
            blockIndex,
            code: message.code,
            message: message.message,
            seed: message.seed,
            gameId: message.gameId,
          });
        }
        currentRequestId = null;
        current = null;
        return;
      }
      if (message.result.status === 'interrupted') {
        void acceptInterruption(message.result.pending);
        return;
      }
      void acceptCandidate(message.result.checkpoint);
    });
    return worker;
  }
  function assertExpectedState(
    checkpoint: SeasonCandidateCheckpoint,
    input: SeasonBlockStartInput,
    failures: string[],
  ): void {
    if (checkpoint.expectedStateRevision !== input.run.stateRevision) {
      failures.push(
        `candidate expectedStateRevision ${String(checkpoint.expectedStateRevision)} does not match the run state ${String(input.run.stateRevision)}`,
      );
    }
    if (checkpoint.expectedStateDigest !== input.run.stateDigest) {
      failures.push('candidate expectedStateDigest does not match the run state');
    }
  }
  async function acceptCandidate(checkpoint: SeasonCandidateCheckpoint): Promise<void> {
    const requestId = currentRequestId;
    const state = current;
    if (requestId === null || state === null) return;
    const failures: string[] = [];
    if (seasonCheckpointDigest(checkpoint) !== checkpoint.digest) {
      failures.push('candidate digest does not verify');
    }
    if (checkpoint.runId !== state.input.run.runId) failures.push('candidate runId mismatch');
    if (checkpoint.blockIndex !== state.blockIndex) failures.push('candidate blockIndex mismatch');
    if (checkpoint.revision !== state.expectedRevision) {
      failures.push('candidate revision does not match expectedRevision');
    }
    if (checkpoint.rotationDigest !== state.rotationDigest) {
      failures.push('candidate rotationDigest mismatch');
    }
    assertExpectedState(checkpoint, state.input, failures);
    if (failures.length > 0) {
      emit({
        type: 'error',
        requestId,
        blockIndex: state.blockIndex,
        code: 'invariant-failure',
        message: failures.join('; '),
        seed: state.input.run.rootSeed,
        gameId: null,
      });
      currentRequestId = null;
      current = null;
      return;
    }
    try {
      const repository = await resolveRepository();
      const authoritative = { ...checkpoint, freeAgency: state.input.run.freeAgency };
      const catalog = await resolveCatalog(state.input);
      const freeAgencyAssets =
        state.blockIndex === 2 || state.blockIndex === 4 || state.blockIndex === 6
          ? await resolveFreeAgencyAssets()
          : null;
      const committed = completeSeasonBlockCommit({
        run: { ...state.input.run, rotations: state.rotations },
        candidate: authoritative,
        commandId: state.commandId,
        rotationDigest: state.rotationDigest,
        humanFranchiseId: state.input.humanFranchiseId,
        catalog: catalog ?? undefined,
        effects: checkpoint.effects,
        freeAgencyIndex: freeAgencyAssets?.freeAgencyIndex,
        freeAgencyTargets: freeAgencyAssets?.freeAgencyTargets,
      });
      const window: SeasonWindowOpenResult | null = committed.window;
      const retainedDetails = [
        ...(state.resumePending?.retainedDetails ?? []),
        ...dedupeNewByGameId(
          state.resumePending?.retainedDetails ?? [],
          checkpoint.retainedDetails,
        ),
      ];
      const objectives = objectivesWithSuccess(state.input.run, authoritative);
      const campaign =
        (
          committed as unknown as {
            campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState | null;
          }
        ).campaign ?? null;
      await repository.commitSeasonBlock({
        runId: authoritative.runId,
        revision: authoritative.revision + 1,
        commandId: state.commandId,
        rotationDigest: authoritative.rotationDigest,
        checkpointDigest: authoritative.digest,
        completedRounds: authoritative.completedRounds,
        standings: authoritative.standings,
        teamAggregates: authoritative.teamAggregates,
        playerAggregates: authoritative.playerAggregates,
        summaries: authoritative.gameSummaries,
        retainedDetails,
        recap: authoritative.recap,
        rotations: state.rotations,
        effects: window !== null ? window.effects : authoritative.effects,
        freeAgency: committed.freeAgency,
        health: authoritative.health,
        transactions: window !== null ? window.transactions : authoritative.transactions,
        influence: window !== null ? window.influence : authoritative.influence,
        trade: window !== null ? window.trade : state.input.run.trade,
        objectives,
        campaign,
        checkpointState: committed.checkpointState,
        stateRevision: committed.stateRevision,
        stateDigest: committed.stateDigest,
        expectedStateRevision: state.input.run.stateRevision,
        expectedStateDigest: state.input.run.stateDigest,
        window,
      });
      const priorSummaries = runState?.runId === checkpoint.runId ? runState.summaries : [];
      const priorAcceptedBlocks = runState?.runId === checkpoint.runId ? runState.blocks : [];
      const priorRetainedDetails =
        runState?.runId === checkpoint.runId ? runState.retainedDetails : [];
      if (runState === null || runState.runId !== checkpoint.runId) {
        runState = {
          runId: checkpoint.runId,
          revision: checkpoint.revision,
          completedRounds: checkpoint.completedRounds,
          commandIds: new Set(),
          summaries: [],
          blocks: [],
          retainedDetails: [],
          effects: checkpoint.effects,
          health: checkpoint.health,
          stateRevision: state.input.run.stateRevision,
          stateDigest: state.input.run.stateDigest,
        };
      }
      runState.revision = checkpoint.revision + 1;
      runState.completedRounds = checkpoint.completedRounds;
      runState.commandIds.add(state.commandId);
      runState.summaries = [...runState.summaries, ...checkpoint.gameSummaries];
      runState.effects = window !== null ? window.effects : checkpoint.effects;
      runState.health = window !== null ? window.health : checkpoint.health;
      runState.stateRevision = committed.stateRevision;
      runState.stateDigest = committed.stateDigest;
      workerSummaryRunId = checkpoint.runId;
      workerSummaryCount = runState.summaries.length;
      workerRosterKey = rosterKeyOf(state.input.run.rosters);
      const snapshot = assembleCommittedSnapshot({
        run: state.input.run,
        rotations: state.rotations,
        checkpoint: authoritative,
        commandId: state.commandId,
        rotationDigest: state.rotationDigest,
        window,
        freeAgency: committed.freeAgency,
        campaign,
        checkpointState: committed.checkpointState,
        stateRevision: committed.stateRevision,
        stateDigest: committed.stateDigest,
        schedule: await resolveSchedule(),
        priorSummaries,
        priorAcceptedBlocks,
        priorRetainedDetails,
      });
      emit({ type: 'complete', requestId, checkpoint: authoritative, snapshot });
    } catch (error) {
      emit({
        type: 'error',
        requestId,
        blockIndex: state.blockIndex,
        code: 'internal',
        message: `checkpoint commit failed: ${error instanceof Error ? error.message : String(error)}`,
        seed: state.input.run.rootSeed,
        gameId: null,
      });
    } finally {
      currentRequestId = null;
      current = null;
    }
  }
  async function acceptInterruption(pending: SeasonPendingBlockCandidate): Promise<void> {
    const requestId = currentRequestId;
    const state = current;
    if (requestId === null || state === null) return;
    try {
      if (pending.runId !== state.input.run.runId) {
        throw new Error('pending candidate runId mismatch');
      }
      if (pending.blockIndex !== state.blockIndex) {
        throw new Error('pending candidate blockIndex mismatch');
      }
      if (pending.commandId !== state.commandId) {
        throw new Error('pending candidate commandId mismatch');
      }
      if (pending.expectedRevision !== state.expectedRevision) {
        throw new Error('pending candidate expectedRevision mismatch');
      }
      if (pending.rotationDigest !== state.rotationDigest) {
        throw new Error('pending candidate rotationDigest mismatch');
      }
      if (state.input.humanFranchiseId === null) {
        throw new Error('invalid-roster interruption without a human franchise');
      }
      const availability = seasonFranchiseLegalFiveFacts(
        state.input.run,
        state.input.humanFranchiseId,
        pending.health,
      );
      const interruption: SeasonInvalidRosterInterruption = {
        code: 'invalid-roster',
        runId: pending.runId,
        blockIndex: pending.blockIndex,
        commandId: pending.commandId,
        nextGameId: pending.nextGameId,
        humanFranchiseId: franchiseIdSchema.parse(state.input.humanFranchiseId),
        unavailablePlayerVersionIds: availability.unavailablePlayerVersionIds,
      };
      const repository = await resolveRepository();
      await repository.savePendingBlock(pending, interruption);
      emit({
        type: 'interrupted',
        requestId,
        runId: pending.runId,
        blockIndex: pending.blockIndex,
        pending,
        interruption,
      });
    } catch (error) {
      emit({
        type: 'error',
        requestId,
        blockIndex: state.blockIndex,
        code: 'internal',
        message: `interruption persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        seed: state.input.run.rootSeed,
        gameId: null,
      });
    } finally {
      currentRequestId = null;
      current = null;
    }
  }
  function buildRequest(
    requestId: string,
    state: NonNullable<typeof current>,
    schedule: SeasonSchedule,
    artifacts: SeasonArtifactUrls,
  ): SeasonWorkerStartRequest | SeasonWorkerContinueRequest {
    const summaries = runState?.runId === state.input.run.runId ? runState.summaries : [];
    const rosterKey = rosterKeyOf(state.input.run.rosters);
    const workerContextMatches =
      workerSummaryRunId === state.input.run.runId && workerRosterKey === rosterKey;
    let priorSummaries: SeasonGameSummary[] | undefined;
    let newSummaries: SeasonGameSummary[] | undefined;
    if (state.resumePending !== null) {
      const partial = state.resumePending.summaries;
      if (workerContextMatches && workerSummaryCount <= summaries.length) {
        newSummaries = partial;
      } else {
        priorSummaries = [...summaries, ...partial];
      }
    } else if (workerContextMatches && workerSummaryCount <= summaries.length) {
      const delta = summaries.slice(workerSummaryCount);
      if (delta.length <= 600) {
        newSummaries = delta;
      } else {
        priorSummaries = summaries;
      }
    } else {
      priorSummaries = summaries;
    }
    const plainRotations = state.rotations;
    const plainCommon = {
      requestId,
      runId: state.input.run.runId,
      rootSeed: state.input.run.rootSeed,
      blockIndex: state.blockIndex,
      expectedRevision: state.expectedRevision,
      rotationDigest: state.rotationDigest,
      commandId: state.commandId,
      catalogUrl: artifacts.catalogUrl,
      catalogHash: artifacts.catalogHash,
      profileUrl: artifacts.profileUrl,
      profileHash: artifacts.profileHash,
      ...(priorSummaries !== undefined ? { priorSummaries } : {}),
      ...(newSummaries !== undefined ? { newSummaries } : {}),
      ...(state.resumePending !== null
        ? { priorEffects: state.resumePending.effects }
        : priorSummaries !== undefined
          ? { priorEffects: state.input.effects }
          : {}),
      ...(state.resumePending !== null
        ? { priorHealth: state.resumePending.health }
        : priorSummaries !== undefined
          ? { priorHealth: state.input.run.health }
          : {}),
      startGameId: state.resumePending?.nextGameId ?? null,
      objectiveId: state.input.objectiveId,
      campaignOpportunityId: state.input.campaignOpportunityId ?? null,
      priorInfluence: state.input.run.influence,
      priorTransactions: state.input.run.transactions,
      expectedStateRevision: state.input.run.stateRevision,
      expectedStateDigest: state.input.run.stateDigest,
      humanFranchiseId: state.input.humanFranchiseId,
    };
    if (newSummaries !== undefined) {
      return seasonWorkerContinueRequestSchema.parse({
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-continue',
        rotations: plainRotations,
        ...plainCommon,
      });
    }
    return seasonWorkerStartRequestSchema.parse({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-start',
      run: {
        schemaVersion: state.input.run.schemaVersion,
        runId: state.input.run.runId,
        rootSeed: state.input.run.rootSeed,
        versions: state.input.run.versions,
        league: state.input.run.league,
        rosters: state.input.run.rosters,
        rotations: state.rotations,
        cursor: state.input.run.cursor,
      },
      schedule,
      homeCourt: state.input.homeCourt,
      ...plainCommon,
    });
  }
  return {
    startBlock(input: SeasonBlockStartInput): string {
      if (currentRequestId !== null) {
        throw new Error('a season block is already running; cancel it first');
      }
      const requestId = `sb-${randomUUID()}`;
      currentRequestId = requestId;
      current = {
        blockIndex: input.blockIndex,
        expectedRevision: input.expectedRevision,
        rotationDigest: input.rotationDigest,
        commandId: input.commandId,
        rotations: input.rotations,
        input,
        resumePending: null,
      };
      prefetchCommitAssets(input);
      void (async () => {
        try {
          const [repository, schedule, artifacts] = await Promise.all([
            resolveRepository(),
            resolveSchedule(),
            deps.artifacts !== undefined
              ? deps.artifacts()
              : import('./season-assets').then((module) => module.seasonArtifactUrls()),
          ]);
          if (consumePreWorkerCancellation(requestId, input.blockIndex)) return;
          if (currentRequestId !== requestId) return;
          if (
            runState === null ||
            runState.runId !== input.run.runId ||
            input.expectedRevision !== runState.revision
          ) {
            const snapshot = await repository.loadActiveRun();
            if (snapshot === null) throw new Error('no active season run to advance');
            if (snapshot.run.runId !== input.run.runId) {
              throw new Error('the active run does not match the submitted run');
            }
            const persistedRevision = snapshot.acceptedBlocks.length;
            if (
              runState !== null &&
              runState.runId === input.run.runId &&
              input.expectedRevision !== persistedRevision
            ) {
              throw new Error(
                `stale cursor: the run is at revision ${String(persistedRevision)}, command expects ${String(input.expectedRevision)}`,
              );
            }
            runState = {
              runId: snapshot.run.runId,
              revision: persistedRevision,
              completedRounds: snapshot.run.cursor.completedRounds,
              commandIds: new Set(snapshot.acceptedBlocks.map((block) => block.commandId)),
              summaries: snapshot.summaries,
              blocks: [...snapshot.acceptedBlocks],
              retainedDetails: [...snapshot.retainedDetails],
              effects: snapshot.effects,
              health: snapshot.run.health,
              stateRevision: snapshot.run.stateRevision,
              stateDigest: snapshot.run.stateDigest,
            };
          }
          const revision = runState.revision;
          if (input.expectedRevision !== revision) {
            throw new Error(
              `stale cursor: the run is at revision ${String(revision)}, command expects ${String(input.expectedRevision)}`,
            );
          }
          if (runState.commandIds.has(input.commandId)) {
            throw new Error(`duplicate command ${input.commandId}`);
          }
          const next = seasonNextBlockIndex(runState.completedRounds);
          if (next === null || next !== input.blockIndex) {
            throw new Error(
              `non-boundary block: the run expects ${String(next)}, command submits ${String(input.blockIndex)}`,
            );
          }
          if (seasonRotationSetDigest(input.rotations) !== input.rotationDigest) {
            throw new Error('rotation digest does not match the submitted rotations');
          }
          if (consumePreWorkerCancellation(requestId, input.blockIndex)) return;
          if (currentRequestId !== requestId) return;
          const plainStart = buildRequest(requestId, current, schedule, artifacts);
          const target = createWorker();
          target.postMessage(plainStart);
          warmed = true;
          emit({ type: 'started', requestId, blockIndex: input.blockIndex });
        } catch (error) {
          if (consumePreWorkerCancellation(requestId, input.blockIndex)) return;
          if (currentRequestId !== requestId) return;
          emit({
            type: 'error',
            requestId,
            blockIndex: input.blockIndex,
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            seed: input.run.rootSeed,
            gameId: null,
          });
          currentRequestId = null;
          current = null;
        }
      })();
      return requestId;
    },
    resumeBlock(input: SeasonBlockResumeInput): string {
      if (currentRequestId !== null) {
        throw new Error('a season block is already running; cancel it first');
      }
      const requestId = `sb-${randomUUID()}`;
      currentRequestId = requestId;
      void (async () => {
        try {
          const [repository, schedule, artifacts] = await Promise.all([
            resolveRepository(),
            resolveSchedule(),
            deps.artifacts !== undefined
              ? deps.artifacts()
              : import('./season-assets').then((module) => module.seasonArtifactUrls()),
          ]);
          if (consumePreWorkerCancellation(requestId, input.blockIndex)) return;
          if (currentRequestId !== requestId) return;
          const snapshot = await repository.loadActiveRun();
          if (snapshot === null) throw new Error('no active season run to resume');
          if (snapshot.run.runId !== input.runId) {
            throw new Error('the active run does not match the resume request');
          }
          const pending = await repository.loadPendingBlock(input.runId);
          if (pending === null) {
            throw new Error(`no pending block for run ${input.runId}`);
          }
          if (pending.blockIndex !== input.blockIndex) {
            throw new Error(
              `pending blockIndex ${String(pending.blockIndex)} does not match resume ${String(input.blockIndex)}`,
            );
          }
          if (pending.expectedRevision !== input.expectedRevision) {
            throw new Error('pending expectedRevision does not match the resume request');
          }
          if (pending.rotationDigest !== input.rotationDigest) {
            throw new Error('pending rotationDigest does not match the resume request');
          }
          if (runState === null || runState.runId !== snapshot.run.runId) {
            runState = {
              runId: snapshot.run.runId,
              revision: snapshot.acceptedBlocks.length,
              completedRounds: snapshot.run.cursor.completedRounds,
              commandIds: new Set(snapshot.acceptedBlocks.map((block) => block.commandId)),
              summaries: snapshot.summaries,
              blocks: [...snapshot.acceptedBlocks],
              retainedDetails: [...snapshot.retainedDetails],
              effects: snapshot.effects,
              health: snapshot.run.health,
              stateRevision: snapshot.run.stateRevision,
              stateDigest: snapshot.run.stateDigest,
            };
          }
          const startInput: SeasonBlockStartInput = {
            run: snapshot.run,
            effects: snapshot.effects,
            rotations: input.rotations,
            blockIndex: input.blockIndex,
            expectedRevision: input.expectedRevision,
            rotationDigest: input.rotationDigest,
            commandId: input.commandId,
            humanFranchiseId: input.humanFranchiseId,
            objectiveId: pending.objectiveId ?? null,
            campaignOpportunityId:
              (
                pending as unknown as {
                  campaignOpportunityId?: string | null;
                }
              ).campaignOpportunityId ?? null,
            homeCourt: input.homeCourt,
            catalogUrl: input.catalogUrl,
            catalogHash: input.catalogHash,
            profileUrl: input.profileUrl,
            profileHash: input.profileHash,
          };
          if (consumePreWorkerCancellation(requestId, input.blockIndex)) return;
          if (currentRequestId !== requestId) return;
          current = {
            blockIndex: input.blockIndex,
            expectedRevision: input.expectedRevision,
            rotationDigest: input.rotationDigest,
            commandId: input.commandId,
            rotations: input.rotations,
            input: startInput,
            resumePending: pending,
          };
          const plainStart = buildRequest(requestId, current, schedule, artifacts);
          const target = createWorker();
          target.postMessage(plainStart);
          warmed = true;
          emit({ type: 'started', requestId, blockIndex: input.blockIndex });
        } catch (error) {
          if (consumePreWorkerCancellation(requestId, input.blockIndex)) return;
          if (currentRequestId !== requestId) return;
          emit({
            type: 'error',
            requestId,
            blockIndex: input.blockIndex,
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            seed: null,
            gameId: null,
          });
          currentRequestId = null;
          current = null;
        }
      })();
      return requestId;
    },
    cancel(requestId: string): void {
      if (requestId !== currentRequestId) return;
      if (worker === null) {
        cancelledBeforeWorker.add(requestId);
        return;
      }
      worker.postMessage(
        seasonWorkerCancelRequestSchema.parse({
          schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
          type: 'season-block-cancel',
          requestId,
        }),
      );
    },
    terminate(): void {
      worker?.terminate();
      worker = null;
      currentRequestId = null;
      current = null;
      cancelledBeforeWorker.clear();
      warmRequestId = null;
      warmed = false;
      workerSummaryRunId = null;
      workerSummaryCount = 0;
      workerRosterKey = null;
    },
    prewarm(): void {
      if (currentRequestId !== null || warmed || warmRequestId !== null) return;
      const pendingWarmId = `warm-${randomUUID()}`;
      warmRequestId = pendingWarmId;
      void (async () => {
        try {
          const artifacts =
            deps.artifacts !== undefined
              ? await deps.artifacts()
              : await import('./season-assets').then((module) => module.seasonArtifactUrls());
          if (requestActive()) {
            if (warmRequestId === pendingWarmId) warmRequestId = null;
            return;
          }
          const target = createWorker();
          target.postMessage(
            seasonWorkerWarmRequestSchema.parse({
              schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
              type: 'season-block-warm',
              requestId: pendingWarmId,
              catalogUrl: artifacts.catalogUrl,
              catalogHash: artifacts.catalogHash,
              profileUrl: artifacts.profileUrl,
              profileHash: artifacts.profileHash,
            }),
          );
          warmed = true;
        } catch {
          if (warmRequestId === pendingWarmId) warmRequestId = null;
        }
      })();
    },
    subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
function dedupeByGameId(details: SeasonRetainedGameDetail[]): SeasonRetainedGameDetail[] {
  const seen = new Set<string>();
  const result: SeasonRetainedGameDetail[] = [];
  for (const detail of details) {
    if (seen.has(detail.gameId)) continue;
    seen.add(detail.gameId);
    result.push(detail);
  }
  return result;
}
function dedupeNewByGameId(
  prior: readonly SeasonRetainedGameDetail[],
  incoming: readonly SeasonRetainedGameDetail[],
): SeasonRetainedGameDetail[] {
  if (prior.length === 0) return dedupeByGameId([...incoming]);
  const seen = new Set<string>();
  for (const detail of prior) seen.add(detail.gameId);
  const result: SeasonRetainedGameDetail[] = [];
  for (const detail of incoming) {
    if (seen.has(detail.gameId)) continue;
    seen.add(detail.gameId);
    result.push(detail);
  }
  return result;
}
function isSortedByGameId(items: readonly { gameId: string }[]): boolean {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1];
    const curr = items[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.gameId > curr.gameId) return false;
  }
  return true;
}
function mergeSortedSummaries(
  prior: readonly SeasonGameSummary[],
  next: readonly SeasonGameSummary[],
): SeasonGameSummary[] {
  if (prior.length === 0) return [...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  if (next.length === 0) return [...prior];
  if (!isSortedByGameId(prior))
    return [...prior, ...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const sortedNext = [...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const result: SeasonGameSummary[] = [];
  let i = 0;
  let j = 0;
  while (i < prior.length && j < sortedNext.length) {
    const a = prior[i];
    const b = sortedNext[j];
    if (a === undefined || b === undefined) break;
    if (a.gameId <= b.gameId) {
      const last = result[result.length - 1];
      if (last === undefined || last.gameId !== a.gameId) result.push(a);
      i += 1;
    } else {
      const last = result[result.length - 1];
      if (last === undefined || last.gameId !== b.gameId) result.push(b);
      j += 1;
    }
  }
  while (i < prior.length) {
    const a = prior[i];
    if (a === undefined) break;
    const last = result[result.length - 1];
    if (last === undefined || last.gameId !== a.gameId) result.push(a);
    i += 1;
  }
  while (j < sortedNext.length) {
    const b = sortedNext[j];
    if (b === undefined) break;
    const last = result[result.length - 1];
    if (last === undefined || last.gameId !== b.gameId) result.push(b);
    j += 1;
  }
  return result;
}
function mergeSortedDetails(
  prior: readonly SeasonRetainedGameDetail[],
  next: readonly SeasonRetainedGameDetail[],
): SeasonRetainedGameDetail[] {
  if (prior.length === 0) return [...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  if (next.length === 0) return [...prior];
  if (!isSortedByGameId(prior))
    return [...prior, ...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const sortedNext = [...next].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const result: SeasonRetainedGameDetail[] = [];
  let i = 0;
  let j = 0;
  while (i < prior.length && j < sortedNext.length) {
    const a = prior[i];
    const b = sortedNext[j];
    if (a === undefined || b === undefined) break;
    if (a.gameId <= b.gameId) {
      const last = result[result.length - 1];
      if (last === undefined || last.gameId !== a.gameId) result.push(a);
      i += 1;
    } else {
      const last = result[result.length - 1];
      if (last === undefined || last.gameId !== b.gameId) result.push(b);
      j += 1;
    }
  }
  while (i < prior.length) {
    const a = prior[i];
    if (a === undefined) break;
    const last = result[result.length - 1];
    if (last === undefined || last.gameId !== a.gameId) result.push(a);
    i += 1;
  }
  while (j < sortedNext.length) {
    const b = sortedNext[j];
    if (b === undefined) break;
    const last = result[result.length - 1];
    if (last === undefined || last.gameId !== b.gameId) result.push(b);
    j += 1;
  }
  return result;
}
export function assembleCommittedSnapshot(input: {
  run: SeasonRun;
  rotations: SeasonRotation[];
  checkpoint: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  window: SeasonWindowOpenResult | null;
  freeAgency: SeasonFreeAgencyState;
  campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState | null;
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  schedule: SeasonSchedule;
  priorSummaries: SeasonGameSummary[];
  priorAcceptedBlocks: SeasonAcceptedBlock[];
  priorRetainedDetails: SeasonRetainedGameDetail[];
}): SeasonRunSnapshot {
  const { run, rotations, checkpoint, window, schedule } = input;
  const objectives = objectivesWithSuccess(run, checkpoint);
  const campaign =
    (
      input as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState | null;
      }
    ).campaign ??
    (
      run as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState | null;
      }
    ).campaign ??
    null;
  const postCommitRun: SeasonRun = {
    ...run,
    rosters: window !== null ? window.rosters : run.rosters,
    ownership: window !== null ? window.ownership : run.ownership,
    rotations: window !== null ? window.rotations : rotations,
    cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
    standings: checkpoint.standings,
    health: window !== null ? window.health : checkpoint.health,
    influence: window !== null ? window.influence : checkpoint.influence,
    transactions: window !== null ? window.transactions : checkpoint.transactions,
    trade: window !== null ? window.trade : run.trade,
    freeAgency: input.freeAgency,
    objectives,
    campaign: campaign as unknown as SeasonRun['campaign'],
    checkpointState: input.checkpointState,
    stateRevision: input.stateRevision,
    stateDigest: input.stateDigest,
  };
  const newDetails = dedupeNewByGameId(input.priorRetainedDetails, checkpoint.retainedDetails);
  const summaries = mergeSortedSummaries(input.priorSummaries, checkpoint.gameSummaries);
  const retainedDetails = mergeSortedDetails(input.priorRetainedDetails, newDetails);
  const acceptedBlock = seasonAcceptedBlockSchema.parse({
    runId: checkpoint.runId,
    blockIndex: checkpoint.blockIndex,
    completedRounds: checkpoint.completedRounds,
    revision: checkpoint.revision + 1,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    checkpointDigest: checkpoint.digest,
    summaryCount: checkpoint.gameSummaries.length,
    stateRevision: input.stateRevision,
    stateDigest: input.stateDigest,
  });
  return {
    run: { ...postCommitRun, games: reconstructSeasonGames(schedule, summaries) },
    summaries,
    retainedDetails,
    acceptedBlocks: [...input.priorAcceptedBlocks, acceptedBlock],
    effects: window !== null ? window.effects : checkpoint.effects,
  };
}
function objectivesWithSuccess(
  run: SeasonRun,
  checkpoint: SeasonCandidateCheckpoint,
): SeasonObjectiveState {
  if (checkpoint.blockIndex === 8) return run.objectives;
  const selection = run.objectives.selections[checkpoint.blockIndex];
  if (selection === undefined) return run.objectives;
  return {
    ...run.objectives,
    selections: {
      ...run.objectives.selections,
      [checkpoint.blockIndex]: { ...selection, success: checkpoint.objective.success },
    },
  };
}
export function getSeasonBlockRunner(): SeasonBlockRunner {
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_SEASON_BLOCK_RUNNER__) {
    return window.__HOOP_RUSH_SEASON_BLOCK_RUNNER__;
  }
  if (runnerSingleton === null) {
    runnerSingleton = createSeasonBlockRunner();
  }
  return runnerSingleton;
}
let runnerSingleton: SeasonBlockRunner | null = null;
declare global {
  interface Window {
    __HOOP_RUSH_SEASON_BLOCK_RUNNER__?: SeasonBlockRunner;
  }
}
