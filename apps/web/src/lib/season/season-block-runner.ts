import type {
  SeasonCandidateCheckpoint,
  SeasonEffectsState,
  SeasonGameSummary,
  SeasonHomeCourtProfile,
  SeasonRotation,
  SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  seasonCandidateCheckpointSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerMessageSchema,
  seasonWorkerStartRequestSchema,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  seasonCheckpointDigest,
  seasonNextBlockIndex,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';
import type { SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';
import type { SeasonArtifactUrls } from './season-assets';

/**
 * Season block runner contract (spec/2.0/07 background execution, M2.3).
 * The main-thread runner owns request ids, stale-message rejection,
 * cancellation/termination, validation, canonical acceptance, and
 * persistence. Cancelled or crashed work must leave the accepted checkpoint
 * untouched; unfinished work is discarded and deterministically reproduced
 * on the next run. The UI imports these types and reacts to runner events;
 * the implementation lives in `season-block-runner.ts` and speaks to the
 * `season-block-worker.ts` entry point through the frozen worker envelopes.
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
      latestResult: SeasonGameSummary | null;
    }
  | { type: 'complete'; requestId: string; checkpoint: SeasonCandidateCheckpoint }
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
 * Main-thread block runner (spec/2.0/07 background execution, M2.3). Owns
 * request ids, stale-message rejection, cancellation/termination, boundary
 * validation against the accepted snapshot, canonical acceptance (schema,
 * digest, cursor facts), and the atomic checkpoint commit. The worker
 * returns one candidate; this runner accepts it only after every check, then
 * commits it in one IndexedDB transaction. Cancelled or crashed work leaves
 * the accepted checkpoint untouched: nothing is persisted before acceptance.
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

  function createWorker(): Worker {
    if (worker !== null) return worker;
    const url = deps.workerUrl ?? new URL('../../workers/season-block-worker.ts', import.meta.url);
    worker = new Worker(url, { type: 'module' });
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
      void acceptCandidate(message.checkpoint);
    });
    return worker;
  }

  async function acceptCandidate(checkpoint: SeasonCandidateCheckpoint): Promise<void> {
    const requestId = currentRequestId;
    const state = current;
    if (requestId === null || state === null) return;
    const failures: string[] = [];
    const parsed = seasonCandidateCheckpointSchema.safeParse(checkpoint);
    if (!parsed.success) failures.push('candidate fails the frozen checkpoint schema');
    if (parsed.success) {
      if (seasonCheckpointDigest(checkpoint) !== checkpoint.digest) {
        failures.push('candidate digest does not verify');
      }
      if (checkpoint.runId !== state.input.run.runId) failures.push('candidate runId mismatch');
      if (checkpoint.blockIndex !== state.blockIndex)
        failures.push('candidate blockIndex mismatch');
      if (checkpoint.revision !== state.expectedRevision) {
        failures.push('candidate revision does not match expectedRevision');
      }
      if (checkpoint.rotationDigest !== state.rotationDigest) {
        failures.push('candidate rotationDigest mismatch');
      }
    }
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
        retainedDetails: checkpoint.retainedDetails,
        recap: checkpoint.recap,
        rotations: state.rotations,
        effects: checkpoint.effects,
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
        };
      }
      runState.revision = checkpoint.revision + 1;
      runState.completedRounds = checkpoint.completedRounds;
      runState.commandIds.add(state.commandId);
      runState.summaries = [...runState.summaries, ...checkpoint.gameSummaries];
      runState.effects = checkpoint.effects;
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
          if (runState === null || runState.runId !== input.run.runId) {
            const snapshot = await repository.loadActiveRun();
            if (snapshot === null) throw new Error('no active season run to advance');
            if (snapshot.run.runId !== input.run.runId) {
              throw new Error('the active run does not match the submitted run');
            }
            runState = {
              runId: snapshot.run.runId,
              revision: snapshot.acceptedBlocks.length,
              completedRounds: snapshot.run.cursor.completedRounds,
              commandIds: new Set(snapshot.acceptedBlocks.map((block) => block.commandId)),
              summaries: snapshot.summaries,
              effects: snapshot.effects,
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
          // The persistent worker accumulates summaries; ship the full set
          // only when it has no state for this run (fresh worker or resumed
          // after a route change), otherwise a per-block delta.
          const summaries = runState.summaries;
          let priorSummaries: SeasonGameSummary[] | undefined;
          let newSummaries: SeasonGameSummary[] | undefined;
          if (workerSummaryRunId === input.run.runId && workerSummaryCount <= summaries.length) {
            const delta = summaries.slice(workerSummaryCount);
            if (delta.length <= 150) {
              newSummaries = delta;
            } else {
              priorSummaries = summaries;
            }
          } else {
            priorSummaries = summaries;
          }
          const start: SeasonWorkerStartRequest = {
            schemaVersion: 3,
            type: 'season-block-start',
            requestId,
            runId: input.run.runId,
            rootSeed: input.run.rootSeed,
            blockIndex: input.blockIndex,
            expectedRevision: input.expectedRevision,
            rotationDigest: input.rotationDigest,
            commandId: input.commandId,
            // The worker simulates with the LOCKED rotation set; the wire
            // carries only the run context the block pipeline reads (the
            // scheduled games, standings, draft, and other persisted facts
            // never cross the worker boundary).
            run: {
              schemaVersion: input.run.schemaVersion,
              runId: input.run.runId,
              rootSeed: input.run.rootSeed,
              versions: input.run.versions,
              league: input.run.league,
              rosters: input.run.rosters,
              rotations: input.rotations,
              cursor: input.run.cursor,
            },
            schedule,
            homeCourt: input.homeCourt,
            humanFranchiseId: input.humanFranchiseId,
            catalogUrl: artifacts.catalogUrl,
            catalogHash: artifacts.catalogHash,
            profileUrl: artifacts.profileUrl,
            profileHash: artifacts.profileHash,
            ...(priorSummaries !== undefined ? { priorSummaries } : {}),
            ...(newSummaries !== undefined ? { newSummaries } : {}),
            // M2.4: the authoritative pre-block effects state rides the full
            // reset (fresh worker or resume); the delta path keeps the
            // worker's accumulated effects state.
            ...(priorSummaries !== undefined && runState.effects !== null
              ? { priorEffects: runState.effects }
              : {}),
          };
          // Parse re-builds the payload as plain data (the reactive shell
          // proxies must never cross the structured-clone boundary).
          const plainStart = seasonWorkerStartRequestSchema.parse(start);
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

    cancel(requestId: string): void {
      if (worker === null || requestId !== currentRequestId) return;
      worker.postMessage(
        seasonWorkerCancelRequestSchema.parse({
          schemaVersion: 2,
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
