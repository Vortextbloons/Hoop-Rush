import type { CapRushMultiplayerState, CapRushMultiplayerCommand } from '@hoop-rush/data-contracts';
import { createCapRushMultiplayerState, capRushMultiplayerStateDigest } from '@hoop-rush/engine';
import type { CapRushMultiplayerEnvironment } from '@hoop-rush/engine';
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
  idSchema,
} from '@hoop-rush/data-contracts';
import {
  OneShotWorkerRunner,
  type OneShotWorkerErrorMessages,
} from '#lib/workers/one-shot-worker.js';
import workerUrl from '../../../workers/cap-rush-multiplayer-worker.ts?worker&url';

export interface CapRushMultiplayerProjectionInput {
  state: CapRushMultiplayerState;
  commands: readonly CapRushMultiplayerCommand[];
  environment: CapRushMultiplayerEnvironment;
  variant: 'clash' | 'roulette';
  verifyLog?: boolean;
}

export interface CapRushMultiplayerSlotInput {
  roomId: string;
  locked: CapRushMultiplayerLockedInputs;
  slot: number;
  throughSlot?: number;
  partition?: 0 | 1;
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
    | CapRushMultiplayerSlotInput
    | CapRushMultiplayerPlayoffInput
    | CapRushMultiplayerTapeInput
    | CapRushMultiplayerProjectionInput,
  requestId: string,
): CapRushMultiplayerWorkerRequest {
  if ('commands' in payload)
    return {
      state: payload.state,
      commands: [...payload.commands],
      environment: {
        variant: payload.environment.variant,
        bracket: payload.environment.bracket,
        seasonCatalog: payload.environment.seasonCatalog,
        profile: payload.environment.profile,
        catalogSource: payload.environment.catalogSource,
        versionLocks: payload.environment.versionLocks,
      },
      variant: payload.variant,
      verifyLog: payload.verifyLog,
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-project',
      requestId: idSchema.parse(requestId),
    } satisfies CapRushMultiplayerWorkerRequest;
  if ('slot' in payload) {
    return {
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-slot',
      requestId: idSchema.parse(requestId),
      roomId: idSchema.parse(payload.roomId),
      locked: payload.locked,
      slot: payload.slot,
      throughSlot: payload.throughSlot,
      partition: payload.partition,
      tapeGameIds: [...(payload.tapeGameIds ?? [])],
    } satisfies CapRushMultiplayerWorkerRequest;
  }
  if ('plans' in payload) {
    return {
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-playoff-games',
      requestId: idSchema.parse(requestId),
      roomId: idSchema.parse(payload.roomId),
      locked: payload.locked,
      plans: [...payload.plans],
      tapeGameIds: [...(payload.tapeGameIds ?? [])],
    } satisfies CapRushMultiplayerWorkerRequest;
  }
  return {
    schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
    kind: 'cap-rush-multiplayer-tape',
    requestId: idSchema.parse(requestId),
    roomId: idSchema.parse(payload.roomId),
    locked: payload.locked,
    ...(payload.entry === undefined ? {} : { entry: payload.entry }),
    ...(payload.plan === undefined ? {} : { plan: payload.plan }),
  } satisfies CapRushMultiplayerWorkerRequest;
}

function isError(
  response: CapRushMultiplayerWorkerMessage,
): response is Extract<CapRushMultiplayerWorkerMessage, { kind: 'cap-rush-multiplayer-error' }> {
  return response.kind === 'cap-rush-multiplayer-error';
}

