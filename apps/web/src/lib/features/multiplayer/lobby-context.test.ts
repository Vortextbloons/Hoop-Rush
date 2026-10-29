import { afterEach, describe, expect, it, mock, vi } from 'bun:test';
import { LobbyCoordinator, initialLobbyView } from './lobby-context.svelte';
import { lobbyCommand } from './multiplayer-lobby';
import {
  defaultDraftDuelVersionLocks,
  type MultiplayerMatchSettings,
} from '@hoop-rush/data-contracts';

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
function mocked<T>(value: T): T & ReturnType<typeof mock> {
  return value as T & ReturnType<typeof mock>;
}

void mock.module('./multiplayer-lobby', () => ({
  lobbyCommand: mock(() => Promise.resolve(lobby)),
  subscribeLobby: mock(() => () => {}),
  loadLobbyId: mock(() => null),
  rememberLobby: mock(),
  resumeMultiplayerGame: mock(() => Promise.resolve()),
}));

afterEach(() => vi.useRealTimers());

describe('layout lobby coordinator', () => {
  it('opens an existing lobby as setup or guest waiting when returning without query parameters', () => {
    expect(
      initialLobbyView({ hasLobby: true, hasCode: false, hasFormat: false, showChooser: true }),
    ).toBe('create');
    expect(
      initialLobbyView({ hasLobby: false, hasCode: false, hasFormat: false, showChooser: true }),
    ).toBe('choose');
    expect(
      initialLobbyView({ hasLobby: false, hasCode: true, hasFormat: false, showChooser: true }),
    ).toBe('join');
  });

  it.each(['unmounted', 'disposed', 'replaced'] as const)(
    'does not create a match after deferred version loading when the entry is %s',
    async (change) => {
      vi.useFakeTimers();
      const coordinator = new LobbyCoordinator(vi.fn(() => Promise.resolve()));
      await coordinator.session.create();
      mocked(lobbyCommand).mockClear();
      let current = true;
      let resolveSettings: (settings: MultiplayerMatchSettings) => void = () => {};
      const preparation = coordinator.prepareMatch(
        () =>
          new Promise<MultiplayerMatchSettings>((resolve) => {
            resolveSettings = resolve;
          }),
        () => current,
      );
      if (change === 'unmounted') current = false;
      else if (change === 'disposed') coordinator.dispose();
      else {
        const replacementId = '00000000-0000-4000-8000-000000000002';
        mocked(lobbyCommand).mockResolvedValueOnce({ ...lobby, id: replacementId });
        await coordinator.session.attach(replacementId);
      }
      resolveSettings({
        gameKind: 'draft-duel',
        fairness: 'fair',
        variant: 'ratings',
        versions: defaultDraftDuelVersionLocks({ catalogHash: 'a'.repeat(64) }),
      });
      await preparation;
      expect(lobbyCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'start' }));
      coordinator.dispose();
    },
  );

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
