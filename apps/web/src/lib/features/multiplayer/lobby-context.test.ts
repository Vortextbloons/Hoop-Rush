import { afterEach, describe, expect, it, vi } from 'vitest';
import { LobbyCoordinator } from './lobby-context.svelte';

const lobby = {
  id: '00000000-0000-4000-8000-000000000001',
  code: '1234',
  revision: 0,
  participantId: 'p1',
  guestJoined: false,
  gameKind: null,
  gameRoomId: null,
  canStart: true,
};
vi.mock('./multiplayer-lobby', () => ({
  lobbyCommand: vi.fn(() => Promise.resolve(lobby)),
  loadLobbyId: vi.fn(() => null),
  rememberLobby: vi.fn(),
  resumeMultiplayerGame: vi.fn(() => Promise.resolve()),
}));

afterEach(() => vi.useRealTimers());

describe('layout lobby coordinator', () => {
  it('retains a failed navigation for recovery and coalesces duplicate notifications', async () => {
    vi.useFakeTimers();
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(undefined);
    const coordinator = new LobbyCoordinator(navigate);
    await coordinator.session.create();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(coordinator.snapshot.error).toContain('Check your connection');
    expect(coordinator.session.getSnapshot().navigation).toEqual({
      kind: 'lobby',
      lobbyId: lobby.id,
    });
    await coordinator.session.refresh();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot.error).toBeNull();
    expect(coordinator.session.getSnapshot().navigation).toBeNull();
    coordinator.dispose();
  });

  it('ignores a delayed navigation failure after disposal', async () => {
    vi.useFakeTimers();
    let reject: (error: Error) => void = () => {};
    const navigate = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectNavigation) => {
          reject = rejectNavigation;
        }),
    );
    const coordinator = new LobbyCoordinator(navigate);
    await coordinator.session.create();
    coordinator.dispose();
    reject(new Error('Failed to fetch'));
    await Promise.resolve();
    expect(coordinator.snapshot.error).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
