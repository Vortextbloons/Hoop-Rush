import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import MultiplayerPage from '../../../routes/multiplayer/+page.svelte';

const mocks = vi.hoisted(() => ({
  join: vi.fn(),
  preview: vi.fn(),
  resume: vi.fn(),
  remember: vi.fn(),
  goto: vi.fn(),
  getLobby: vi.fn(),
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({
  resolve: (path: string, params?: { roomId: string }) =>
    params ? path.replace('[roomId]', params.roomId) : path,
  asset: (path: string) => path,
}));
vi.mock('$lib/multiplayer-lobby', () => ({
  joinMultiplayerRoom: mocks.join,
  previewMultiplayerRoom: mocks.preview,
  resumeMultiplayerGame: mocks.resume,
  rememberLobby: mocks.remember,
  getLobby: mocks.getLobby,
  loadLobbyId: () => null,
  lobbyCommand: vi.fn(),
}));
vi.mock('$lib/fixed-five-identity', () => ({
  loadLastFixedFiveRoomId: () => null,
  friendlyFixedFiveJoinError: (error: Error) => error.message,
}));
vi.mock('$lib/fixed-five-transport', () => ({ isFixedFiveSupabaseConfigured: () => true }));
vi.mock('$lib/draft-duel-transport', () => ({ isDraftDuelSupabaseConfigured: () => true }));
vi.mock('$lib/draft-duel/draft-duel-controller.svelte', () => ({
  DraftDuelController: class {
    dispose() {}
  },
}));

const lobby = {
  id: '10b3b9f2-b103-4f01-a883-63885be10011',
  code: '0042',
  revision: 2,
  participantId: 'p2',
  guestJoined: true,
  gameKind: 'draft-duel',
  gameRoomId: '10b3b9f2-b103-4f01-a883-63885be10012',
  canStart: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/multiplayer');
});

describe('multiplayer entry', () => {
  it('starts with create and join choices, without mode selection', () => {
    const screen = render(MultiplayerPage);
    expect(screen.getByRole('button', { name: 'Create a room' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join a room' })).toBeTruthy();
    expect(screen.queryByText('Match format')).toBeNull();
  });

  it('opens mode configuration only when creating', async () => {
    const screen = render(MultiplayerPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Create a room' }));
    expect(screen.getByRole('heading', { name: 'Match format' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Draft Duel' })).toBeTruthy();
  });

  it.each(['fixed-five', 'draft-duel'] as const)('joins %s with only a code', async (gameKind) => {
    mocks.join.mockResolvedValue({ ...lobby, gameKind });
    const screen = render(MultiplayerPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Join a room' }));
    expect(screen.queryByRole('heading', { name: 'Match format' })).toBeNull();
    await fireEvent.input(screen.getByLabelText('Room code'), { target: { value: '0042' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    await waitFor(() => {
      expect(mocks.join).toHaveBeenCalledWith('0042');
    });
    await waitFor(() => {
      expect(mocks.resume).toHaveBeenCalledWith(gameKind, lobby.gameRoomId);
    });
    expect(mocks.remember).toHaveBeenCalledWith({ ...lobby, gameKind });
    expect(mocks.goto).toHaveBeenCalledWith(
      gameKind === 'draft-duel'
        ? `/draft-duel/room/${lobby.gameRoomId}`
        : `/multiplayer/room/${lobby.gameRoomId}`,
    );
  });

  it('keeps the guest in the shared lobby after a completed match', async () => {
    mocks.join.mockResolvedValue({ ...lobby, canStart: true });
    const screen = render(MultiplayerPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Join a room' }));
    await fireEvent.input(screen.getByLabelText('Room code'), { target: { value: '0042' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Waiting for your host' })).toBeTruthy();
    });
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledWith(`/multiplayer?lobby=${lobby.id}`);
  });
});
