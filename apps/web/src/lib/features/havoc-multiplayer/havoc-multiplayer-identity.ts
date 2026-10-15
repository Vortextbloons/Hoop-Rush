import { friendlyMultiplayerError } from '../multiplayer/errors';
import { multiplayerInviteLink } from '../multiplayer/invite-link';
import {
  havocMultiplayerRoomCodeSchema,
  havocMultiplayerRoomMembershipSchema,
  type HavocMultiplayerRoomMembership,
} from '@hoop-rush/data-contracts';
import { createMembershipStore } from '#lib/multiplayer-membership.js';

export function inviteLinkForHavocMultiplayerCode(code: string): string {
  const parsed = havocMultiplayerRoomCodeSchema.parse(code);
  return multiplayerInviteLink(parsed);
}

export function friendlyHavocMultiplayerError(error: unknown): string {
  return friendlyMultiplayerError(error, (message) =>
    !message.includes('code-expired') && (message.includes('expiry') || message.includes('expired'))
      ? 'That room has expired.'
      : null,
  );
}

const membershipStore = createMembershipStore<HavocMultiplayerRoomMembership>({
  prefix: 'hoop-rush:havoc-multiplayer:membership:',
  lastRoomKey: 'hoop-rush:havoc-multiplayer:last-room',
  schema: havocMultiplayerRoomMembershipSchema,
});

export type StoredHavocMultiplayerMembership = HavocMultiplayerRoomMembership;

export function saveHavocMultiplayerMembership(membership: StoredHavocMultiplayerMembership): void {
  membershipStore.save(membership);
}

export function loadHavocMultiplayerMembership(
  roomId: string,
): StoredHavocMultiplayerMembership | null {
  return membershipStore.load(roomId);
}

export function loadLastHavocMultiplayerRoomId() {
  return membershipStore.loadLastRoomId();
}
