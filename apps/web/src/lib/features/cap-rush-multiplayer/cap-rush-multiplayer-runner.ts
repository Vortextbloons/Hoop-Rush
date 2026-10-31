import type {
  CapRushLeagueGame,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerWorkerMessage,
  CapRushMultiplayerWorkerRequest,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  capRushMultiplayerWorkerMessageSchema,
  capRushMultiplayerWorkerRequestSchema,
} from '@hoop-rush/data-contracts';
import {
  OneShotWorkerRunner,
  type OneShotWorkerErrorMessages,
} from '#lib/workers/one-shot-worker.js';
import workerUrl from '../../../workers/cap-rush-multiplayer-worker.ts?worker&url';

export interface CapRushMultiplayerSlotInput {
  roomId: string;
  locked: CapRushMultiplayerLockedInputs;
  slot: number;
  tapeGameIds?: readonly string[];
}

export interface CapRushMultiplayerSlotOutput {
  games: CapRushLeagueGame[];
  tapes: readonly { gameId: string; tape: unknown }[];
}

const WORKER_URL = new URL(workerUrl, import.meta.url);

const ERROR_MESSAGES: OneShotWorkerErrorMessages = {
  superseded: 'the cap rush multiplayer run was superseded',
  disposed: 'the cap rush multiplayer runner was disposed',
  timeout: 'the cap rush multiplayer worker timed out',
  crashed: 'the cap rush multiplayer worker crashed',
  invalidMessage: 'the cap rush multiplayer worker returned an invalid message',
};

export class CapRushMultiplayerRunner {
  private readonly transport: OneShotWorkerRunner<
    CapRushMultiplayerSlotInput,
    CapRushMultiplayerWorkerMessage,
    CapRushMultiplayerSlotOutput
  >;

  constructor(options: { timeoutMs?: number; createWorker?: (url: URL) => Worker } = {}) {
    this.transport = new OneShotWorkerRunner({
      workerUrl: WORKER_URL,
      buildRequest: (payload, requestId): CapRushMultiplayerWorkerRequest =>
        capRushMultiplayerWorkerRequestSchema.parse({
          schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
          kind: 'cap-rush-multiplayer-slot',
          requestId,
          roomId: payload.roomId,
          locked: payload.locked,
          slot: payload.slot,
          tapeGameIds: [...(payload.tapeGameIds ?? [])],
        }),
      responseSchema: capRushMultiplayerWorkerMessageSchema,
      requestIdOf: (response) => response.requestId,
      resultOf: (response) =>
        response.kind === 'cap-rush-multiplayer-error'
          ? { kind: 'error', message: response.message }
          : {
              kind: 'output',
              output: { games: response.games, tapes: response.tapes },
            },
      errorMessages: ERROR_MESSAGES,
      timeoutMs: options.timeoutMs,
      createWorker: options.createWorker,
    });
  }

  simulateSlot(input: CapRushMultiplayerSlotInput): Promise<CapRushMultiplayerSlotOutput> {
    return this.transport.run(input);
  }

  dispose(): void {
    this.transport.dispose();
  }
}
