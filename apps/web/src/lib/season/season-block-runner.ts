import type {
  SeasonCandidateCheckpoint,
  SeasonDraftCatalog,
  SeasonEffectsState,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonHomeCourtProfile,
  SeasonInvalidRosterInterruption,
  SeasonObjectiveId,
  SeasonObjectiveState,
  SeasonPendingBlockCandidate,
  SeasonRetainedGameDetail,
  SeasonRotation,
  SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  seasonWorkerCancelRequestSchema,
  seasonWorkerContinueRequestSchema,
  seasonWorkerMessageSchema,
  seasonWorkerStartRequestSchema,
  type SeasonScoreline,
  type SeasonWorkerContinueRequest,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  completeSeasonBlockCommit,
  seasonCheckpointDigest,
  seasonFranchiseLegalFiveFacts,
  seasonNextBlockIndex,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';
import type { SeasonRunRepository, SeasonWindowOpenResult } from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import type { SeasonArtifactUrls } from './season-assets';

/**
 * Season block runner contract (spec/2.0/07 background execution, M2.3,
 * M2.5). The main-thread runner owns request ids, stale-message rejection,
 * cancellation/termination, validation, canonical acceptance, and
 * persistence. Cancelled or crashed work must leave the accepted checkpoint
 * untouched; unfinished work is discarded and deterministically reproduced
 * on the next run. The UI imports these types and reacts to runner events;
 * the implementation lives in `season-block-runner.ts` and speaks to the
 * `season-block-worker.ts` entry point through the frozen worker envelopes.
 *
 * M2.5: the complete message is a union â€” `committed` carries the candidate
 * checkpoint, `interrupted` carries the uncommitted pending candidate of an
 * `invalid-roster` interruption. The runner persists interrupted work
 * through `savePendingBlock` and emits a typed `interrupted` event;
 * `resumeBlock` reloads the pending candidate and re-ships it to the worker
 * (`startGameId` = next game, partial summaries as the accumulator seed,
 * pending effects/health as the reset) so the block resumes without
 * replaying completed games. 'complete' is emitted only for committed
 * blocks.
 *
 * ## M2.5 SEAMS awaiting the engine workstreams
 *
 * - `completeSeasonBlockCommit({ run, candidate, commandId, rotationDigest,
 *   humanFranchiseId })` â€” engine-owned (health workstream; the lead wires
 *   the export). Produces the post-block `checkpointState`, `stateRevision`,
 *   `stateDigest`, and the optional trade-window open.
 * - `seasonFranchiseLegalFiveFacts(run, franchiseId, health)` â€” engine-owned
 *   (health workstream). The runner reconstructs the typed interruption's
 *   `unavailablePlayerVersionIds` from the pending health at save time.
 */

export type SeasonRunnerEvent =
  | { type: 'started'; requestId: string; blockIndex: number }
  | {
      type: 'progress';
      requestId: string;
      blockIndex: number;
      gamesCompleted: number;
      gamesTotal: number;
      latestGameId: string | null;
      latestResult: SeasonScoreline | null;
    }
  | { type: 'complete'; requestId: string; checkpoint: SeasonCandidateCheckpoint }
  | {
      type: 'interrupted';
      requestId: string;
      runId: string;
      blockIndex: number;
      pending: SeasonPendingBlockCandidate;
      interruption: SeasonInvalidRosterInterruption;
    }
  | { type: 'cancelled'; requestId: string; blockIndex: number }
  | {
      type: 'error';
      requestId: string;
      blockIndex: number;
      code: 'invariant-failure' | 'cancelled' | 'internal';
      message: string;
      seed: string | null;
      gameId: string | null;
    };

/** Everything the runner needs to start one block on the worker. */
export interface SeasonBlockStartInput {
  /** Validated run snapshot (league, rosters, schedule reference, seeds). */
  run: SeasonRun;
  /** The 30 rotations locked for this block (pending, not yet committed). */
  rotations: SeasonRotation[];
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: string;
  /** Human franchise (retained detail policy); null in pure AI contexts. */
  humanFranchiseId: string | null;
  /**
   * M2.5: the locked block objective (blocks 0-7), or null for the final
   * two-game block 8. Must have been selected and offered for this block.
   */
  objectiveId: SeasonObjectiveId | null;
  homeCourt: SeasonHomeCourtProfile;
  /** Packaged draft catalog asset (manifest-verified). */
  catalogUrl: string;
  catalogHash: string;
  /** Packaged era simulation profile asset (manifest-verified). */
  profileUrl: string;
  profileHash: string;
}

/** Everything the runner needs to resume an interrupted block (M2.5). */
export interface SeasonBlockResumeInput {
  runId: string;
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  /** The SAME command id as the interrupted submission (idempotency). */
  commandId: string;
  /** The 30 rotations locked at submission (never change mid-block). */
  rotations: SeasonRotation[];
  /** Human franchise (retained detail policy); null in pure AI contexts. */
  humanFranchiseId: string | null;
  homeCourt: SeasonHomeCourtProfile;
  /** Packaged draft catalog asset (manifest-verified). */
  catalogUrl: string;
  catalogHash: string;
  /** Packaged era simulation profile asset (manifest-verified). */
  profileUrl: string;
  profileHash: string;
}

export interface SeasonBlockRunner {
  /** Starts a block; returns the request id for cancel/terminate routing. */
  startBlock(input: SeasonBlockStartInput): string;
  /**
   * M2.5: resumes an interrupted block from its persisted pending candidate
   * (validated: runId, blockIndex, expectedRevision, rotationDigest);
   * returns the request id for cancel/terminate routing.
   */
  resumeBlock(input: SeasonBlockResumeInput): string;
  /** Requests cancellation; the worker stops between games. */
  cancel(requestId: string): void;
  /** Immediately tears down the worker (route change / full abort). */
  terminate(): void;
  /** Subscribes to runner events; returns an unsubscribe function. */
  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void;
}

/** @internal Factory dependencies for tests and the e2e seam. */
export interface SeasonBlockRunnerDeps {
  repository?: SeasonRunRepository;
  schedule?: SeasonSchedule;
  /** Overrides the packaged worker entry (tests). */
  workerUrl?: string;
  /** Overrides asset resolution (tests). */
  artifacts?: () => Promise<SeasonArtifactUrls>;
}

/**
 * Main-thread block runner (spec/2.0/07 background execution, M2.3, M2.5).
 * Owns request ids, stale-message rejection, cancellation/termination,
 * boundary validation against the accepted snapshot, canonical acceptance
 * (schema, digest, cursor facts, expected state facts), and the atomic
 * checkpoint commit. The worker returns one candidate; this runner accepts
 * it only after every check, then commits it in one IndexedDB transaction.
 * Cancelled or crashed work leaves the accepted checkpoint untouched:
 * nothing is persisted before acceptance. M2.5 interruptions are persisted
 * as pending candidates (never as accepted checkpoints) and resumed through
 * `resumeBlock`.
 */
export function createSeasonBlockRunner(deps: SeasonBlockRunnerDeps = {}): SeasonBlockRunner {
  const listeners = new Set<(event: SeasonRunnerEvent) => void>();
  let worker: Worker | null = null;
  let currentRequestId: string | null = null;
  let current: {
    blockIndex: number;
    expectedRevision: number;
    rotationDigest: string;
    commandId: string;
    rotations: SeasonRotation[];
    input: SeasonBlockStartInput;
    /** M2.5: the pending candidate a resumed block continues from. */
    resumePending: SeasonPendingBlockCandidate | null;
  } | null = null;

  /**
   * Authoritative cursor state for the active run, kept in memory after every
   * accepted commit so block starts validate without a full repository load
   * and reconciliation audit. Keyed by runId: the first block after a page
   * reload (or a new run) loads once from the repository, and the guarded
   * IndexedDB commit still rejects revision regressions and duplicate
   * command ids atomically.
   */
  let runState: {
    runId: string;
    revision: number;
    completedRounds: number;
    commandIds: Set<string>;
    summaries: SeasonGameSummary[];
    /** M2.4: the authoritative pre-block effects state for the next block. */
    effects: SeasonEffectsState | null;
    /** M2.5: the authoritative pre-block health state for the next block. */
    health: SeasonHealthState | null;
    /** M2.5: the run state chain facts at the last accepted boundary. */
    stateRevision: number;
    stateDigest: string;
  } | null = null;
  /** The compact summaries the live worker already holds (per run). */
  let workerSummaryRunId: string | null = null;
  let workerSummaryCount = 0;

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

  /**
   * M2.5: the packaged draft catalog the commit path needs to open trade
   * windows (value bands, legality). The worker fetches its own copy; the
   * runner caches one per asset url/hash.
   */
  let catalogCache: { url: string; hash: string; catalog: SeasonDraftCatalog } | null = null;
  async function resolveCatalog(input: SeasonBlockStartInput): Promise<SeasonDraftCatalog | null> {
    if (
      catalogCache !== null &&
      catalogCache.url === input.catalogUrl &&
      catalogCache.hash === input.catalogHash
    ) {
      return catalogCache.catalog;
    }
    try {
      const { loadSeasonDraftCatalog } = await import('@hoop-rush/data-contracts');
      const catalog = await loadSeasonDraftCatalog(input.catalogUrl, input.catalogHash);
      catalogCache = { url: input.catalogUrl, hash: input.catalogHash, catalog };
      return catalog;
    } catch {
      return null;
    }
  }

  function createWorker(): Worker {
    if (worker !== null) return worker;
    // Vite bundles `new Worker(new URL(...))` only when the URL literal is
    // statically visible in the `new Worker` call; a variable indirection
    // would emit the source .ts as a raw asset and the worker would fail to
    // load in production builds.
    worker =
      deps.workerUrl !== undefined
        ? new Worker(deps.workerUrl, { type: 'module' })
        : new Worker(new URL('../../workers/season-block-worker.ts', import.meta.url), {
            type: 'module',
          });
    worker.addEventListener('error', (event) => {
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
      const parsed = seasonWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.requestId !== currentRequestId) return;
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

  /** M2.5: validates the submitted run state facts match the candidate. */
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

  /** M2.5: folds the block's evaluated objective success into the run's selections. */
  function objectivesWithSuccess(
    input: SeasonBlockStartInput,
    checkpoint: SeasonCandidateCheckpoint,
  ): SeasonObjectiveState {
    if (checkpoint.blockIndex === 8) return input.run.objectives;
    const selection = input.run.objectives.selections[checkpoint.blockIndex];
    if (selection === undefined) {
      throw new Error(`no objective selection recorded for block ${String(checkpoint.blockIndex)}`);
    }
    return {
      ...input.run.objectives,
      selections: {
        ...input.run.objectives.selections,
        [checkpoint.blockIndex]: { ...selection, success: checkpoint.objective.success },
      },
    };
  }

  async function acceptCandidate(checkpoint: SeasonCandidateCheckpoint): Promise<void> {
    const requestId = currentRequestId;
    const state = current;
    if (requestId === null || state === null) return;
    const failures: string[] = [];
    // The candidate was already validated against the frozen checkpoint
    // schema as part of the wire message at the boundary; the gates below
    // are the real acceptance checks (digest, identity, expected facts).
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
    // M2.5: the candidate asserted the pre-block run state facts; they
    // must match the authoritative submitted run (the worker sources them
    // from a seam, so mismatches are rejected here, never committed).
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
      // M2.5: the engine derives the post-block run state facts (checkpoint
      // state, state chain, and the optional trade-window open) from the
      // submitted run and the accepted candidate. Window blocks (2/4/5)
      // need the packaged catalog for the deterministic offer generation;
      // a failed catalog load surfaces as an internal error rather than
      // silently skipping a trade window.
      const catalog = await resolveCatalog(state.input);
      const committed = completeSeasonBlockCommit({
        // The digest must cover the EXACT rotation set the commit stores:
        // the locked rotations (the human team's pending rotation included),
        // not the run snapshot's pre-submission rotations. Without this
        // merge any rotation edit would make the stored stateDigest fail to
        // recompute over the stored facts on reload.
        run: { ...state.input.run, rotations: state.rotations },
        candidate: checkpoint,
        commandId: state.commandId,
        rotationDigest: state.rotationDigest,
        humanFranchiseId: state.input.humanFranchiseId,
        catalog: catalog ?? undefined,
        effects: checkpoint.effects,
      });
      const window: SeasonWindowOpenResult | null = committed.window;
      // M2.5: a resumed block's pending retained details (games completed
      // before the interruption) merge into the commit; the candidate's own
      // details cover the resumed games only. Deduped by game id.
      const retainedDetails = dedupeByGameId([
        ...(state.resumePending?.retainedDetails ?? []),
        ...checkpoint.retainedDetails,
      ]);
      const objectives = objectivesWithSuccess(state.input, checkpoint);
      await repository.commitSeasonBlock({
        runId: checkpoint.runId,
        revision: checkpoint.revision + 1,
        commandId: state.commandId,
        rotationDigest: checkpoint.rotationDigest,
        checkpointDigest: checkpoint.digest,
        completedRounds: checkpoint.completedRounds,
        standings: checkpoint.standings,
        teamAggregates: checkpoint.teamAggregates,
        playerAggregates: checkpoint.playerAggregates,
        summaries: checkpoint.gameSummaries,
        retainedDetails,
        recap: checkpoint.recap,
        rotations: state.rotations,
        effects: window !== null ? window.effects : checkpoint.effects,
        health: checkpoint.health,
        transactions: window !== null ? window.transactions : checkpoint.transactions,
        influence: window !== null ? window.influence : checkpoint.influence,
        trade: window !== null ? window.trade : state.input.run.trade,
        objectives,
        checkpointState: committed.checkpointState,
        stateRevision: committed.stateRevision,
        stateDigest: committed.stateDigest,
        expectedStateRevision: state.input.run.stateRevision,
        expectedStateDigest: state.input.run.stateDigest,
        window,
      });
      // The commit is authoritative: keep the in-memory cursor and the
      // worker's summary accumulator in sync so the next block starts and
      // ships deltas without a repository load.
      if (runState === null || runState.runId !== checkpoint.runId) {
        runState = {
          runId: checkpoint.runId,
          revision: checkpoint.revision,
          completedRounds: checkpoint.completedRounds,
          commandIds: new Set(),
          summaries: [],
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
      runState.health = checkpoint.health;
      runState.stateRevision = committed.stateRevision;
      runState.stateDigest = committed.stateDigest;
      workerSummaryRunId = checkpoint.runId;
      workerSummaryCount = runState.summaries.length;
      emit({ type: 'complete', requestId, checkpoint });
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

  /** M2.5: an invalid-roster interruption â€” persist the pending candidate. */
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
      // The engine derives the unavailable players from the pending health
      // (the health state entering the interrupted game).
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
        humanFranchiseId: state.input.humanFranchiseId,
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

  /** Shared request builder for fresh starts and resumes. */
  function buildRequest(
    requestId: string,
    state: NonNullable<typeof current>,
    schedule: SeasonSchedule,
    artifacts: SeasonArtifactUrls,
  ): SeasonWorkerStartRequest | SeasonWorkerContinueRequest {
    const summaries = runState?.runId === state.input.run.runId ? runState.summaries : [];
    // Exactly one of priorSummaries/newSummaries is sent (the frozen wire
    // refine); the arrays may be empty (block 0) â€” only undefined is omitted.
    let priorSummaries: SeasonGameSummary[] | undefined;
    let newSummaries: SeasonGameSummary[] | undefined;
    if (state.resumePending !== null) {
      // Resume: the partial block summaries ship as the accumulator seed.
      // A persistent worker appends them; a fresh worker (terminated
      // between interruption and resume) receives them inside the full
      // prior set â€” the worker re-seeds its block list from the
      // accumulator, so both paths assemble the full block.
      const partial = state.resumePending.summaries;
      if (workerSummaryRunId === state.input.run.runId && workerSummaryCount <= summaries.length) {
        newSummaries = partial;
      } else {
        priorSummaries = [...summaries, ...partial];
      }
    } else if (
      workerSummaryRunId === state.input.run.runId &&
      workerSummaryCount <= summaries.length
    ) {
      const delta = summaries.slice(workerSummaryCount);
      if (delta.length <= 150) {
        newSummaries = delta;
      } else {
        priorSummaries = summaries;
      }
    } else {
      priorSummaries = summaries;
    }
    const common = {
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
      // M2.4: the authoritative pre-block effects state rides the full
      // reset (fresh worker or resume); the delta path keeps the worker's
      // accumulated effects state. A resume ships the pending candidate's
      // mid-block effects as the reset (the worker's accumulated state is
      // the pre-block state for interrupted work, which would be stale).
      ...(state.resumePending !== null
        ? { priorEffects: state.resumePending.effects }
        : priorSummaries !== undefined && runState !== null && runState.effects !== null
          ? { priorEffects: runState.effects }
          : {}),
      // M2.5: the health state follows the same convention; a resume ships
      // the pending candidate's mid-block health as the reset.
      ...(state.resumePending !== null
        ? { priorHealth: state.resumePending.health }
        : priorSummaries !== undefined && runState !== null && runState.health !== null
          ? { priorHealth: runState.health }
          : {}),
      // M2.5: resume mid-block from the pending candidate's next game.
      startGameId: state.resumePending?.nextGameId ?? null,
      // M2.5: the locked block objective.
      objectiveId: state.input.objectiveId,
      // M2.5: the authoritative pre-block Influence economy, run-scoped
      // transaction log, and the asserted run state chain facts (the worker
      // folds the block's grants on top of the economy and emits the full
      // append-only log inside the candidate).
      priorInfluence: state.input.run.influence,
      priorTransactions: state.input.run.transactions,
      expectedStateRevision: state.input.run.stateRevision,
      expectedStateDigest: state.input.run.stateDigest,
      humanFranchiseId: state.input.humanFranchiseId,
    };
    // Wire v5: when the persistent worker already holds the run context
    // (the delta path), only the per-block deltas travel. A priorSummaries
    // reset implies a worker without state for this run, which receives the
    // full context again.
    if (newSummaries !== undefined) {
      return plainWorkerRequest(
        seasonWorkerContinueRequestSchema.parse({
          schemaVersion: 5,
          type: 'season-block-continue',
          rotations: state.rotations,
          ...common,
        }),
      );
    }
    return plainWorkerRequest(
      seasonWorkerStartRequestSchema.parse({
        schemaVersion: 5,
        type: 'season-block-start',
        // The worker simulates with the LOCKED rotation set; the wire carries
        // only the run context the block pipeline reads (the scheduled games,
        // standings, draft, and other persisted facts never cross the worker
        // boundary).
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
        ...common,
      }),
    );
  }

  /**
   * Svelte's deeply reactive shell can place Proxy-backed values anywhere in
   * a submitted run after a rotation edit. Zod validates and reconstructs
   * the wire shape, but the worker boundary additionally requires every
   * nested value to be structured-cloneable. The frozen worker contract is
   * JSON-only, so a JSON snapshot is the simplest reliable de-proxy step.
   */
  function plainWorkerRequest<T extends SeasonWorkerStartRequest | SeasonWorkerContinueRequest>(
    request: T,
  ): T {
    return JSON.parse(JSON.stringify(request)) as T;
  }

  return {
    startBlock(input: SeasonBlockStartInput): string {
      if (currentRequestId !== null) {
        throw new Error('a season block is already running; cancel it first');
      }
      const requestId = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
      void (async () => {
        try {
          const [repository, schedule, artifacts] = await Promise.all([
            resolveRepository(),
            resolveSchedule(),
            deps.artifacts !== undefined
              ? deps.artifacts()
              : import('./season-assets').then((module) => module.seasonArtifactUrls()),
          ]);
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
          if (currentRequestId !== requestId) return;
          const plainStart = buildRequest(requestId, current, schedule, artifacts);
          const target = createWorker();
          target.postMessage(plainStart);
          emit({ type: 'started', requestId, blockIndex: input.blockIndex });
        } catch (error) {
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
      const requestId = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
          if (currentRequestId !== requestId) return;
          // Load the run snapshot and the pending candidate (validated by
          // the repository; a pending row for a committed block fails the
          // reload audit).
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
              effects: snapshot.effects,
              health: snapshot.run.health,
              stateRevision: snapshot.run.stateRevision,
              stateDigest: snapshot.run.stateDigest,
            };
          }
          // The resume re-uses the interrupted submission's identity facts;
          // the run context comes from the reloaded snapshot.
          const startInput: SeasonBlockStartInput = {
            run: snapshot.run,
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
          emit({ type: 'started', requestId, blockIndex: input.blockIndex });
        } catch (error) {
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
      if (worker === null || requestId !== currentRequestId) return;
      worker.postMessage(
        seasonWorkerCancelRequestSchema.parse({
          schemaVersion: 5,
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
      // A fresh worker holds no summary state; the next start re-sends the
      // full prior summaries. The in-memory run cursor survives (keyed by
      // runId) so resumed blocks still avoid a repository load.
      workerSummaryRunId = null;
      workerSummaryCount = 0;
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

/** Singleton runner for the application (lazy deps; e2e may inject a fake). */
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
