import { friendlyMultiplayerError } from '../multiplayer/errors';
import { multiplayerInviteLink } from '../multiplayer/invite-link';
import {
  draftDuelRoomCodeSchema,
  draftDuelRoomMembershipSchema,
  type DraftDuelRoomMembership,
} from '@hoop-rush/data-contracts';
import { createMembershipStore } from '#lib/multiplayer-membership.js';

export function inviteLinkForDraftDuelCode(code: string): string {
  const parsed = draftDuelRoomCodeSchema.parse(code);
  return multiplayerInviteLink(parsed);
}

export function friendlyDraftDuelJoinError(error: unknown): string {
  return friendlyMultiplayerError(error);
}

const membershipStore = createMembershipStore<DraftDuelRoomMembership>({
  prefix: 'hoop-rush:draft-duel:membership:',
  lastRoomKey: 'hoop-rush:draft-duel:last-room',
  schema: draftDuelRoomMembershipSchema,
});

export type StoredDraftDuelMembership = DraftDuelRoomMembership;

export function saveDraftDuelMembership(membership: StoredDraftDuelMembership): void {
  membershipStore.save(membership);
}

export function loadDraftDuelMembership(roomId: string): StoredDraftDuelMembership | null {
  return membershipStore.load(roomId);
}

export function loadLastDraftDuelRoomId() {
  return membershipStore.loadLastRoomId();
}
