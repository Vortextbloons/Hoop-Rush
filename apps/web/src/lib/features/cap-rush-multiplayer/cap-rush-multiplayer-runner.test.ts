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
