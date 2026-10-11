import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLobby,
  joinMultiplayerRoom,
  lobbyCommand,
  resumeMultiplayerGame,
} from './multiplayer-lobby';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fixedResume: vi.fn(),
  draftResume: vi.fn(),
  saveFixed: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('./fixed-five-transport', () => ({
  getMultiplayerClient: async () => ({ rpc: mocks.rpc }),
  getFixedFiveTransport: () => ({ resume: mocks.fixedResume }),
}));
vi.mock('./draft-duel-transport', () => ({
  getDraftDuelTransport: () => ({ resume: mocks.draftResume }),
}));
vi.mock('./fixed-five-identity', () => ({ saveFixedFiveMembership: mocks.saveFixed }));
vi.mock('./draft-duel-identity', () => ({ saveDraftDuelMembership: mocks.saveDraft }));

const lobbyId = '10b3b9f2-b103-4f01-a883-63885be10011';
beforeEach(() => vi.clearAllMocks());
describe('multiplayer lobby boundary', () => {
  it('rejects malformed snapshots before callers use them', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: lobbyId }, error: null });
    await expect(getLobby(lobbyId)).rejects.toThrow();
  });
  it('joins through the shared RPC without a mode', async () => {
    const data = { legacy: true, gameKind: 'draft-duel', gameRoomId: lobbyId };
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await joinMultiplayerRoom('0042')).toEqual(data);
    expect(mocks.rpc).toHaveBeenCalledWith('multiplayer_lobby_command', {
      p_command: { kind: 'join', code: '0042' },
    });
  });
  it('validates codes before sending them to the server', async () => {
    await expect(lobbyCommand({ kind: 'join', code: '42' })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves server errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'room-full' } });
    await expect(joinMultiplayerRoom('0042')).rejects.toThrow('room-full');
  });
  it.each(['fixed-five', 'draft-duel'] as const)(
    'restores the existing %s seat without joining again',
    async (kind) => {
      const membership = { roomId: lobbyId, participantId: 'p2', code: '0042' };
      mocks.fixedResume.mockResolvedValue({ membership });
      mocks.draftResume.mockResolvedValue({ membership });
      await resumeMultiplayerGame(kind, lobbyId);
      expect(kind === 'fixed-five' ? mocks.saveFixed : mocks.saveDraft).toHaveBeenCalledWith(
        membership,
      );
      expect(kind === 'fixed-five' ? mocks.draftResume : mocks.fixedResume).not.toHaveBeenCalled();
    },
  );
});
