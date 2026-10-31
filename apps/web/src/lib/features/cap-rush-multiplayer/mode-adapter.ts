import { capRushMultiplayerSetupSchema } from '@hoop-rush/data-contracts';
import type { MultiplayerModeAdapter } from '#lib/modes/types.js';
import { multiplayerInviteLink } from '../multiplayer/invite-link.js';
import { loadCapRushMultiplayerVersionLocks } from './cap-rush-multiplayer-assets.js';
import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte.js';
import { getCapRushMultiplayerTransport } from './cap-rush-multiplayer-transport.js';
import Settings from './ModeSettings.svelte';

const LAST_ROOM_KEY = 'hoop-rush:cap-rush-multiplayer:last-room';

export const capRushMultiplayerModeAdapter: MultiplayerModeAdapter = {
  defaults: { variant: 'clash' },
  Settings,
  loadRoom: () => import('./CapRushMultiplayerRoom.svelte').then((module) => module.default),
  loadLastRoomId: () => {
    try {
      return localStorage.getItem(LAST_ROOM_KEY);
    } catch {
      return null;
    }
  },
  settingsSchema: capRushMultiplayerSetupSchema,
  loadVersions: loadCapRushMultiplayerVersionLocks,
  async startSettings(_format, setup) {
    const parsed = capRushMultiplayerSetupSchema.parse(setup);
    return {
      gameKind: 'cap-rush',
      variant: parsed.variant,
      versions: await loadCapRushMultiplayerVersionLocks(),
    };
  },
  async resume(roomId) {
    await getCapRushMultiplayerTransport().resume(roomId);
    try {
      localStorage.setItem(LAST_ROOM_KEY, roomId);
    } catch {
      // Storage is optional; the room still opens.
    }
  },
  inviteLink: multiplayerInviteLink,
  createRoomSession: (roomId) => new CapRushMultiplayerController(roomId),
  pickTimer: () => '60s picks',
};
