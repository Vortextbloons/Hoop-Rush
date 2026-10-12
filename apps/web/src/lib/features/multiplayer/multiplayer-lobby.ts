import {
  multiplayerLobbySchema,
  multiplayerLobbyCommandSchema,
  multiplayerRoomLookupSchema,
  multiplayerRoomPreviewSchema,
  type MultiplayerLobby,
  type MultiplayerLobbyCommand,
} from '@hoop-rush/data-contracts';
import { getMultiplayerClient, getFixedFiveTransport } from './fixed-five-transport';
import { getDraftDuelTransport } from '$lib/features/draft-duel/draft-duel-transport';
import { saveFixedFiveMembership } from './fixed-five-identity';
import { saveDraftDuelMembership } from '$lib/features/draft-duel/draft-duel-identity';

export async function lobbyCommand(command: MultiplayerLobbyCommand): Promise<unknown> {
  const client = await getMultiplayerClient();
  const response = await client.rpc('multiplayer_lobby_command', {
    p_command: multiplayerLobbyCommandSchema.parse(command),
  });
  if (response.error) throw new Error(response.error.message);
  const data: unknown = response.data;
  return data;
}
export async function getLobby(lobbyId: string): Promise<MultiplayerLobby> {
  return multiplayerLobbySchema.parse(await lobbyCommand({ kind: 'get', lobbyId }));
}
export async function joinMultiplayerRoom(code: string) {
  return multiplayerRoomLookupSchema.parse(await lobbyCommand({ kind: 'join', code }));
}
export async function previewMultiplayerRoom(code: string) {
  return multiplayerRoomPreviewSchema.parse(await lobbyCommand({ kind: 'preview', code }));
}
export function rememberLobby(lobby: MultiplayerLobby): void {
  try {
    localStorage.setItem('hoop-rush:multiplayer:last-lobby', lobby.id);
    if (lobby.gameRoomId)
      localStorage.setItem(`hoop-rush:multiplayer:lobby:${lobby.gameRoomId}`, lobby.id);
  } catch {}
}
export function loadLobbyId(roomId?: string): string | null {
  try {
    const value = localStorage.getItem(
      roomId ? `hoop-rush:multiplayer:lobby:${roomId}` : 'hoop-rush:multiplayer:last-lobby',
    );
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}
export async function resumeMultiplayerGame(
  gameKind: 'fixed-five' | 'draft-duel',
  roomId: string,
): Promise<void> {
  if (gameKind === 'draft-duel') {
    const { membership } = await getDraftDuelTransport().resume(roomId);
    saveDraftDuelMembership(membership);
  } else {
    const { membership } = await getFixedFiveTransport().resume(roomId);
    saveFixedFiveMembership(membership);
  }
}
