import { describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  capRushLeagueGameId,
  capRushLeagueGameSchema,
  type CapRushLeagueGame,
  type CapRushLockedInputs,
  type CapRushWorkerMessage,
} from '@hoop-rush/data-contracts';
import { CapRushRunner, type CapRushRunnerHandlers } from './cap-rush-runner';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  crash(): void {
    this.onerror?.({ error: new Error('worker crashed') } as ErrorEvent);
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

const LOCKED = {} as CapRushLockedInputs;

function participant(slot: 'PG' | 'SG' | 'SF' | 'PF' | 'C', playerId: string, points: number) {
  return {
    slot,
    kind: 'starter' as const,
    playerId,
    displayName: playerId,
    minutes: 30,
    points,
    rebounds: 5,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 3,
    steals: 1,
    blocks: 1,
    turnovers: 2,
    fouls: 2,
    fieldGoalsMade: 8,
    fieldGoalsAttempted: 16,
    threesMade: 2,
    threesAttempted: 5,
    freeThrowsMade: 2,
    freeThrowsAttempted: 2,
    adjustments: 0,
  };
}

function leagueGame(slot = 1): CapRushLeagueGame {
  const homeTeamId = 'celtics';
  const awayTeamId = 'knicks';
  const homeParticipants = (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((position, index) =>
    participant(position, `home-${String(index)}`, 20),
  );
  const awayParticipants = (['PG', 'SG', 'SF', 'PF', 'C'] as const).map((position, index) =>
    participant(position, `away-${String(index)}`, 18),
  );
  return capRushLeagueGameSchema.parse({
    gameId: capRushLeagueGameId(slot, homeTeamId, awayTeamId),
    slot,
    homeTeamId,
    awayTeamId,
    homePoints: 100,
    awayPoints: 90,
    winnerTeamId: homeTeamId,
    box: {
      home: {
        teamId: homeTeamId,
        displayName: 'Celtics',
        points: 100,
        adjustments: 0,
        teamBonusPoints: 0,
        periods: [25, 25, 25, 25],
        participants: homeParticipants,
      },
      away: {
        teamId: awayTeamId,
        displayName: 'Knicks',
        points: 90,
        adjustments: 0,
        teamBonusPoints: 0,
        periods: [22, 23, 22, 23],
        participants: awayParticipants,
      },
      overtimePeriods: 0,
    },
    inputDigest: 'a'.repeat(32),
    resultDigest: 'b'.repeat(32),
  });
}

function leagueGamesMessage(requestId: string, slot = 1): CapRushWorkerMessage {
  return {
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-league-games',
    requestId,
    slot,
    leagueGames: [leagueGame(slot)],
  };
}

function progressMessage(requestId: string): CapRushWorkerMessage {
  return {
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-progress',
    requestId,
    gamesCompleted: 1,
    gamesTotal: 2,
  };
}

function completeMessage(
  requestId: string,
  cancelled = false,
): CapRushWorkerMessage {
  return {
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-complete',
    requestId,
    gamesDelivered: 1,
    cancelled,
    lastCursor: 1,
  };
}

function errorMessage(requestId: string): CapRushWorkerMessage {
  return {
    schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
    type: 'cap-rush-error',
    requestId,
    code: 'internal',
    message: 'boom',
    gameNumber: null,
  };
}

function simulate(
  runner: CapRushRunner,
  requestId: string,
  handlers: CapRushRunnerHandlers = { onGame: () => {} },
) {
  return runner.simulate({
    requestId,
    locked: LOCKED,
    startGame: 1,
    count: 1,
    handlers,
  });
}

describe('CapRushRunner', () => {
  it('posts the request, reuses the worker, and maps completion messages', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const pending = simulate(runner, 'req-1');
    expect(fake.posted[0]).toMatchObject({ type: 'cap-rush-simulate', requestId: 'req-1' });
    fake.emit(completeMessage('req-1'));
    await expect(pending).resolves.toMatchObject({ type: 'cap-rush-complete' });
    expect(fake.terminated).toBe(false);

    const standings = runner.simulateStandings({
      requestId: 'req-2',
      locked: LOCKED,
      bracket: {} as never,
    });
    expect(fake.posted[1]).toMatchObject({ type: 'cap-rush-standings', requestId: 'req-2' });
    fake.emit({
      schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
      type: 'cap-rush-standings-complete',
      requestId: 'req-2',
      result: null,
      cancelled: false,
    });
    await expect(standings).resolves.toMatchObject({ type: 'cap-rush-standings-complete' });
  });

  it('rejects concurrent jobs without disturbing the active job', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const pending = simulate(runner, 'req-1');
    await expect(simulate(runner, 'req-2')).rejects.toThrow(
      'a cap rush season job is already running',
    );
    await expect(
      runner.simulateStandings({ requestId: 'req-3', locked: LOCKED, bracket: {} as never }),
    ).rejects.toThrow('a cap rush job is already running');
    fake.emit(completeMessage('req-1'));
    await expect(pending).resolves.toMatchObject({ requestId: 'req-1' });
  });

  it('serializes async stream handlers and settles only after the queue drains', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = simulate(runner, 'req-1', {
      onGame: () => {},
      onLeagueGames: async (message) => {
        if (message.slot === 1) await gate;
        order.push(message.slot);
      },
    });
    fake.emit(leagueGamesMessage('req-1', 1));
    fake.emit(leagueGamesMessage('req-1', 2));
    fake.emit(completeMessage('req-1'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await pending;
    expect(order).toEqual([1, 2]);
  });

  it('cancels and rejects with the handler error after draining the queue', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const pending = simulate(runner, 'req-1', {
      onGame: () => {},
      onLeagueGames: () => {
        throw new Error('acceptance failed');
      },
    });
    fake.emit(leagueGamesMessage('req-1'));
    fake.emit(completeMessage('req-1', true));
    await expect(pending).rejects.toThrow('acceptance failed');
    expect(
      fake.posted.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'cap-rush-cancel',
      ),
    ).toBe(true);
  });

  it('drains the handler queue before rejecting a worker error', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = simulate(runner, 'req-1', {
      onGame: () => {},
      onLeagueGames: async () => {
        await gate;
        order.push('handler');
      },
      onError: () => {
        order.push('error');
      },
    });
    fake.emit(leagueGamesMessage('req-1'));
    fake.emit(errorMessage('req-1'));
    await Promise.resolve();
    expect(order).toEqual(['error']);
    release();
    await expect(pending).rejects.toThrow('internal: boom');
    expect(order).toEqual(['error', 'handler']);
  });

  it('resolves cancellation through the completion message', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const pending = simulate(runner, 'req-1');
    runner.cancel();
    expect(fake.posted[1]).toMatchObject({ type: 'cap-rush-cancel', requestId: 'req-1' });
    fake.emit(completeMessage('req-1', true));
    await expect(pending).resolves.toMatchObject({ cancelled: true });
  });

  it('ignores stale messages and late messages after settlement', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const seen: number[] = [];
    const pending = simulate(runner, 'req-1', {
      onGame: () => {},
      onLeagueGames: (message) => {
        seen.push(message.slot);
      },
    });
    fake.emit(leagueGamesMessage('other', 1));
    fake.emit(leagueGamesMessage('req-1', 1));
    fake.emit(completeMessage('req-1'));
    await pending;
    fake.emit(leagueGamesMessage('req-1', 2));
    fake.emit(errorMessage('req-1'));
    await Promise.resolve();
    expect(seen).toEqual([1]);
    expect(runner.busy).toBe(false);
  });

  it('rejects an invalid message, terminates, and creates a fresh worker next time', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const runner = new CapRushRunner({
      createWorker: () => (workers.shift() ?? second).asWorker(),
    });
    const pending = simulate(runner, 'req-1');
    first.emit('not-an-object');
    await expect(pending).rejects.toThrow('cap rush worker sent an unrecognised message');
    expect(first.terminated).toBe(true);

    const next = simulate(runner, 'req-2');
    expect(second.posted[0]).toMatchObject({ type: 'cap-rush-simulate', requestId: 'req-2' });
    second.emit(completeMessage('req-2'));
    await next;
  });

  it('rejects a pending job when destroyed', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const pending = simulate(runner, 'req-1');
    runner.destroy();
    await expect(pending).rejects.toThrow('cap rush runner destroyed');
    expect(fake.terminated).toBe(true);
  });

  it('forwards progress without queueing it', async () => {
    const fake = new FakeWorker();
    const runner = new CapRushRunner({ createWorker: () => fake.asWorker() });
    const progress: number[] = [];
    const pending = simulate(runner, 'req-1', {
      onGame: () => {},
      onProgress: (message) => {
        progress.push(message.gamesCompleted);
      },
    });
    fake.emit(progressMessage('req-1'));
    fake.emit(completeMessage('req-1'));
    await pending;
    expect(progress).toEqual([1]);
  });
});
