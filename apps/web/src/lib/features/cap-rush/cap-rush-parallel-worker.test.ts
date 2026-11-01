import { expect, test } from 'bun:test';
import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  capRushPlayoffGameSeed,
  type CapRushWorkerMessage,
  type CapRushWorkerRequest,
  type CapRushPlayoffGamePlan,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushLeagueSlot,
  simulateCapRushPlayoffGame,
} from '@hoop-rush/engine';
import { CapRushRunner } from './cap-rush-runner';
import { lockedRun } from './cap-rush-runner-test-support';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: CapRushWorkerRequest[] = [];
  terminated = false;
  postMessage(request: CapRushWorkerRequest): void {
    this.requests.push(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: CapRushWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

function harness() {
  const workers: FakeWorker[] = [];
  const runner = new CapRushRunner({
    parallelism: 2,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  const lane = (index: number) => {
    const worker = workers[index];
    if (worker === undefined) throw new Error('missing worker');
    return worker;
  };
  return { runner, workers, lane };
}

const base = {
  schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  requestId: 'parallel-test',
} as const;

test('single-player partitions merge complete slots in order and drain asynchronous acceptance', async () => {
  const { runner, lane } = harness();
  const locked = lockedRun();
  const context = createEngineContext();
  const delivered: number[] = [];
  const expected = [1, 2].map((slot) => simulateCapRushLeagueSlot({ locked, slot, context }));
  try {
    const pending = runner.simulate({
      requestId: base.requestId,
      locked,
      startGame: 1,
      count: 2,
      handlers: {
        onGame: async (message) => {
          await Promise.resolve();
          expect(message.leagueGames).toEqual(expected[message.cursor - 1]);
          delivered.push(message.cursor);
        },
      },
    });
    expect(lane(0).requests[0]).toMatchObject({ partition: 0 });
    expect(lane(1).requests[0]).toMatchObject({ partition: 1, leagueOnly: true });
    for (const slot of [2, 1]) {
      lane(1).emit({
        ...base,
        type: 'cap-rush-league-games',
        slot,
        leagueGames: simulateCapRushLeagueSlot({ locked, slot, context, partition: 1 }),
      });
      const game = simulateCapRushGame({ locked, gameNumber: slot, context });
      lane(0).emit({
        ...base,
        type: 'cap-rush-game',
        cursor: slot,
        summary: game.summary,
        audit: game.audit,
        result: game.result,
        inputDigest: game.summary.inputDigest,
        resultDigest: game.summary.resultDigest,
        isolations: 0,
        strikes: 0,
        leagueGames: simulateCapRushLeagueSlot({ locked, slot, context, partition: 0 }),
      });
    }
    for (const index of [1, 0])
      lane(index).emit({
        ...base,
        type: 'cap-rush-complete',
        gamesDelivered: 2,
        lastCursor: 2,
        cancelled: false,
      });
    expect(await pending).toMatchObject({ gamesDelivered: 2, lastCursor: 2, cancelled: false });
    expect(delivered).toEqual([1, 2]);
  } finally {
    runner.destroy();
  }
});

test('parallel cancellation and crashes settle and terminate both workers', async () => {
  const { runner, lane, workers } = harness();
  const locked = lockedRun();
  try {
    const pending = runner.simulate({
      requestId: base.requestId,
      locked,
      startGame: 5,
      count: 2,
      handlers: {
        onGame: () => {
          throw new Error('late delivery');
        },
      },
    });
    runner.cancel();
    expect(await pending).toMatchObject({ cancelled: true, lastCursor: 4, gamesDelivered: 0 });
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    const failed = runner
      .simulate({
        requestId: 'crash-test',
        locked,
        startGame: 1,
        count: 2,
        handlers: { onGame: () => {} },
      })
      .catch((error: unknown) => error);
    lane(2).onerror?.({} as ErrorEvent);
    expect(await failed).toBeInstanceOf(Error);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  } finally {
    runner.destroy();
  }
});

test('independent playoff series run together and preserve the requested order', async () => {
  const { runner, lane } = harness();
  const locked = lockedRun();
  const games: CapRushPlayoffGamePlan[] = [0, 1, 0].map((seriesSlot, index) => {
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
      seed: capRushPlayoffGameSeed(locked.runSeed, 1, seriesSlot, gameOrdinal),
    };
  });
  const delivered: string[] = [];
  try {
    const pending = runner.simulatePlayoffs({
      requestId: base.requestId,
      locked,
      games,
      handlers: {
        onGame: (message) => {
          delivered.push(message.game.gameId);
        },
      },
    });
    expect(lane(0).requests[0]).toMatchObject({ games: [games[0], games[2]] });
    expect(lane(1).requests[0]).toMatchObject({ games: [games[1]] });
    for (const index of [1, 0, 2]) {
      const plan = games[index];
      if (plan === undefined) throw new Error('missing plan');
      const simulation = simulateCapRushPlayoffGame({
        locked,
        plan,
        context: createEngineContext(),
      });
      lane(plan.seriesSlot).emit({ ...base, type: 'cap-rush-playoff-game', game: simulation.game });
    }
    for (const index of [1, 0])
      lane(index).emit({
        ...base,
        type: 'cap-rush-playoffs-complete',
        gamesDelivered: index === 0 ? 2 : 1,
        cancelled: false,
      });
    expect(await pending).toMatchObject({ gamesDelivered: 3, cancelled: false });
    expect(delivered).toEqual(['crp-1-0-1', 'crp-1-1-1', 'crp-1-0-2']);
  } finally {
    runner.destroy();
  }
});
