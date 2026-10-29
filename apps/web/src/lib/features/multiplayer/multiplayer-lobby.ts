import {
  multiplayerLobbySchema,
  multiplayerLobbyCommandSchema,
  multiplayerRoomLookupSchema,
  multiplayerRoomPreviewSchema,
  type MultiplayerLobby,
  type MultiplayerLobbyCommand,
} from '@hoop-rush/data-contracts';
import { multiplayerMode, modeCatalog } from '#lib/modes/catalog.js';
import { createRealtimeRoomRegistry, getMultiplayerClient } from '#lib/supabase-runtime.js';

const lobbyRegistry = createRealtimeRoomRegistry({
  label: 'Lobby',
  roomsTable: 'multiplayer_lobbies',
  topic: (lobbyId) => `multiplayer-lobby-${lobbyId}`,
  getClient: getMultiplayerClient,
});

export function subscribeLobby(
  lobbyId: string,
  onChange: () => void,
  onError: (error: Error) => void,
): () => void {
  return lobbyRegistry.subscribe(lobbyId, onChange, onError).unsubscribe;
}

export type MultiplayerGameKind = NonNullable<MultiplayerLobby['gameKind']>;

export const multiplayerGameKindLabels = Object.fromEntries(
  modeCatalog.flatMap((mode) =>
    mode.multiplayer ? [[mode.multiplayer.gameKind, mode.multiplayer.label]] : [],
  ),
) as Record<MultiplayerGameKind, string>;

export function multiplayerGameRoomRouteId(kind: MultiplayerGameKind) {
  return multiplayerMode(kind).routeId;
}

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
  gameKind: MultiplayerGameKind,
  roomId: string,
): Promise<void> {
  await (await multiplayerMode(gameKind).load()).resume(roomId);
}
