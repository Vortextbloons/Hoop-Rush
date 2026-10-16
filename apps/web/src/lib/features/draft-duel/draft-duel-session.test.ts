import { afterEach, describe, expect, it, vi } from 'vitest';
import { idSchema, type DraftDuelRoomSnapshot } from '@hoop-rush/data-contracts';
import { createInMemoryDraftDuelTransport } from '@hoop-rush/application/draft-duel';
import type { DraftDuelAssets } from './draft-duel-assets';
import { createDraftDuelSession } from './draft-duel-session';

type SessionInternals = {
  startTimers: () => void;
  syncFromServer: () => Promise<void>;
  applySnapshot: (snapshot: DraftDuelRoomSnapshot) => void;
  progress: number;
};

const ROOM_ID = idSchema.parse('dd-session-room');

describe('DraftDuelSession lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mirrors its state to subscribers', () => {
    const session = createDraftDuelSession({
      transport: createInMemoryDraftDuelTransport({
        clock: Date.now,
        random: { seed: 'transport-session-test' },
      }),
    });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    session.setError('Room changed.');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().error).toBe('Room changed.');

    unsubscribe();
    session.setError(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().error).toBeNull();

    session.dispose();
  });

  it('stops ticking and drops late playback frames after dispose', async () => {
    vi.useFakeTimers();
    const session = createDraftDuelSession({
      transport: createInMemoryDraftDuelTransport({
        clock: Date.now,
        random: { seed: 'transport-session-test' },
      }),
    });
    const internals = session as unknown as SessionInternals;
    const listener = vi.fn();
    session.subscribe(listener);

    internals.startTimers();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    internals.progress = 0.25;
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const callsAfterDispose = listener.mock.calls.length;

    await vi.advanceTimersByTimeAsync(1000);
    session.advancePlayback(5000);

    expect(listener.mock.calls.length).toBe(callsAfterDispose);
    expect(session.getSnapshot().progress).toBe(0.25);
  });

  it('refuses to attach, sync, or apply snapshots after dispose', async () => {
    const transport = createInMemoryDraftDuelTransport({
      clock: Date.now,
      random: { seed: 'transport-session-test' },
    });
    const resume = vi.spyOn(transport, 'resume');
    const refetch = vi.spyOn(transport, 'refetch');
    const session = createDraftDuelSession({ transport });
    const internals = session as unknown as SessionInternals;

    session.dispose();
    await session.attach(ROOM_ID);
    await internals.syncFromServer();
    internals.applySnapshot({} as DraftDuelRoomSnapshot);

    expect(resume).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
    expect(session.getSnapshot().snapshot).toBeNull();
  });

  it('reports a missing membership without touching the transport', async () => {
    const transport = createInMemoryDraftDuelTransport({
      clock: Date.now,
      random: { seed: 'transport-session-test' },
    });
    const resume = vi.spyOn(transport, 'resume');
    const session = createDraftDuelSession({
      transport,
      loadAssets: () => Promise.resolve({} as DraftDuelAssets),
      loadMembership: () => null,
    });

    await session.attach(ROOM_ID);

    expect(session.getSnapshot().error).toBe(
      'You are not a member of this room. Join from the Draft Duel lobby.',
    );
    expect(resume).not.toHaveBeenCalled();

    session.dispose();
  });
});
