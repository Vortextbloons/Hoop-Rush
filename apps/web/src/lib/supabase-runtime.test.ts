/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression -- bun-types@1.4.4 declares .resolves/.rejects matchers as void; Bun docs require awaiting them */
import { describe, expect, it, mock } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createFakeSupabaseHarness,
  type FakeSupabaseHarness,
} from '#lib/testing/fake-supabase-client.js';
import { fetchRoomRows, publishTransientPayload, readRoomParticipant } from './supabase-runtime';

const mockState: { harness: FakeSupabaseHarness | null } = { harness: null };

void mock.module('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options?: unknown) => {
    const harness = mockState.harness;
    if (!harness) throw new Error('fake supabase harness not installed');
    return harness.createClient(url, key, options);
  },
  REALTIME_SUBSCRIBE_STATES: {
    SUBSCRIBED: 'SUBSCRIBED',
    TIMED_OUT: 'TIMED_OUT',
    CLOSED: 'CLOSED',
    CHANNEL_ERROR: 'CHANNEL_ERROR',
  },
}));

const ROOM_ID = '00000000-0000-4000-8000-00000000000a';
const OTHER_ROOM_ID = '00000000-0000-4000-8000-00000000000b';
const ROOMS_TABLE = 'demo_rooms';
const MEMBERS_TABLE = 'demo_members';

function setup(): { harness: FakeSupabaseHarness; client: SupabaseClient } {
  const harness = createFakeSupabaseHarness();
  mockState.harness = harness;
  const client = harness.createClient('https://runtime-test.supabase.co', 'key') as SupabaseClient;
  return { harness, client };
}

function roomRows(client: SupabaseClient, roomId: string, roomSelect = 'id, revision') {
  return fetchRoomRows({
    client,
    roomsTable: ROOMS_TABLE,
    roomSelect,
    membersTable: MEMBERS_TABLE,
    membersSelect: 'participant_id, uid',
    roomId,
  });
}

describe('supabase runtime room reads', () => {
  it('returns the room and its members for one room', async () => {
    const { harness, client } = setup();
    harness.setRows(ROOMS_TABLE, [{ id: ROOM_ID, revision: 1 }]);
    harness.setRows(MEMBERS_TABLE, [
      { room_id: ROOM_ID, participant_id: 'p1', uid: 'user-1' },
      { room_id: ROOM_ID, participant_id: 'p2', uid: 'user-2' },
    ]);

    const result = await roomRows(client, ROOM_ID);

    expect(result.room).toMatchObject({ id: ROOM_ID, revision: 1 });
    expect(result.members).toHaveLength(2);
  });

  it('issues both reads before awaiting either of them', async () => {
    const { harness, client } = setup();
    harness.setRows(ROOMS_TABLE, [{ id: ROOM_ID, revision: 1 }]);
    harness.setRows(MEMBERS_TABLE, [{ room_id: ROOM_ID, participant_id: 'p1', uid: 'user-1' }]);
    const started: string[] = [];
    const original = client.from.bind(client);
    client.from = ((table: string) => {
      started.push(table);
      return original(table);
    }) as typeof client.from;

    await roomRows(client, ROOM_ID);

    // Room read first, member read started in the same turn: serial code would
    // only show one table until the room response resolved.
    expect(started).toEqual([ROOMS_TABLE, MEMBERS_TABLE]);
  });

  it('keeps the room error ahead of a membership error', async () => {
    const { harness, client } = setup();
    harness.setRows(ROOMS_TABLE, []);
    harness.setRows(MEMBERS_TABLE, []);

    await expect(roomRows(client, ROOM_ID, 'id')).rejects.toThrow(
      'authorization: cannot read room',
    );
  });

  it('rejects a room whose member list is empty', async () => {
    const { harness, client } = setup();
    harness.setRows(ROOMS_TABLE, [{ id: ROOM_ID }]);
    harness.setRows(MEMBERS_TABLE, []);

    await expect(roomRows(client, ROOM_ID)).rejects.toThrow(
      'members failed: cannot verify room membership',
    );
  });
});

