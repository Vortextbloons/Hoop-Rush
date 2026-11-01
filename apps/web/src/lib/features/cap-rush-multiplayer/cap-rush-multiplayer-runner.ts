import type {
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerWorkerMessage,
  CapRushMultiplayerWorkerRequest,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
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
  throughSlot?: number;
  tapeGameIds?: readonly string[];
}

export interface CapRushMultiplayerSlotOutput {
  games: CapRushLeagueGame[];
  tapes: readonly { gameId: string; tape: unknown }[];
}

export interface CapRushMultiplayerPlayoffInput {
  roomId: string;
  locked: CapRushMultiplayerLockedInputs;
  plans: readonly CapRushPlayoffGamePlan[];
  tapeGameIds?: readonly string[];
}

export interface CapRushMultiplayerPlayoffOutput {
  games: CapRushPlayoffGameSummary[];
  tapes: readonly { gameId: string; tape: unknown }[];
}

export interface CapRushMultiplayerTapeInput {
  roomId: string;
  locked: CapRushMultiplayerLockedInputs;
  entry?: CapRushLeagueScheduleEntry;
  plan?: CapRushPlayoffGamePlan;
}

export interface CapRushMultiplayerTapeOutput {
  gameId: string;
  input: HavocBattleInput;
  result: HavocBattleResult;
  tape: HavocBattleTape;
}

const WORKER_URL = new URL(workerUrl, import.meta.url);

const ERROR_MESSAGES: OneShotWorkerErrorMessages = {
  superseded: 'the cap rush multiplayer run was superseded',
  disposed: 'the cap rush multiplayer runner was disposed',
  timeout: 'the cap rush multiplayer worker timed out',
  crashed: 'the cap rush multiplayer worker crashed',
  invalidMessage: 'the cap rush multiplayer worker returned an invalid message',
};

function buildRequest(
  payload:
    CapRushMultiplayerSlotInput | CapRushMultiplayerPlayoffInput | CapRushMultiplayerTapeInput,
  requestId: string,
): CapRushMultiplayerWorkerRequest {
  if ('slot' in payload) {
    return capRushMultiplayerWorkerRequestSchema.parse({
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-slot',
      requestId,
      roomId: payload.roomId,
      locked: payload.locked,
      slot: payload.slot,
      throughSlot: payload.throughSlot,
      tapeGameIds: [...(payload.tapeGameIds ?? [])],
    });
  }
  if ('plans' in payload) {
    return capRushMultiplayerWorkerRequestSchema.parse({
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-playoff-games',
      requestId,
      roomId: payload.roomId,
      locked: payload.locked,
      plans: [...payload.plans],
      tapeGameIds: [...(payload.tapeGameIds ?? [])],
    });
  }
  return capRushMultiplayerWorkerRequestSchema.parse({
    schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
    kind: 'cap-rush-multiplayer-tape',
    requestId,
    roomId: payload.roomId,
    locked: payload.locked,
    ...(payload.entry === undefined ? {} : { entry: payload.entry }),
    ...(payload.plan === undefined ? {} : { plan: payload.plan }),
  });
}

function isError(
  response: CapRushMultiplayerWorkerMessage,
): response is Extract<CapRushMultiplayerWorkerMessage, { kind: 'cap-rush-multiplayer-error' }> {
  return response.kind === 'cap-rush-multiplayer-error';
}

function outputOf(response: CapRushMultiplayerWorkerMessage): unknown {
  if (response.kind === 'cap-rush-multiplayer-slot') {
    return { games: response.games, tapes: response.tapes };
  }
  if (response.kind === 'cap-rush-multiplayer-playoff-games') {
    return { games: response.games, tapes: response.tapes };
  }
  if (response.kind === 'cap-rush-multiplayer-tape') {
    return {
      gameId: response.gameId,
      input: response.input,
      result: response.result,
      tape: response.tape,
    };
  }
  throw new Error('cap rush multiplayer worker returned an error');
}

export class CapRushMultiplayerRunner {
  private readonly transport: OneShotWorkerRunner<
    CapRushMultiplayerSlotInput | CapRushMultiplayerPlayoffInput | CapRushMultiplayerTapeInput,
    CapRushMultiplayerWorkerMessage,
    unknown
  >;

  constructor(options: { timeoutMs?: number; createWorker?: (url: URL) => Worker } = {}) {
    this.transport = new OneShotWorkerRunner({
      workerUrl: WORKER_URL,
      buildRequest,
      responseSchema: capRushMultiplayerWorkerMessageSchema,
      requestIdOf: (response) => response.requestId,
      resultOf: (response) =>
        isError(response)
          ? { kind: 'error', message: response.message }
          : { kind: 'output', output: outputOf(response) },
      errorMessages: ERROR_MESSAGES,
      timeoutMs: options.timeoutMs,
      createWorker: options.createWorker,
      reuseWorker: true,
    });
  }

  async simulateSlot(input: CapRushMultiplayerSlotInput): Promise<CapRushMultiplayerSlotOutput> {
    return (await this.transport.run(input)) as CapRushMultiplayerSlotOutput;
  }

  async simulatePlayoffStep(
    input: CapRushMultiplayerPlayoffInput,
  ): Promise<CapRushMultiplayerPlayoffOutput> {
    return (await this.transport.run(input)) as CapRushMultiplayerPlayoffOutput;
  }

  async tapeForGame(input: CapRushMultiplayerTapeInput): Promise<CapRushMultiplayerTapeOutput> {
    return (await this.transport.run(input)) as CapRushMultiplayerTapeOutput;
  }

  dispose(): void {
    this.transport.dispose();
  }
}
