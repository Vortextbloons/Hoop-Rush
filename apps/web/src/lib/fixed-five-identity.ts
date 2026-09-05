import {
  fixedFiveRoomCodeSchema,
  fixedFiveRoomMembershipSchema,
  idSchema,
  type FixedFiveRoomMembership,
  type Id,
} from '@hoop-rush/data-contracts';
export function inviteLinkForFixedFiveCode(code: string): string {
  const parsed = fixedFiveRoomCodeSchema.parse(code);
  return `/multiplayer?code=${parsed}`;
}
export function friendlyFixedFiveJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('invalid-code'))
    return 'That code was not found. Check the 4 digits and try again.';
  if (message.includes('code-expired')) return 'That code expired. Ask the host for a fresh code.';
  if (message.includes('room-full')) return 'That room is already full.';
  if (message.includes('rate-limit')) return 'Too many attempts. Wait a minute and try again.';
  if (message.includes('authorization') || message.includes('membership'))
    return 'You are not a member of that room.';
  if (message.includes('stale-revision')) return 'The room changed. Syncing and retrying once.';
  if (
    message.trimStart().startsWith('[') ||
    message.includes('invalid_format') ||
    message.includes('invalid_type')
  ) {
    return 'Enter the 4-digit code from the host.';
  }
  return message.slice(0, 240) || 'Something went wrong joining the room.';
}
const MEMBERSHIP_PREFIX = 'hoop-rush:fixed-five:membership:';
const LAST_ROOM_KEY = 'hoop-rush:fixed-five:last-room';
export type StoredFixedFiveMembership = FixedFiveRoomMembership;
export function saveFixedFiveMembership(membership: StoredFixedFiveMembership): void {
  try {
    localStorage.setItem(`${MEMBERSHIP_PREFIX}${membership.roomId}`, JSON.stringify(membership));
    localStorage.setItem(LAST_ROOM_KEY, membership.roomId);
  } catch {}
}
export function loadFixedFiveMembership(roomId: string): StoredFixedFiveMembership | null {
  try {
    const parsedRoomId = idSchema.safeParse(roomId);
    if (!parsedRoomId.success) return null;
    const raw = localStorage.getItem(`${MEMBERSHIP_PREFIX}${parsedRoomId.data}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = fixedFiveRoomMembershipSchema.safeParse(parsed);
    if (!result.success) return null;
    if (result.data.roomId !== parsedRoomId.data) return null;
    return result.data;
  } catch {
    return null;
  }
}
export function loadLastFixedFiveRoomId(): Id | null {
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
export function clearFixedFiveMembership(roomId: string): void {
  try {
    localStorage.removeItem(`${MEMBERSHIP_PREFIX}${roomId}`);
  } catch {}
}