describe('supabase runtime seat lookup', () => {
  it('uses a supplied uid and skips the auth round trip', async () => {
    const { harness, client } = setup();
    harness.setRows(MEMBERS_TABLE, [{ room_id: ROOM_ID, participant_id: 'p2', uid: 'user-1' }]);

    const seat = await readRoomParticipant(client, MEMBERS_TABLE, ROOM_ID, 'user-1');

    expect(seat).toBe('p2');
    expect(harness.authCalls).not.toContain('getUser');
    expect(harness.selectQueries.at(-1)).toMatchObject({
      table: MEMBERS_TABLE,
      columns: 'participant_id',
      filters: [
        { op: 'eq', column: 'room_id', value: ROOM_ID },
        { op: 'eq', column: 'uid', value: 'user-1' },
      ],
      single: true,
    });
  });

  it.each([undefined, null] as const)(
    'looks the uid up through auth when the caller uid is %s',
    async (uid) => {
      const { harness, client } = setup();
      harness.setRows(MEMBERS_TABLE, [{ room_id: ROOM_ID, participant_id: 'p1', uid: 'user-1' }]);

      expect(await readRoomParticipant(client, MEMBERS_TABLE, ROOM_ID, uid)).toBe('p1');
      expect(harness.authCalls).toContain('getUser');
    },
  );

  it('still refuses a uid that holds no seat in the room', async () => {
    const { harness, client } = setup();
    harness.setRows(MEMBERS_TABLE, [{ room_id: ROOM_ID, participant_id: 'p1', uid: 'user-1' }]);

    await expect(readRoomParticipant(client, MEMBERS_TABLE, ROOM_ID, 'user-2')).rejects.toThrow(
      'membership: no seat in this room',
    );
    await expect(
      readRoomParticipant(client, MEMBERS_TABLE, OTHER_ROOM_ID, 'user-1'),
    ).rejects.toThrow('membership: no seat in this room');
  });
});

describe('transient broadcast senders', () => {
  it('reuses one subscribed channel while a room stays active', async () => {
    const { harness, client } = setup();
    const channelsBefore = harness.channels.length;

    for (let index = 0; index < 4; index += 1) {
      await expect(
        publishTransientPayload(() => Promise.resolve(client), 'sender:steady', 'transient', {
          index,
        }),
      ).resolves.toBe(true);
    }

    expect(harness.channels.length).toBe(channelsBefore + 1);
    expect(harness.authCalls.filter((call) => call === 'setAuth')).toHaveLength(1);
  });

  it('keeps at most three sender channels and releases the rest', async () => {
    const { harness, client } = setup();
    const getClient = () => Promise.resolve(client);

    for (let index = 0; index < 9; index += 1) {
      await expect(
        publishTransientPayload(getClient, `sender:bounded:${String(index)}`, 'transient', {
          index,
        }),
      ).resolves.toBe(true);
    }

    const live = harness.channels.filter((channel) => !channel.unsubscribed);
    expect(live.length).toBe(3);
    expect(harness.removedChannels.length).toBeGreaterThan(0);
    expect(harness.broadcastSends).toHaveLength(9);
  });

  it('recreates a released sender and still publishes to that room', async () => {
    const { harness, client } = setup();
    const getClient = () => Promise.resolve(client);

    for (let index = 0; index < 6; index += 1) {
      await publishTransientPayload(getClient, `sender:recreate:${String(index)}`, 'transient', {});
    }
    await expect(
      publishTransientPayload(getClient, 'sender:recreate:0', 'transient', { again: true }),
    ).resolves.toBe(true);

    expect(harness.broadcastSends.at(-1)).toEqual({
      topic: 'sender:recreate:0',
      message: { type: 'broadcast', event: 'transient', payload: { again: true } },
    });
  });
});
