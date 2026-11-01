import { draftDuelSetupSchema } from '@hoop-rush/data-contracts';
import type { MultiplayerModeAdapter } from '#lib/modes/types.js';
import { createDraftDuelSession } from './draft-duel-session';
import { getDraftDuelTransport } from './draft-duel-transport';
import {
  inviteLinkForDraftDuelCode,
  loadLastDraftDuelRoomId,
  saveDraftDuelMembership,
} from './draft-duel-identity';
import { knowledgeField } from '#lib/modes/settings-fields.js';
import type { SettingsChoice } from '#lib/modes/types.js';

const settingsFields: readonly SettingsChoice[] = [
  {
    key: 'fairness',
    label: 'Fairness',
    options: [
      { value: 'fair', label: 'Fair', description: 'Shared strength bands' },
      { value: 'unfair', label: 'Unfair', description: 'Equal player odds' },
    ],
  },
  knowledgeField,
];

async function loadVersions() {
  const session = createDraftDuelSession();
  try {
    return await session.roomVersions();
  } finally {
    session.dispose();
  }
}
export const draftDuelModeAdapter: MultiplayerModeAdapter = {
  defaults: { fairness: 'fair', variant: 'ratings' },
  settingsFields,
  loadRoom: () => import('./DraftDuelRoom.svelte').then((module) => module.default),
  loadLastRoomId: loadLastDraftDuelRoomId,
  settingsSchema: draftDuelSetupSchema,
  loadVersions,
  async startSettings(_format, setup) {
    const settings = draftDuelSetupSchema.parse(setup);
    return { gameKind: 'draft-duel', ...settings, versions: await loadVersions() };
  },
  async resume(roomId) {
    const { membership } = await getDraftDuelTransport().resume(roomId);
    saveDraftDuelMembership(membership);
  },
  inviteLink: inviteLinkForDraftDuelCode,
  createRoomSession: () => createDraftDuelSession(),
  pickTimer: () => '60s picks',
};
