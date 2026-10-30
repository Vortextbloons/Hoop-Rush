import { afterAll, describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  POSITIONS,
  capRushCardSchema,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  buildCapRushLockedInputs,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
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
}

const originalSelf = (globalThis as { self?: unknown }).self;

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
    const fakeSelf = {
      postMessage(message: PostedMessage) {
        posted.push(message);
        if (message.type === 'cap-rush-complete' || message.type === 'cap-rush-error') {
          settle?.();
        }
      },
      onmessage: null as ((event: { data: unknown }) => void) | null,
    };
    (globalThis as { self?: unknown }).self = fakeSelf;
    await import('./cap-rush-worker.ts');
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
});
