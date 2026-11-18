import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  capRushWorkerMessageSchema,
  type CapRushLockedInputs,
  type CapRushPlayoffGamePlan,
  type CapRushWorkerCompleteMessage,
  type CapRushWorkerGameMessage,
  type CapRushWorkerLeagueGamesMessage,
  type CapRushWorkerMessage,
  type CapRushWorkerPlayoffGameMessage,
  type CapRushWorkerPlayoffsCompleteMessage,
  type CapRushWorkerProgressMessage,
  type CapRushWorkerRequest,
} from '@hoop-rush/data-contracts';
import { CapRushParallelWorker } from './cap-rush-parallel-worker';
import { StreamingWorkerRunner } from '#lib/workers/streaming-worker.js';

export interface CapRushRunnerHandlers {
  onGame: (message: CapRushWorkerGameMessage) => void | Promise<void>;
  onLeagueGames?: (message: CapRushWorkerLeagueGamesMessage) => void | Promise<void>;
  onProgress?: (message: CapRushWorkerProgressMessage) => void;
  onError?: (message: { code: string; message: string; gameNumber: number | null }) => void;
}

export interface CapRushRunnerOptions {
  createWorker?: () => Worker;
  parallelism?: number;
}

interface RunJobInput<TComplete> {
  request: CapRushWorkerRequest;
  requestId: string;
  runId: string;
  concurrentMessage: string;
  completeOf: (message: CapRushWorkerMessage) => TComplete | null;
  errorAfterQueue: boolean;
  stream?: {
    matches: (message: CapRushWorkerMessage) => boolean;
    handle: (message: CapRushWorkerMessage) => void | Promise<void>;
  };
  onProgress?: (message: CapRushWorkerProgressMessage) => void;
  onError?: (message: { code: string; message: string; gameNumber: number | null }) => void;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../../../workers/cap-rush-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export class CapRushRunner {
  private readonly transport: StreamingWorkerRunner<CapRushWorkerMessage>;
  /**
   * A worker keeps the validated lock it hydrated for a run. The first job on
   * a worker (or after a failure replaced it) carries the lock; every later
   * job only references the run id. A handler/worker/validation failure
   * terminates the worker, so the next job hydrates it again.
   */
  private hydratedRunId: string | null = null;
  private workerGeneration = 0;

  constructor(options: CapRushRunnerOptions = {}) {
    const createWorker = options.createWorker ?? defaultWorker;
    const parallelism =
      options.parallelism ??
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 4 ? 2 : 1);
    this.transport = new StreamingWorkerRunner({
      createWorker:
        parallelism > 1
          ? () => new CapRushParallelWorker(createWorker) as unknown as Worker
          : createWorker,
      responseSchema: capRushWorkerMessageSchema,
      invalidMessage: 'cap rush worker sent an unrecognised message',
      crashed: 'cap rush worker crashed',
    });
  }

  get busy(): boolean {
    return this.transport.busy;
  }

  cancel(): void {
    this.transport.cancel();
  }

  simulate(input: {
    requestId: string;
    locked: CapRushLockedInputs;
    startGame: number;
    count: number;
    includeTape?: boolean;
    leagueOnly?: boolean;
    backfillLeagueFrom?: number;
    backfillLeagueTo?: number;
    handlers: CapRushRunnerHandlers;
  }): Promise<CapRushWorkerCompleteMessage> {
    return this.runJob({
      request: {
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-simulate',
        requestId: input.requestId,
        ...this.lockRequestFields(input.locked),
        startGame: input.startGame,
        count: input.count,
        includeTape: input.includeTape,
        ...(input.leagueOnly === undefined ? {} : { leagueOnly: input.leagueOnly }),
        ...(input.backfillLeagueFrom === undefined
          ? {}
          : { backfillLeagueFrom: input.backfillLeagueFrom }),
        ...(input.backfillLeagueTo === undefined
          ? {}
          : { backfillLeagueTo: input.backfillLeagueTo }),
      },
      requestId: input.requestId,
      runId: input.locked.runId,
      concurrentMessage: 'a cap rush season job is already running',
      completeOf: (message) => (message.type === 'cap-rush-complete' ? message : null),
      errorAfterQueue: true,
      stream: {
        matches: (message) =>
          message.type === 'cap-rush-game' || message.type === 'cap-rush-league-games',
        handle: (message) => {
          if (message.type === 'cap-rush-game') return input.handlers.onGame(message);
          if (message.type === 'cap-rush-league-games') {
            return input.handlers.onLeagueGames?.(message);
          }
        },
      },
      onProgress: input.handlers.onProgress,
      onError: input.handlers.onError,
    });
  }

  simulatePlayoffs(input: {
    requestId: string;
    locked: CapRushLockedInputs;
    games: readonly CapRushPlayoffGamePlan[];
    includeTape?: boolean;
    handlers: {
      onGame: (message: CapRushWorkerPlayoffGameMessage) => void | Promise<void>;
      onError?: (message: { code: string; message: string; gameNumber: number | null }) => void;
    };
  }): Promise<CapRushWorkerPlayoffsCompleteMessage> {
    return this.runJob({
      request: {
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-playoffs',
        requestId: input.requestId,
        ...this.lockRequestFields(input.locked),
        games: [...input.games],
        includeTape: input.includeTape,
      },
      requestId: input.requestId,
      runId: input.locked.runId,
      concurrentMessage: 'a cap rush job is already running',
      completeOf: (message) => (message.type === 'cap-rush-playoffs-complete' ? message : null),
      errorAfterQueue: true,
      stream: {
        matches: (message) => message.type === 'cap-rush-playoff-game',
        handle: (message) => {
          if (message.type === 'cap-rush-playoff-game') return input.handlers.onGame(message);
        },
      },
      onError: input.handlers.onError,
    });
  }

  private async runJob<TComplete>(input: RunJobInput<TComplete>): Promise<TComplete> {
    // Reject concurrent jobs before touching hydration state: the active
    // worker is still valid and keeps its lock.
    if (this.transport.busy) throw new Error(input.concurrentMessage);
    const generation = this.workerGeneration;
    try {
      const result = await this.transport.run({
        request: input.request,
        requestId: input.requestId,
        concurrent: { kind: 'reject', message: input.concurrentMessage },
        completeOf: input.completeOf,
        errorOf: (message) => {
          if (message.type !== 'cap-rush-error') return null;
          input.onError?.(message);
          return new Error(`${message.code}: ${message.message}`);
        },
        drainOnError: input.errorAfterQueue,
        cancelRequest: {
          schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
          type: 'cap-rush-cancel',
          requestId: input.requestId,
        },
        handle: (message, enqueue) => {
          if (message.type === 'cap-rush-progress') input.onProgress?.(message);
          else if (input.stream?.matches(message) === true)
            enqueue(() => input.stream?.handle(message));
        },
      });
      if (this.workerGeneration === generation) this.hydratedRunId = input.runId;
      return result;
    } catch (error) {
      // Every failing path terminates the worker, so the next job must carry
      // the locked inputs again.
      if (this.workerGeneration === generation) this.hydratedRunId = null;
      throw error;
    }
  }

  private lockRequestFields(locked: CapRushLockedInputs): {
    runId: CapRushLockedInputs['runId'];
    locked?: CapRushLockedInputs;
  } {
    const includeLocked = this.hydratedRunId !== locked.runId;
    return includeLocked ? { runId: locked.runId, locked } : { runId: locked.runId };
  }

  destroy(): void {
    this.workerGeneration += 1;
    this.hydratedRunId = null;
    this.transport.dispose('cap rush runner destroyed');
  }
}
