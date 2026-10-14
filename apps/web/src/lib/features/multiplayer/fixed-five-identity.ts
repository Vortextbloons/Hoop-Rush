import {
  fixedFiveRoomMembershipSchema,
  type FixedFiveRoomMembership,
} from '@hoop-rush/data-contracts';
import { createMembershipStore } from '#lib/multiplayer-membership.js';
export function friendlyFixedFiveJoinError(error: unknown): string {
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
    return 'Online play is disabled on the server right now. Solo Classic and Sandbox still work.';
  if (message.includes('invalid-code'))
    return 'That code was not found. Check the 4 digits and try again.';
  if (message.includes('code-expired')) return 'That code expired. Ask the host for a fresh code.';
  if (message.includes('room-full')) return 'That room is already full.';
  if (message.includes('rate-limit')) return 'Too many attempts. Wait a minute and try again.';
  if (message.includes('authorization') || message.includes('membership'))
    return 'You are not a member of that room.';
  if (message.includes('stale-revision')) return 'The room changed. Syncing and retrying once.';
  if (message.includes('game-in-progress'))
    return 'Finish your current match before choosing another game.';
  if (
    message.trimStart().startsWith('[') ||
    message.includes('invalid_format') ||
    message.includes('invalid_type')
  ) {
    return 'Enter the 4-digit code from the host.';
  }
  return message.slice(0, 240) || 'Something went wrong joining the room.';
}

const membershipStore = createMembershipStore<FixedFiveRoomMembership>({
  prefix: 'hoop-rush:fixed-five:membership:',
  lastRoomKey: 'hoop-rush:fixed-five:last-room',
  schema: fixedFiveRoomMembershipSchema,
});

export type StoredFixedFiveMembership = FixedFiveRoomMembership;

export function saveFixedFiveMembership(membership: StoredFixedFiveMembership): void {
  membershipStore.save(membership);
}

export function loadFixedFiveMembership(roomId: string): StoredFixedFiveMembership | null {
  return membershipStore.load(roomId);
}

export function loadLastFixedFiveRoomId() {
  return membershipStore.loadLastRoomId();
}
