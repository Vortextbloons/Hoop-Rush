import { describe, expect, test } from 'bun:test';
import { createSessionTestRoom } from './session-test-fixtures.ts';

describe('cap rush multiplayer connection state', () => {
  test('reports transport health separately from opponent presence', async () => {
    const room = await createSessionTestRoom({ commandPrefix: 'conn' });
    const host = room.session('p1');
    await host.attach();
    await room.transport.join(room.code);
    const guest = room.session('p2');
    await guest.attach();

    const view = host.view();
    expect(view.connection).toBe('connected');
    expect(view.transportError).toBeNull();
    expect(view.bothOnline).toBe(true);
    expect(view.opponentOnline).toBe(true);
    host.dispose();
    guest.dispose();
  });

  test('a failed read reports the local connection as interrupted, not the opponent as away', async () => {
    const room = await createSessionTestRoom({ commandPrefix: 'fail' });
    const host = room.session('p1');
    await host.attach();
    await room.transport.join(room.code);
    const original = room.transport.sync.bind(room.transport);
    room.transport.sync = () => Promise.reject(new Error('Failed to fetch'));
    await expect(host.refresh()).rejects.toThrow('Failed to fetch');
    const failed = host.view();
    expect(failed.connection).toBe('error');
    expect(failed.transportError).toContain('Failed to fetch');
    // The last synced presence snapshot is still intact, so the opponent is
    // not mislabelled as offline by a local network failure.
    expect(failed.bothOnline).toBe(true);
    expect(failed.opponentOnline).toBe(true);

    room.transport.sync = original;
    await host.reconnect();
    expect(host.view().connection).toBe('connected');
    expect(host.view().transportError).toBeNull();
    host.dispose();
  });
});
