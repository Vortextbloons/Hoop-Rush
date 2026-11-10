import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  defaultHavocMultiplayerVersionLocks,
  type MultiplayerMatchSettings,
} from '@hoop-rush/data-contracts';
import { LobbySession, type LobbySessionDeps } from './lobby-session.ts';

const lobbyId = '00000000-0000-4000-8000-000000000001';
const roomId = '00000000-0000-4000-8000-000000000002';
const lobby = {
  id: lobbyId,
  code: '1234',
  revision: 0,
  participantId: 'p1' as const,
  guestJoined: true,
  gameKind: null,
  gameRoomId: null,
  canStart: true,
};

function harness(command: LobbySessionDeps['command']) {
  const deps: LobbySessionDeps = {
    command,
    subscribe: vi.fn<LobbySessionDeps['subscribe']>(() => () => {}),
    resumeGame: vi.fn(() => Promise.resolve()),
    rememberLobby: vi.fn(),
    friendlyError: String,
    scheduleTick: vi.fn(() => () => {}),
  };
  return new LobbySession(deps);
}

afterEach(() => vi.restoreAllMocks());

describe('replay from a finished shared-lobby match', () => {
  it('starts the next match with the settings the caller reuses', async () => {
    const settings: MultiplayerMatchSettings = {
      gameKind: 'havoc',
      variant: 'standard',
      versions: defaultHavocMultiplayerVersionLocks({
        catalogHash: 'a'.repeat(64),
        profileHash: 'b'.repeat(64),
      }),
    };
    const created = {
      ...lobby,
      revision: 1,
      gameKind: 'havoc' as const,
      gameRoomId: roomId,
      canStart: false,
    };
    const command = vi
      .fn<LobbySessionDeps['command']>()
      .mockResolvedValueOnce(lobby)
      .mockResolvedValueOnce(created);
    const session = harness(command);
    await session.attach(lobbyId);
    await session.startMatch(settings);
    expect(command).toHaveBeenLastCalledWith({
      kind: 'start',
      lobbyId,
      expectedRevision: 0,
      settings,
    });
    expect(session.getSnapshot().navigation).toEqual({ kind: 'game', gameKind: 'havoc', roomId });
    session.dispose();
  });
});
