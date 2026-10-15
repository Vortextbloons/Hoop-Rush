import {
  CLASSIC_ROLL_VERSION,
  FIXED_FIVE_AUTOPICK_VERSION,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  defaultFixedFiveVersionLocks,
  fixedFiveSetupSchema,
} from '@hoop-rush/data-contracts';
import { ENGINE_VERSION } from '@hoop-rush/engine';
import { loadRunPreamble } from '#lib/run-preamble.js';
import type { MultiplayerModeAdapter } from '#lib/modes/types.js';
import { loadLastFixedFiveRoomId, saveFixedFiveMembership } from './fixed-five-identity';
import { getFixedFiveTransport } from './fixed-five-transport';
import { FixedFiveRoomController } from './fixed-five-room-controller.svelte';
import Settings from './ModeSettings.svelte';
import { multiplayerInviteLink } from '../multiplayer/invite-link';

async function loadVersions() {
  const { manifest, profile, bracket } = await loadRunPreamble();
  return defaultFixedFiveVersionLocks({
    dataVersion: manifest.dataVersion,
    ratingVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    engineVersion: ENGINE_VERSION,
    bracketVersion: bracket.bracketVersion,
    scheduleVersion: bracket.scheduleVersion,
    classicRollVersion: CLASSIC_ROLL_VERSION,
    profileVersion: profile.profileVersion,
    multiplayerVersion: FIXED_FIVE_MULTIPLAYER_VERSION,
    autopickVersion: FIXED_FIVE_AUTOPICK_VERSION,
  });
}

export const fixedFiveModeAdapter: MultiplayerModeAdapter = {
  defaults: { sourceMode: 'classic', variant: 'ratings' },
  Settings,
  loadRoom: () => import('./FixedFiveRoom.svelte').then((module) => module.default),
  loadLastRoomId: loadLastFixedFiveRoomId,
  settingsSchema: fixedFiveSetupSchema,
  loadVersions,
  async startSettings(format, setup) {
    const settings = fixedFiveSetupSchema.parse(setup);
    return {
      gameKind: 'fixed-five',
      ...settings,
      mode:
        format === 'duel'
          ? 'duel'
          : settings.sourceMode === 'sandbox'
            ? 'sandbox-shared-82'
            : 'classic-shared-82',
      versions: await loadVersions(),
    };
  },
  async resume(roomId) {
    const { membership } = await getFixedFiveTransport().resume(roomId);
    saveFixedFiveMembership(membership);
  },
  inviteLink: multiplayerInviteLink,
  createRoomSession: (roomId) => new FixedFiveRoomController({ roomId }),
  pickTimer: (settings) => (settings.sourceMode === 'sandbox' ? '5m picks' : '90s picks'),
};
