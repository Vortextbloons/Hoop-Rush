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
  type CapRushWorkerStandingsCompleteMessage,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';

export interface CapRushRunnerHandlers {
  onGame: (message: CapRushWorkerGameMessage) => void | Promise<void>;
  onLeagueGames?: (message: CapRushWorkerLeagueGamesMessage) => void | Promise<void>;
  onProgress?: (message: CapRushWorkerProgressMessage) => void;
  onError?: (message: { code: string; message: string; gameNumber: number | null }) => void;
}

export interface CapRushRunnerOptions {
  createWorker?: () => Worker;
}

interface ActiveJob {
  requestId: string;
  worker: Worker;
  cancelled: boolean;
  queue: Promise<void>;
  handlerError: Error | null;
  reject: (error: Error) => void;
}

interface RunJobInput<TComplete> {
  request: CapRushWorkerRequest;
  requestId: string;
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

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class CapRushRunner {
  private readonly createWorker: () => Worker;
  private active: ActiveJob | null = null;
  private worker: Worker | null = null;

  private getWorker(): Worker {
    this.worker ??= this.createWorker();
    return this.worker;
  }

  constructor(options: CapRushRunnerOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorker;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  cancel(): void {
    const active = this.active;
    if (active === null) return;
    active.cancelled = true;
    active.worker.postMessage({
      schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
      type: 'cap-rush-cancel',
      requestId: active.requestId,
    });
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
        locked: input.locked,
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

  simulateStandings(input: {
    requestId: string;
    locked: CapRushLockedInputs;
    bracket: OpponentBracket;
    handlers?: { onProgress?: (message: CapRushWorkerProgressMessage) => void };
  }): Promise<CapRushWorkerStandingsCompleteMessage> {
    return this.runJob({
      request: {
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-standings',
        requestId: input.requestId,
        locked: input.locked,
        bracket: input.bracket,
      },
      requestId: input.requestId,
      concurrentMessage: 'a cap rush job is already running',
      completeOf: (message) => (message.type === 'cap-rush-standings-complete' ? message : null),
      errorAfterQueue: false,
      onProgress: input.handlers?.onProgress,
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
        locked: input.locked,
        games: [...input.games],
        includeTape: input.includeTape,
      },
      requestId: input.requestId,
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

  private runJob<TComplete>(input: RunJobInput<TComplete>): Promise<TComplete> {
    if (this.active !== null) {
      return Promise.reject(new Error(input.concurrentMessage));
    }
    const worker = this.getWorker();
    return new Promise<TComplete>((resolve, reject) => {
      const job: ActiveJob = {
        requestId: input.requestId,
        worker,
        cancelled: false,
        queue: Promise.resolve(),
        handlerError: null,
        reject,
      };
      this.active = job;
      const finish = (message: TComplete): void => {
        this.active = null;
        worker.onmessage = null;
        worker.onerror = null;
        resolve(message);
      };
      const fail = (error: Error): void => {
        this.active = null;
        worker.terminate();
        this.worker = null;
        reject(error);
      };

      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (this.active !== job) return;
        const parsed = capRushWorkerMessageSchema.safeParse(event.data);
        if (!parsed.success) {
          fail(new Error('cap rush worker sent an unrecognised message'));
          return;
        }
        const message: CapRushWorkerMessage = parsed.data;
        if (message.requestId !== input.requestId) return;
        const complete = input.completeOf(message);
        if (complete !== null) {
          if (!input.errorAfterQueue) {
            finish(complete);
            return;
          }
          void job.queue.then(() => {
            if (job.handlerError !== null) {
              fail(job.handlerError);
              return;
            }
            finish(complete);
          });
          return;
        }
        if (message.type === 'cap-rush-error') {
          input.onError?.(message);
          if (!input.errorAfterQueue) {
            fail(new Error(`${message.code}: ${message.message}`));
            return;
          }
          void job.queue.then(() => {
            fail(new Error(`${message.code}: ${message.message}`));
          });
          return;
        }
        if (message.type === 'cap-rush-progress') {
          input.onProgress?.(message);
          return;
        }
        if (input.stream?.matches(message) === true) {
          job.queue = job.queue
            .then(() => input.stream?.handle(message))
            .catch((error: unknown) => {
              job.handlerError = errorOf(error);
              this.cancel();
            });
        }
      };
      worker.onerror = (event) => {
        fail(errorOf(event.error ?? 'cap rush worker crashed'));
      };
      worker.postMessage(input.request);
    });
  }

  destroy(): void {
    const active = this.active;
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
    active?.reject(new Error('cap rush runner destroyed'));
  }
}
