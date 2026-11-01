import { capRushMultiplayerSetupSchema } from '@hoop-rush/data-contracts';
import type { MultiplayerModeAdapter, SettingsChoice } from '#lib/modes/types.js';
import { multiplayerInviteLink } from '../multiplayer/invite-link.js';
import { loadCapRushMultiplayerVersionLocks } from './cap-rush-multiplayer-assets.js';
import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte.js';
import { getCapRushMultiplayerTransport } from './cap-rush-multiplayer-transport.js';
const LAST_ROOM_KEY = 'hoop-rush:cap-rush-multiplayer:last-room';

const settingsFields: readonly SettingsChoice[] = [
  {
    key: 'variant',
    label: 'Variant',
    options: [
      { value: 'clash', label: 'Normal', description: 'No paid spins' },
      {
        value: 'roulette',
        label: 'Mutation',
        description: 'Unlocks the spin window after recruitment',
      },
    ],
  },
];

export const capRushMultiplayerModeAdapter: MultiplayerModeAdapter = {
  defaults: { variant: 'clash' },
  settingsFields,
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
