import {
  havocMultiplayerRoomCodeSchema,
  havocMultiplayerRoomMembershipSchema,
  type HavocMultiplayerRoomMembership,
} from '@hoop-rush/data-contracts';
import { createMembershipStore } from '#lib/multiplayer-membership.js';

export function inviteLinkForHavocMultiplayerCode(code: string): string {
  const parsed = havocMultiplayerRoomCodeSchema.parse(code);
  return `/multiplayer?code=${parsed}`;
}

export function friendlyHavocMultiplayerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('unreachable') ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('name not resolved')
  )
    return 'Can’t reach the online lobby. Check your connection and try again.';
  if (
    lower.includes('anonymous sign-ins are disabled') ||
    lower.includes('anonymous sign ins are disabled')
  )
    return 'Online play is disabled on the server right now.';
  if (message.includes('invalid-code'))
    return 'That code was not found. Check the 4 digits and try again.';
  if (message.includes('code-expired')) return 'That code expired. Ask the host for a fresh code.';
  if (message.includes('room-full')) return 'That room is already full.';
  if (message.includes('rate-limit')) return 'Too many attempts. Wait a minute and try again.';
  if (message.includes('authorization') || message.includes('membership'))
    return 'You are not a member of that room.';
  if (message.includes('stale-revision')) return 'The room changed. Syncing and retrying once.';
  if (message.includes('expiry') || message.includes('expired')) return 'That room has expired.';
  if (
    message.trimStart().startsWith('[') ||
    message.includes('invalid_format') ||
    message.includes('invalid_type')
  ) {
    return 'Enter the 4-digit code from the host.';
  }
  return message.slice(0, 240) || 'Something went wrong with the room.';
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