function outputOf(response: CapRushMultiplayerWorkerMessage): unknown {
  if (response.kind === 'cap-rush-multiplayer-rejection') return response;
  if (response.kind === 'cap-rush-multiplayer-slot') {
    return { games: response.games, tapes: response.tapes };
  }
  if (response.kind === 'cap-rush-multiplayer-projection') return response.state;
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

export class CapRushMultiplayerProjectionRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class CapRushMultiplayerRunner {
  private generation = 0;
  private readonly slotRunners: CapRushMultiplayerRunner[] = [];
  private readonly options: {
    timeoutMs?: number;
    createWorker?: (url: URL) => Worker;
    parallelism?: number;
  };

  private readonly transport: OneShotWorkerRunner<
    | CapRushMultiplayerSlotInput
    | CapRushMultiplayerPlayoffInput
    | CapRushMultiplayerTapeInput
    | CapRushMultiplayerProjectionInput,
    CapRushMultiplayerWorkerMessage,
    unknown
  >;

  constructor(
    options: { timeoutMs?: number; createWorker?: (url: URL) => Worker; parallelism?: number } = {},
  ) {
    this.options = options;
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

  async project(input: CapRushMultiplayerProjectionInput): Promise<CapRushMultiplayerState> {
    this.generation += 1;
    for (const runner of this.slotRunners) runner.dispose();
    const result = (await this.transport.run(input)) as
      | CapRushMultiplayerState
      | Extract<CapRushMultiplayerWorkerMessage, { kind: 'cap-rush-multiplayer-rejection' }>;
    if ('kind' in result)
      throw new CapRushMultiplayerProjectionRejection(result.code, result.message);
    return result;
  }

  async verifyLog(
    input: Omit<CapRushMultiplayerProjectionInput, 'state'> & { rootSeed: string },
  ): Promise<string> {
    const state = await this.project({
      ...input,
      state: createCapRushMultiplayerState(input.rootSeed),
      verifyLog: true,
    });
    return capRushMultiplayerStateDigest(state);
  }

  async simulateSlot(input: CapRushMultiplayerSlotInput): Promise<CapRushMultiplayerSlotOutput> {
    const generation = ++this.generation;
    const through = input.throughSlot ?? input.slot;
    const parallelism =
      this.options.parallelism ??
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 4 ? 2 : 1);
    if (parallelism <= 1 || through < input.slot || through - input.slot > 4) {
      for (const runner of this.slotRunners) runner.dispose();
      return (await this.transport.run(input)) as CapRushMultiplayerSlotOutput;
    }
    this.transport.dispose();
    while (this.slotRunners.length < 2) {
      this.slotRunners.push(new CapRushMultiplayerRunner({ ...this.options, parallelism: 1 }));
    }
    const midpoint = Math.floor((input.slot + through) / 2);
    const outputs = await Promise.all(
      this.slotRunners.map((runner, index) =>
        runner.simulateSlot({
          ...input,
          slot: through === input.slot ? input.slot : index === 0 ? input.slot : midpoint + 1,
          throughSlot: through === input.slot ? through : index === 0 ? midpoint : through,
          partition: through === input.slot ? (index === 0 ? 0 : 1) : undefined,
        }),
      ),
    ).catch((error: unknown) => {
      if (generation === this.generation) for (const runner of this.slotRunners) runner.dispose();
      throw error;
    });
    return {
      games: outputs.flatMap((output) => output.games),
      tapes: outputs.flatMap((output) => output.tapes),
    };
  }

  async simulatePlayoffStep(
    input: CapRushMultiplayerPlayoffInput,
  ): Promise<CapRushMultiplayerPlayoffOutput> {
    const generation = ++this.generation;
    const groups = new Map<string, CapRushPlayoffGamePlan[]>();
    for (const plan of input.plans) {
      const group = groups.get(plan.seriesId) ?? [];
      group.push(plan);
      groups.set(plan.seriesId, group);
    }
    const parallelism =
      this.options.parallelism ??
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 4 ? 2 : 1);
    if (parallelism <= 1 || groups.size <= 1) {
      for (const runner of this.slotRunners) runner.dispose();
      return (await this.transport.run(input)) as CapRushMultiplayerPlayoffOutput;
    }
    this.transport.dispose();
    while (this.slotRunners.length < 2)
      this.slotRunners.push(new CapRushMultiplayerRunner({ ...this.options, parallelism: 1 }));
    const batches: [CapRushPlayoffGamePlan[], CapRushPlayoffGamePlan[]] = [[], []];
    for (const group of groups.values()) {
      const target = batches[0].length <= batches[1].length ? batches[0] : batches[1];
      target.push(...group);
    }
    const outputs = await Promise.all(
      this.slotRunners.map((runner, index) =>
        runner.simulatePlayoffStep({ ...input, plans: batches[index] ?? [] }),
      ),
    ).catch((error: unknown) => {
      if (generation === this.generation) for (const runner of this.slotRunners) runner.dispose();
      throw error;
    });
    const games = outputs.flatMap((output) => output.games);
    const order = new Map(
      input.plans.map((plan, index) => [
        `crp-${String(plan.round)}-${String(plan.seriesSlot)}-${String(plan.gameOrdinal)}`,
        index,
      ]),
    );
    games.sort((left, right) => (order.get(left.gameId) ?? 0) - (order.get(right.gameId) ?? 0));
    const tapes = outputs.flatMap((output) => output.tapes);
    tapes.sort((left, right) => (order.get(left.gameId) ?? 0) - (order.get(right.gameId) ?? 0));
    return { games, tapes };
  }

  async tapeForGame(input: CapRushMultiplayerTapeInput): Promise<CapRushMultiplayerTapeOutput> {
    this.generation += 1;
    for (const runner of this.slotRunners) runner.dispose();
    return (await this.transport.run(input)) as CapRushMultiplayerTapeOutput;
  }

  dispose(): void {
    this.generation += 1;
    this.transport.dispose();
    for (const runner of this.slotRunners) runner.dispose();
  }
}
