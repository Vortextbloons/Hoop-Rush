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
import { StreamingWorkerRunner } from '#lib/workers/streaming-worker.js';

export interface CapRushRunnerHandlers {
  onGame: (message: CapRushWorkerGameMessage) => void | Promise<void>;
  onLeagueGames?: (message: CapRushWorkerLeagueGamesMessage) => void | Promise<void>;
  onProgress?: (message: CapRushWorkerProgressMessage) => void;
  onError?: (message: { code: string; message: string; gameNumber: number | null }) => void;
}

export interface CapRushRunnerOptions {
  createWorker?: () => Worker;
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

export class CapRushRunner {
  private readonly transport: StreamingWorkerRunner<CapRushWorkerMessage>;

  constructor(options: CapRushRunnerOptions = {}) {
    this.transport = new StreamingWorkerRunner({
      createWorker: options.createWorker ?? defaultWorker,
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
    return this.transport.run({
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
  }

  destroy(): void {
    this.transport.dispose('cap rush runner destroyed');
  }
}
