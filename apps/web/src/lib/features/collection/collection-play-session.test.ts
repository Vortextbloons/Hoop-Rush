/* eslint-disable @typescript-eslint/require-await -- fakes mirror async ports without I/O */
import { describe, expect, it } from 'vitest';
import type {
  CollectionGameRecordUnion,
  CollectionGameWorkerCompleteMessage,
  CollectionPlayState,
} from '@hoop-rush/data-contracts';
import {
  CollectionPlaySession,
  type CollectionPlaySessionDeps,
} from './collection-play-session.ts';

function playStateWith(pending: 'v1' | 'v3' | null): CollectionPlayState {
  return {
    pendingGame:
      pending === null
        ? null
        : {
            gameVersion: pending === 'v3' ? 'collection-game-v3' : 'collection-game-v1',
            gameId: 'game-1',
            gameSequence: 1,
          },
  } as unknown as CollectionPlayState;
}

function record(): CollectionGameRecordUnion {
  return {
    gameVersion: 'collection-game-v2',
    gameId: 'game-1',
  } as unknown as CollectionGameRecordUnion;
}

function completed(variant: 'v1' | 'v3'): CollectionGameWorkerCompleteMessage {
  return {
    result: { gameVersion: variant === 'v3' ? 'collection-game-v3' : 'collection-game-v1' },
    events: [],
  } as unknown as CollectionGameWorkerCompleteMessage;
}

interface Calls {
  prepareBasic: Array<{ difficultyId: string; objectiveId: string | null }>;
  prepareChallenge: Array<{ challengeId: string; objectiveId: string | null }>;
  abandonBasic: number;
  abandonChallenge: number;
  runGame: number;
  acceptBasic: number;
  acceptChallenge: number;
  loadCommitted: string[];
  reload: number;
}

