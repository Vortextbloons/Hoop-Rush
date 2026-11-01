import { havocSetupSchema } from '@hoop-rush/data-contracts';
import type { MultiplayerModeAdapter, SettingsChoice } from '#lib/modes/types.js';
import { createHavocMultiplayerSession } from './havoc-multiplayer-session';
import { loadHavocMultiplayerVersionLocks } from './havoc-multiplayer-assets';
import { getHavocMultiplayerTransport } from './havoc-multiplayer-transport';
import {
  inviteLinkForHavocMultiplayerCode,
  saveHavocMultiplayerMembership,
  loadLastHavocMultiplayerRoomId,
} from './havoc-multiplayer-identity';
const settingsFields: readonly SettingsChoice[] = [
  {
    key: 'variant',
    label: 'Mode',
    options: [
      { value: 'standard', label: 'Standard', description: 'Open draft board' },
      { value: 'curated', label: 'Curated', description: 'Guaranteed lineup shape' },
    ],
  },
];

export const havocModeAdapter: MultiplayerModeAdapter = {
  defaults: { variant: 'standard' },
  settingsFields,
  loadRoom: () => import('./HavocMultiplayerRoom.svelte').then((module) => module.default),
  loadLastRoomId: loadLastHavocMultiplayerRoomId,
  settingsSchema: havocSetupSchema,
  loadVersions: loadHavocMultiplayerVersionLocks,
  async startSettings(_format, setup) {
    return {
      gameKind: 'havoc',
      ...havocSetupSchema.parse(setup),
      versions: await loadHavocMultiplayerVersionLocks(),
    };
  },
  async resume(roomId) {
    const { membership } = await getHavocMultiplayerTransport().resume(roomId);
    saveHavocMultiplayerMembership(membership);
  },
  inviteLink: inviteLinkForHavocMultiplayerCode,
  createRoomSession: () => createHavocMultiplayerSession(),
  pickTimer: () => '60s picks',
};
