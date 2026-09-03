export function inviteLinkForFixedFiveCode(code: string): string {
  return `/multiplayer?code=${code}`;
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
  return message.slice(0, 240) || 'Something went wrong joining the room.';
}

const MEMBERSHIP_PREFIX = 'hoop-rush:fixed-five:membership:';
const LAST_ROOM_KEY = 'hoop-rush:fixed-five:last-room';

export interface StoredFixedFiveMembership {
  roomId: string;
  participantId: 'p1' | 'p2';
  code: string;
}

export function saveFixedFiveMembership(membership: StoredFixedFiveMembership): void {
  try {
    localStorage.setItem(`${MEMBERSHIP_PREFIX}${membership.roomId}`, JSON.stringify(membership));
    localStorage.setItem(LAST_ROOM_KEY, membership.roomId);
  } catch {
    /* storage unavailable */
  }
}

export function loadFixedFiveMembership(roomId: string): StoredFixedFiveMembership | null {
  try {
    const raw = localStorage.getItem(`${MEMBERSHIP_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFixedFiveMembership;
    if (parsed.roomId !== roomId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadLastFixedFiveRoomId(): string | null {
  try {
    return localStorage.getItem(LAST_ROOM_KEY);
  } catch {
    return null;
  }
}

export function clearFixedFiveMembership(roomId: string): void {
  try {
    localStorage.removeItem(`${MEMBERSHIP_PREFIX}${roomId}`);
  } catch {
    /* ignore */
  }
}
