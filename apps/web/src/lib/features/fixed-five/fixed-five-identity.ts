import { friendlyMultiplayerError } from '../multiplayer/errors';
import {
  fixedFiveRoomMembershipSchema,
  type FixedFiveRoomMembership,
} from '@hoop-rush/data-contracts';
import { createMembershipStore } from '#lib/multiplayer-membership.js';
export function friendlyFixedFiveJoinError(error: unknown): string {
  return friendlyMultiplayerError(error, (message) => {
    const lower = message.toLowerCase();
    if (
      lower.includes('anonymous sign-ins are disabled') ||
      lower.includes('anonymous sign ins are disabled')
    )
      return 'Online play is disabled on the server right now. Solo Classic and Sandbox still work.';
    if (!message) return 'Something went wrong joining the room.';
    return null;
  });
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
