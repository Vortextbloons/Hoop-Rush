import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultHavocMultiplayerVersionLocks } from '@hoop-rush/data-contracts';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  fixedResume: vi.fn(),
  draftResume: vi.fn(),
  havocResume: vi.fn(),
  saveFixed: vi.fn(),
  saveDraft: vi.fn(),
  saveHavoc: vi.fn(),
}));

function registerMocks(): void {
  vi.doMock('./fixed-five-transport', () => ({
    getFixedFiveTransport: () => ({ resume: mocks.fixedResume }),
  }));
  vi.doMock('$lib/supabase-runtime', () => ({
    getMultiplayerClient: () => Promise.resolve({ rpc: mocks.rpc }),
  }));
  vi.doMock('./fixed-five-identity', () => ({ saveFixedFiveMembership: mocks.saveFixed }));
  vi.doMock('$lib/features/draft-duel/draft-duel-transport', () => ({
    getDraftDuelTransport: () => ({ resume: mocks.draftResume }),
  }));
  vi.doMock('$lib/features/draft-duel/draft-duel-identity', () => ({
    saveDraftDuelMembership: mocks.saveDraft,
  }));
  vi.doMock('$lib/features/havoc-multiplayer/havoc-multiplayer-transport', () => ({
    getHavocMultiplayerTransport: () => ({ resume: mocks.havocResume }),
  }));
  vi.doMock('$lib/features/havoc-multiplayer/havoc-multiplayer-identity', () => ({
    saveHavocMultiplayerMembership: mocks.saveHavoc,
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  registerMocks();
});

async function lobbyModule(): Promise<typeof import('./multiplayer-lobby')> {
  return import('./multiplayer-lobby');
}

const lobbyId = '10b3b9f2-b103-4f01-a883-63885be10011';
const havocVersions = defaultHavocMultiplayerVersionLocks({
  engineVersion: 'engine-v1',
  rulesVersion: 'havoc-rules-v1',
  mutationCatalogVersion: 'havoc-mutations-v1',
  profileVersion: 'profile-v1',
  dataVersion: 'data-v1',
  catalogVersion: 'catalog-v1',
  catalogHash: 'a'.repeat(64),
  profileHash: 'b'.repeat(64),
});

describe('multiplayer lobby boundary', () => {
  it('rejects malformed snapshots before callers use them', async () => {
    const { getLobby } = await lobbyModule();
    mocks.rpc.mockResolvedValue({ data: { id: lobbyId }, error: null });
    await expect(getLobby(lobbyId)).rejects.toThrow();
  });
  it.each(['fixed-five', 'draft-duel', 'havoc'] as const)(
    'joins a legacy %s room through the shared RPC without a mode',
    async (gameKind) => {
      const { joinMultiplayerRoom } = await lobbyModule();
      const data = { legacy: true, gameKind, gameRoomId: lobbyId };
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect(await joinMultiplayerRoom('0042')).toEqual(data);
      expect(mocks.rpc).toHaveBeenCalledWith('multiplayer_lobby_command', {
        p_command: { kind: 'join', code: '0042' },
      });
    },
  );
  it('validates codes before sending them to the server', async () => {
    const { lobbyCommand } = await lobbyModule();
    await expect(lobbyCommand({ kind: 'join', code: '42' })).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves server errors', async () => {
    const { joinMultiplayerRoom } = await lobbyModule();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'room-full' } });
    await expect(joinMultiplayerRoom('0042')).rejects.toThrow('room-full');
  });
  it('sends havoc start settings with version locks only', async () => {
    const { lobbyCommand } = await lobbyModule();
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    await lobbyCommand({
      kind: 'start',
      lobbyId,
      expectedRevision: 3,
      settings: { gameKind: 'havoc', versions: havocVersions },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('multiplayer_lobby_command', {
      p_command: {
        kind: 'start',
        lobbyId,
        expectedRevision: 3,
        settings: { gameKind: 'havoc', versions: havocVersions },
      },
    });
  });
  it.each([
    ['fixed-five', '/multiplayer/room/[roomId]'],
    ['draft-duel', '/draft-duel/room/[roomId]'],
    ['havoc', '/havoc/room/[roomId]'],
  ] as const)('routes a %s room to %s', async (gameKind, routeId) => {
    const { multiplayerGameRoomRouteId } = await lobbyModule();
    expect(multiplayerGameRoomRouteId(gameKind)).toBe(routeId);
  });
  it.each(['fixed-five', 'draft-duel', 'havoc'] as const)(
    'restores the existing %s seat without joining again',
    async (kind) => {
      const { resumeMultiplayerGame } = await lobbyModule();
      const membership = { roomId: lobbyId, participantId: 'p2', code: '0042' };
      mocks.fixedResume.mockResolvedValue({ membership });
      mocks.draftResume.mockResolvedValue({ membership });
      mocks.havocResume.mockResolvedValue({ membership });
      await resumeMultiplayerGame(kind, lobbyId);
      const [resume, save] =
        kind === 'fixed-five'
          ? [mocks.fixedResume, mocks.saveFixed]
          : kind === 'draft-duel'
            ? [mocks.draftResume, mocks.saveDraft]
            : [mocks.havocResume, mocks.saveHavoc];
      expect(save).toHaveBeenCalledWith(membership);
      for (const other of [mocks.fixedResume, mocks.draftResume, mocks.havocResume]) {
        if (other !== resume) expect(other).not.toHaveBeenCalled();
      }
    },
  );
});