function buildDeps(overrides: Partial<CollectionPlaySessionDeps> = {}) {
  const calls: Calls = {
    prepareBasic: [],
    prepareChallenge: [],
    abandonBasic: 0,
    abandonChallenge: 0,
    runGame: 0,
    acceptBasic: 0,
    acceptChallenge: 0,
    loadCommitted: [],
    reload: 0,
  };
  const deps: CollectionPlaySessionDeps = {
    ensurePlayState: async () => ({ playState: playStateWith(null), rootSeed: 'seed-1' }),
    prepareBasicGame: async (_nowIso, setup) => {
      calls.prepareBasic.push(setup);
      return { playState: playStateWith('v1') };
    },
    prepareChallengeGame: async (challengeId, objectiveId) => {
      calls.prepareChallenge.push({ challengeId, objectiveId });
      return { playState: playStateWith('v3') };
    },
    abandonBasicGame: async () => {
      calls.abandonBasic += 1;
      return playStateWith(null);
    },
    abandonChallengeGame: async () => {
      calls.abandonChallenge += 1;
      return playStateWith(null);
    },
    runGame: async () => {
      calls.runGame += 1;
      return completed('v1');
    },
    acceptBasicGameResult: async () => {
      calls.acceptBasic += 1;
      return { playState: playStateWith(null), record: record() };
    },
    acceptChallengeGameResult: async () => {
      calls.acceptChallenge += 1;
      return { playState: playStateWith(null), record: record() };
    },
    loadCommittedGame: async (gameId) => {
      calls.loadCommitted.push(gameId);
      return null;
    },
    reloadCollection: async () => {
      calls.reload += 1;
    },
    clock: {
      nowIso: () => '2026-01-01T00:00:00.000Z',
      sleep: async () => {},
    },
    anticipationMs: () => 0,
    errorMessage: (error, fallback) => (error instanceof Error ? error.message : fallback),
    ...overrides,
  };
  return { deps, calls };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CollectionPlaySession', () => {
  it('publishes the play state and seed on load', async () => {
    const { deps } = buildDeps();
    const session = new CollectionPlaySession(deps);
    await session.load();
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', rootSeed: 'seed-1' });
    expect(session.getSnapshot().playState).not.toBeNull();
  });

  it('prepares a standard game and publishes the pending matchup', async () => {
    const { deps, calls } = buildDeps();
    const session = new CollectionPlaySession(deps);
    await session.load();
    const phases: string[] = [];
    session.subscribe(() => phases.push(session.getSnapshot().phase));
    const ok = await session.prepare({
      mode: 'standard',
      difficultyId: 'pro',
      objectiveId: 'obj-lock-score-v1',
      challengeId: null,
    });
    expect(ok).toBe(true);
    expect(calls.prepareBasic).toEqual([{ difficultyId: 'pro', objectiveId: 'obj-lock-score-v1' }]);
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().playState?.pendingGame).not.toBeNull();
    expect(phases).toEqual(['preparing', 'idle']);
  });

  it('prepares a challenge game with its id and objective', async () => {
    const { deps, calls } = buildDeps();
    const session = new CollectionPlaySession(deps);
    await session.load();
    const ok = await session.prepare({
      mode: 'challenges',
      difficultyId: 'street',
      objectiveId: 'obj-three-barrage-v1',
      challengeId: 'heat-check',
    });
    expect(ok).toBe(true);
    expect(calls.prepareChallenge).toEqual([
      { challengeId: 'heat-check', objectiveId: 'obj-three-barrage-v1' },
    ]);
  });

  it('reports prepare failures without clobbering the play state', async () => {
    const { deps } = buildDeps({
      prepareBasicGame: () => Promise.reject(new Error('no catalog')),
    });
    const session = new CollectionPlaySession(deps);
    await session.load();
    const ok = await session.prepare({
      mode: 'standard',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: null,
    });
    expect(ok).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'no catalog' });
  });

  it('routes abandonment by the pending game version', async () => {
    const { deps, calls } = buildDeps();
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'challenges',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: 'heat-check',
    });
    const ok = await session.abandon();
    expect(ok).toBe(true);
    expect(calls.abandonChallenge).toBe(1);
    expect(calls.abandonBasic).toBe(0);
    expect(session.getSnapshot().playState?.pendingGame ?? null).toBeNull();
  });

  it('plays a basic game through simulation, acceptance, and collection reload', async () => {
    const { deps, calls } = buildDeps();
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'standard',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: null,
    });
    const result = await session.play();
    expect(result?.record).toBeDefined();
    expect(calls.runGame).toBe(1);
    expect(calls.acceptBasic).toBe(1);
    expect(calls.acceptChallenge).toBe(0);
    expect(calls.reload).toBe(1);
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('plays a challenge game through challenge acceptance', async () => {
    const { deps, calls } = buildDeps({
      runGame: async () => completed('v3'),
    });
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'challenges',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: 'heat-check',
    });
    const result = await session.play();
    expect(result).not.toBeNull();
    expect(calls.acceptChallenge).toBe(1);
    expect(calls.acceptBasic).toBe(0);
  });

  it('rejects a worker result for a different game version', async () => {
    const { deps } = buildDeps({ runGame: async () => completed('v1') });
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'challenges',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: 'heat-check',
    });
    const result = await session.play();
    expect(result).toBeNull();
    expect(session.getSnapshot().phase).toBe('error');
    expect(session.getSnapshot().error).toContain('different game version');
  });

  it('recovers an already committed game when acceptance fails', async () => {
    const committed = record();
    const { deps, calls } = buildDeps({
      acceptBasicGameResult: () => Promise.reject(new Error('command conflict')),
      loadCommittedGame: async (gameId) => {
        calls.loadCommitted.push(gameId);
        return committed;
      },
    });
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'standard',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: null,
    });
    const result = await session.play();
    expect(result?.record).toBe(committed);
    expect(calls.reload).toBe(1);
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('surfaces the failure and refreshes when nothing was committed', async () => {
    const { deps, calls } = buildDeps({
      acceptBasicGameResult: () => Promise.reject(new Error('worker torn down')),
      loadCommittedGame: async () => null,
    });
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'standard',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: null,
    });
    const result = await session.play();
    expect(result).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'worker torn down' });
    expect(calls.reload).toBe(1);
  });

  it('drops in-flight results after dispose', async () => {
    const pendingGame = deferred<CollectionGameWorkerCompleteMessage>();
    const { deps, calls } = buildDeps({ runGame: () => pendingGame.promise });
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'standard',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: null,
    });
    const playing = session.play();
    session.dispose();
    pendingGame.resolve(completed('v1'));
    expect(await playing).toBeNull();
    expect(calls.acceptBasic).toBe(0);
  });

  it('cancel returns the session to idle without publishing a record', async () => {
    const pendingGame = deferred<CollectionGameWorkerCompleteMessage>();
    const { deps, calls } = buildDeps({ runGame: () => pendingGame.promise });
    const session = new CollectionPlaySession(deps);
    await session.load();
    await session.prepare({
      mode: 'standard',
      difficultyId: 'street',
      objectiveId: null,
      challengeId: null,
    });
    const playing = session.play();
    session.cancel();
    pendingGame.resolve(completed('v1'));
    expect(await playing).toBeNull();
    expect(calls.acceptBasic).toBe(0);
    expect(session.getSnapshot().phase).toBe('idle');
  });
});
