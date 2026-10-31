import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  POSITIONS,
  capRushCardSchema,
  type CapRushLeagueGame,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  buildCapRushLockedInputs,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
  capRushNextLeagueSlot,
  createEngineContext,
  simulateCapRushLeagueSlot,
} from '@hoop-rush/engine';
import { capRushTestSetup } from '../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';

function lockedRun() {
  const setup = capRushTestSetup();
  const field = capRushLeagueFieldOf(setup.lockSources.bracket);
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: 'clash',
    versionSet: setup.versionSet,
    catalog: setup.source,
    spin: null,
    picks: POSITIONS.map((slot, index) => ({
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: setup.index.bySlot.get(slot)?.[0],
        salaryDollars: 30_000_000,
      }),
    })),
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover: {
      franchise: capRushAssignFranchise({ runSeed: setup.state.runSeed, field }),
      games: buildCapRushLeagueSchedule({ runSeed: setup.state.runSeed, field }).games,
    },
  });
}

interface PostedMessage {
  type?: string;
  slot?: number;
  cursor?: number;
  playback?: unknown;
  message?: string;
  leagueGames?: CapRushLeagueGame[];
}

const originalSelf = (globalThis as { self?: unknown }).self;
const fakeSelf = {
  postMessage: (() => {}) as (message: PostedMessage) => void,
  onmessage: null as ((event: { data: unknown }) => void) | null,
};

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = fakeSelf;
  await import('./cap-rush-worker.ts');
});

afterAll(() => {
  if (originalSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = originalSelf;
  }
});

describe('Cap Rush worker broadcast ordering', () => {
  it('posts the user game before deferred league backfill', async () => {
    const posted: PostedMessage[] = [];
    let settle: (() => void) | null = null;
    const completed = new Promise<void>((resolve) => {
      settle = resolve;
    });
    fakeSelf.postMessage = (message) => {
      posted.push(message);
      if (message.type === 'cap-rush-complete' || message.type === 'cap-rush-error') {
        settle?.();
      }
    };
    fakeSelf.onmessage?.({
      data: {
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-simulate',
        requestId: 'worker-order',
        locked: lockedRun(),
        startGame: 2,
        count: 1,
        includeTape: true,
        backfillLeagueFrom: 1,
        backfillLeagueTo: 1,
      },
    });
    await completed;
    expect(posted.find((message) => message.type === 'cap-rush-error')).toBeUndefined();
    expect(posted[0]).toMatchObject({ type: 'cap-rush-game', cursor: 2 });
    expect(posted[0]?.playback).toBeDefined();
    expect(
      posted
        .filter((message) => message.type === 'cap-rush-league-games')
        .map((message) => message.slot),
    ).toEqual([1, 2]);
    expect(posted.at(-1)).toMatchObject({
      type: 'cap-rush-complete',
      cancelled: false,
      gamesDelivered: 1,
      lastCursor: 2,
    });
  }, 60_000);

  it('batches user and league results together without changing seeded league games', async () => {
    const posted: PostedMessage[] = [];
    let settle: (() => void) | null = null;
    const completed = new Promise<void>((resolve) => {
      settle = resolve;
    });
    fakeSelf.postMessage = (message) => {
      posted.push(message);
      if (message.type === 'cap-rush-complete' || message.type === 'cap-rush-error') settle?.();
    };
    const locked = lockedRun();
    fakeSelf.onmessage?.({
      data: {
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-simulate',
        requestId: 'worker-batch',
        locked,
        startGame: 1,
        count: 2,
      },
    });
    await completed;
    expect(posted.find((message) => message.type === 'cap-rush-error')).toBeUndefined();
    expect(posted.filter((message) => message.type === 'cap-rush-league-games')).toHaveLength(0);
    const games = posted.filter((message) => message.type === 'cap-rush-game');
    expect(games.map((game) => game.cursor)).toEqual([1, 2]);
    for (const game of games) {
      expect(game.playback).toBeUndefined();
      expect(game.leagueGames).toEqual(
        simulateCapRushLeagueSlot({
          locked,
          slot: game.cursor ?? 0,
          context: createEngineContext(),
        }),
      );
    }
    for (let slot = 1; slot <= 82; slot += 1) {
      expect(capRushNextLeagueSlot(locked, (slot - 1) * 14)).toBe(slot);
    }
    expect(capRushNextLeagueSlot(locked, 1148)).toBeNull();
    expect(posted.at(-1)).toMatchObject({
      type: 'cap-rush-complete',
      cancelled: false,
      gamesDelivered: 2,
      lastCursor: 2,
    });
  }, 60_000);

  it('cancels a batch at a complete slot with both user and league results delivered', async () => {
    const posted: PostedMessage[] = [];
    let settle: (() => void) | null = null;
    const completed = new Promise<void>((resolve) => {
      settle = resolve;
    });
    fakeSelf.postMessage = (message) => {
      posted.push(message);
      if (message.type === 'cap-rush-game') {
        fakeSelf.onmessage?.({
          data: {
            schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
            type: 'cap-rush-cancel',
            requestId: 'worker-cancel-batch',
          },
        });
      }
      if (message.type === 'cap-rush-complete' || message.type === 'cap-rush-error') settle?.();
    };
    fakeSelf.onmessage?.({
      data: {
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-simulate',
        requestId: 'worker-cancel-batch',
        locked: lockedRun(),
        startGame: 1,
        count: 2,
      },
    });
    await completed;
    const games = posted.filter((message) => message.type === 'cap-rush-game');
    expect(games).toHaveLength(1);
    expect(games[0]?.leagueGames).toHaveLength(14);
    expect(posted.at(-1)).toMatchObject({
      type: 'cap-rush-complete',
      cancelled: true,
      gamesDelivered: 1,
      lastCursor: 1,
    });
  }, 60_000);
});
