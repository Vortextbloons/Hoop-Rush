import { havocSetupSchema } from '@hoop-rush/data-contracts';
import type { MultiplayerModeAdapter } from '#lib/modes/types.js';
import { createHavocMultiplayerSession } from './havoc-multiplayer-session';
import { loadHavocMultiplayerVersionLocks } from './havoc-multiplayer-assets';
import { getHavocMultiplayerTransport } from './havoc-multiplayer-transport';
import {
  inviteLinkForHavocMultiplayerCode,
  saveHavocMultiplayerMembership,
  loadLastHavocMultiplayerRoomId,
} from './havoc-multiplayer-identity';
import Settings from './ModeSettings.svelte';

export const havocModeAdapter: MultiplayerModeAdapter = {
  defaults: { variant: 'standard' },
  Settings,
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
