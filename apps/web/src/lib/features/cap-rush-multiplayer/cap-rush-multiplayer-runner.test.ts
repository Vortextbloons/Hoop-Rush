import { expect, test } from 'bun:test';
import {
  capRushMultiplayerCommandSchema,
  capRushMultiplayerWorkerRequestSchema,
  capRushPlayoffGameSeed,
  type CapRushPlayoffGamePlan,
  type CapRushMultiplayerCommandPayload,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  simulateCapRushMultiplayerPlayoffGame,
  simulateCapRushMultiplayerSlot,
  applyCapRushMultiplayerCommand,
  createCapRushMultiplayerState,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import {
  capRushTestEnvironment,
  capRushTestRootSeed,
  capRushTestDate,
} from '../../../../../../packages/engine/src/modes/cap-rush/multiplayer/shared-league.test-support.ts';
import { CapRushMultiplayerRunner } from './cap-rush-multiplayer-runner';

function league() {
  const environment = capRushTestEnvironment(capRushTestSetup());
  const rootSeed = capRushTestRootSeed();
  let state = createCapRushMultiplayerState(rootSeed);
  let ordinal = 0;
  let clock = capRushTestDate();
  const run = (payload: CapRushMultiplayerCommandPayload) => {
    const command = capRushMultiplayerCommandSchema.parse({
      schemaVersion: state.schemaVersion,
      roomId: 'room-test',
      commandId: `cmd-${String(ordinal)}`,
      ordinal,
      actorParticipantId: 'p1',
      expectedRevision: ordinal,
      acceptedAtIso: new Date(clock).toISOString(),
      payload,
    });
    const outcome = applyCapRushMultiplayerCommand(state, command, environment);
    if (!outcome.ok) throw new Error(outcome.message);
    state = outcome.state;
    ordinal += 1;
  };
  run({ kind: 'start' });
  for (let round = 0; round < 5; round += 1) {
    clock += 61_000;
    run({ kind: 'close-due-auctions', round });
  }
  if (state.locked === null) throw new Error('missing locked league');
  return { locked: state.locked };
}

test('splits ranges into ordered workers and disposes pending work', async () => {
  const workers: {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    posted: Record<string, unknown>[];
    terminated: boolean;
    postMessage(message: Record<string, unknown>): void;
    terminate(): void;
  }[] = [];
  const createWorker = () => {
    const worker = {
      onmessage: null,
      onerror: null,
      posted: [] as Record<string, unknown>[],
      terminated: false,
      postMessage(message: Record<string, unknown>) {
        this.posted.push(message);
      },
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(worker);
    return worker as unknown as Worker;
  };
  const runner = new CapRushMultiplayerRunner({ createWorker, parallelism: 2 });
  try {
    const input = { roomId: 'room-test', locked: league().locked, slot: 1, throughSlot: 5 };
    const games = simulateCapRushMultiplayerSlot({
      locked: input.locked,
      slot: 1,
      context: createEngineContext(),
    }).games;
    const pending = runner.simulateSlot(input);
    expect(
      workers.map((worker) => [worker.posted[0]?.slot, worker.posted[0]?.throughSlot]),
    ).toEqual([
      [1, 3],
      [4, 5],
    ]);
    const respond = (index: number) => {
      const worker = workers[workers.length - 2 + index];
      const request = worker?.posted.at(-1);
      if (worker === undefined || request === undefined) throw new Error('missing worker request');
      worker.onmessage?.({
        data: {
          schemaVersion: request.schemaVersion,
          requestId: request.requestId,
          kind: 'cap-rush-multiplayer-slot',
          slot: request.slot,
          games,
          tapes: [{ gameId: `game-${String(index)}`, tape: index }],
        },
      } as MessageEvent);
    };
    respond(1);
    respond(0);
    expect((await pending).tapes.map((entry) => entry.gameId)).toEqual(['game-0', 'game-1']);
    const superseded = runner.simulateSlot(input).catch((error: unknown) => error);
    const replacement = runner.simulateSlot(input);
    expect(await superseded).toBeInstanceOf(Error);
    respond(1);
    respond(0);
    expect((await replacement).tapes).toHaveLength(2);
    const next = runner.simulateSlot(input);
    const rejected = next.catch((error: unknown) => error);
    runner.dispose();
    expect(await rejected).toBeInstanceOf(Error);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  } finally {
    runner.dispose();
  }
});

test('single-slot partitions and playoff series match serial engine outputs including playback', async () => {
  const { locked } = league();
  const createWorker = () => {
    const worker: {
      onmessage: ((event: MessageEvent<unknown>) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      postMessage(value: unknown): void;
      terminate(): void;
    } = {
      onmessage: null,
      onerror: null,
      postMessage(value) {
        const request = capRushMultiplayerWorkerRequestSchema.parse(value);
        queueMicrotask(() => {
          const base = { schemaVersion: request.schemaVersion, requestId: request.requestId };
          if (request.kind === 'cap-rush-multiplayer-slot') {
            const simulation = simulateCapRushMultiplayerSlot({
              locked: request.locked,
              slot: request.slot,
              partition: request.partition,
              tapeGameIds: request.tapeGameIds,
              context: createEngineContext(),
            });
            worker.onmessage?.({
              data: {
                ...base,
                kind: request.kind,
                slot: request.slot,
                games: simulation.games,
                tapes: [...simulation.tapes].map(([gameId, tape]) => ({ gameId, tape })),
              },
            } as MessageEvent<unknown>);
          } else if (request.kind === 'cap-rush-multiplayer-playoff-games') {
            const simulations = request.plans.map((plan) =>
              simulateCapRushMultiplayerPlayoffGame({
                locked: request.locked,
                plan,
                context: createEngineContext(),
              }),
            );
            worker.onmessage?.({
              data: {
                ...base,
                kind: request.kind,
                games: simulations.map((simulation) => simulation.game),
                tapes: simulations
                  .filter((simulation) => request.tapeGameIds.includes(simulation.game.gameId))
                  .map((simulation) => ({ gameId: simulation.game.gameId, tape: simulation.tape })),
              },
            } as MessageEvent<unknown>);
          }
        });
      },
      terminate() {
        worker.onmessage = null;
      },
    };
    return worker as unknown as Worker;
  };
  const serial = new CapRushMultiplayerRunner({ createWorker, parallelism: 1 });
  const parallel = new CapRushMultiplayerRunner({ createWorker, parallelism: 2 });
  try {
    const entry = locked.leagueSchedule[0];
    if (entry === undefined) throw new Error('missing schedule');
    const input = { roomId: 'room-test', locked, slot: 1, tapeGameIds: [entry.gameId] };
    const expected = await serial.simulateSlot(input);
    expect(await parallel.simulateSlot(input)).toEqual(expected);
    expect(expected.tapes).toHaveLength(1);
    const plans: CapRushPlayoffGamePlan[] = [0, 1, 0].map((seriesSlot, index) => {
      const home = locked.opponents[seriesSlot * 2]?.team.teamId;
      const away = locked.opponents[seriesSlot * 2 + 1]?.team.teamId;
      if (home === undefined || away === undefined) throw new Error('missing opponent');
      const gameOrdinal = index === 2 ? 2 : 1;
      return {
        seriesId: `crs-1-${String(seriesSlot)}`,
        round: 1,
        seriesSlot,
        gameOrdinal,
        homeTeamId: home,
        awayTeamId: away,
        homeSeed: 1,
        awaySeed: 8,
        userSide: null,
        isFinals: false,
        seed: capRushPlayoffGameSeed(locked.rootSeed, 1, seriesSlot, gameOrdinal),
      };
    });
    const playoffInput = { roomId: 'room-test', locked, plans, tapeGameIds: ['crp-1-1-1'] };
    const expectedPlayoffs = await serial.simulatePlayoffStep(playoffInput);
    expect(await parallel.simulatePlayoffStep(playoffInput)).toEqual(expectedPlayoffs);
    expect(expectedPlayoffs.tapes).toHaveLength(1);
  } finally {
    serial.dispose();
    parallel.dispose();
  }
});

test('recovers a dropped worker by rehydrating before retrying the projection', async () => {
  const setup = capRushTestSetup();
  const environment = { ...capRushTestEnvironment(setup), seasonCatalog: setup.catalog };
  const state = createCapRushMultiplayerState(capRushTestRootSeed());
  const workers: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    posted: string[];
    postMessage(value: unknown): void;
    terminate(): void;
  }[] = [];
  let projectRequests = 0;
  const createWorker = () => {
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      posted: [] as string[],
      terminate() {},
      postMessage(value: unknown) {
        const request = capRushMultiplayerWorkerRequestSchema.parse(value);
        worker.posted.push(request.kind);
        if (request.kind === 'cap-rush-multiplayer-hydrate') {
          worker.onmessage?.({
            data: {
              schemaVersion: request.schemaVersion,
              requestId: request.requestId,
              kind: 'cap-rush-multiplayer-hydrated',
            },
          } as MessageEvent<unknown>);
          return;
        }
        if (request.kind === 'cap-rush-multiplayer-project') {
          projectRequests += 1;
          if (projectRequests === 1) {
            worker.onerror?.({} as ErrorEvent);
            return;
          }
          worker.onmessage?.({
            data: {
              schemaVersion: request.schemaVersion,
              requestId: request.requestId,
              kind: 'cap-rush-multiplayer-projection',
              state,
              stateDigest: 'b'.repeat(64),
            },
          } as MessageEvent<unknown>);
        }
      },
    };
    workers.push(worker);
    return worker as unknown as Worker;
  };
  const runner = new CapRushMultiplayerRunner({ createWorker });
  try {
    const result = await runner.projectDetailed({
      state,
      commands: [],
      environment,
      variant: 'clash',
    });
    expect(result.stateDigest).toBe('b'.repeat(64));
    expect(workers).toHaveLength(2);
    expect(workers[0]?.posted).toEqual([
      'cap-rush-multiplayer-hydrate',
      'cap-rush-multiplayer-project',
    ]);
    expect(workers[1]?.posted).toEqual([
      'cap-rush-multiplayer-hydrate',
      'cap-rush-multiplayer-project',
    ]);
  } finally {
    runner.dispose();
  }
});

test('hydrates the catalog once, then sends only state and commands with a worker digest', async () => {
  const setup = capRushTestSetup();
  const environment = { ...capRushTestEnvironment(setup), seasonCatalog: setup.catalog };
  const state = createCapRushMultiplayerState(capRushTestRootSeed());
  const posted: import('@hoop-rush/data-contracts').CapRushMultiplayerWorkerRequest[] = [];
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null,
    terminate() {},
    postMessage(value: unknown) {
      const request = capRushMultiplayerWorkerRequestSchema.parse(value);
      posted.push(request);
      if (request.kind === 'cap-rush-multiplayer-hydrate') {
        worker.onmessage?.({
          data: {
            schemaVersion: request.schemaVersion,
            requestId: request.requestId,
            kind: 'cap-rush-multiplayer-hydrated',
          },
        } as MessageEvent<unknown>);
      }
    },
  };
  const runner = new CapRushMultiplayerRunner({ createWorker: () => worker as unknown as Worker });
  try {
    const pending = runner.projectDetailed({ state, commands: [], environment, variant: 'clash' });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(posted[0]?.kind).toBe('cap-rush-multiplayer-hydrate');
    const request = posted[1] as Extract<
      import('@hoop-rush/data-contracts').CapRushMultiplayerWorkerRequest,
      { kind: 'cap-rush-multiplayer-project' }
    >;
    expect(request.kind).toBe('cap-rush-multiplayer-project');
    expect(request.state).toEqual(state);
    expect('environment' in request).toBe(false);
    expect(capRushMultiplayerWorkerRequestSchema.safeParse(request).success).toBe(true);
    worker.onmessage?.({
      data: {
        schemaVersion: request.schemaVersion,
        requestId: request.requestId,
        kind: 'cap-rush-multiplayer-projection',
        state,
        stateDigest: 'a'.repeat(64),
      },
    } as MessageEvent<unknown>);
    expect(await pending).toEqual({ state, stateDigest: 'a'.repeat(64) });

    const warm = runner.projectDetailed({
      state,
      commands: [],
      environment,
      variant: 'clash',
      baseDigest: 'a'.repeat(64),
    });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    const warmRequest = posted[2] as Extract<
      import('@hoop-rush/data-contracts').CapRushMultiplayerWorkerRequest,
      { kind: 'cap-rush-multiplayer-project' }
    >;
    expect('state' in warmRequest).toBe(false);
    expect(warmRequest.baseDigest).toBe('a'.repeat(64));
    expect(capRushMultiplayerWorkerRequestSchema.safeParse(warmRequest).success).toBe(true);
    worker.onmessage?.({
      data: {
        schemaVersion: warmRequest.schemaVersion,
        requestId: warmRequest.requestId,
        kind: 'cap-rush-multiplayer-projection',
        state,
        stateDigest: 'a'.repeat(64),
      },
    } as MessageEvent<unknown>);
    await warm;
    expect(posted.filter((entry) => entry.kind === 'cap-rush-multiplayer-hydrate')).toHaveLength(1);
  } finally {
    runner.dispose();
  }
});
