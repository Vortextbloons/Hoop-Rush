import type { SeasonRoomMembership, SeasonRoomCode } from '@hoop-rush/data-contracts';

const MEMBERSHIP_PREFIX = 'hoop-rush:season-room-membership:';
const CODE_PREFIX = 'hoop-rush:season-room-code:';

function isBrowser(): boolean {
  return typeof localStorage !== 'undefined';
}

export function membershipKey(roomId: string): string {
  return `${MEMBERSHIP_PREFIX}${roomId}`;
}

export function codeKey(roomId: string): string {
  return `${CODE_PREFIX}${roomId}`;
}

export function saveMembership(membership: SeasonRoomMembership): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(membershipKey(membership.roomId), JSON.stringify(membership));
  } catch {
    /* ignore */
  }
}

export function loadMembership(roomId: string): SeasonRoomMembership | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(membershipKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeasonRoomMembership;
    if (parsed?.roomId && parsed?.participantId && parsed?.franchiseId) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearMembership(roomId: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(membershipKey(roomId));
  } catch {}
}

export function saveCode(roomId: string, code: SeasonRoomCode): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(codeKey(roomId), code);
  } catch {}
}

export function loadCode(roomId: string): SeasonRoomCode | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(codeKey(roomId));
    if (raw && /^[0-9]{4}$/.test(raw)) return raw as SeasonRoomCode;
    return null;
  } catch {
    return null;
  }
}

export function clearCode(roomId: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(codeKey(roomId));
  } catch {}
}

// stores last created room id for quick lobby recovery when code lost via navigation
const LAST_ROOM_KEY = 'hoop-rush:season-last-room-id';
export function saveLastRoomId(roomId: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(LAST_ROOM_KEY, roomId);
  } catch {}
}
export function loadLastRoomId(): string | null {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(LAST_ROOM_KEY);
  } catch {
    return null;
  }
}

// map supabase error codes to user-friendly messages
export function friendlyJoinError(err: unknown): string {
  const e = err as { code?: string; message?: string; status?: number };
  const code = String(e?.code ?? '').toLowerCase();
  const msg = String(e?.message ?? '').toLowerCase();
  if (code === 'rate-limit' || code === '429' || msg.includes('too many'))
    return 'Too many attempts — wait a minute and try again.';
  if (code === 'room-full' || msg.includes('full'))
    return 'This room is already full (2/2). Ask the host for a new room.';
  if (code === 'code-expired' || msg.includes('expired'))
    return 'That code has expired — codes are live for 15 minutes. Ask the host for a new one.';
  if (code === 'invalid-code' || msg.includes('invalid'))
    return 'Invalid code — check the 4 digits (including leading zeros like 0042).';
  if (code === 'phase' || msg.includes('waiting')) return 'Room no longer accepts joins.';
  if (code === 'authorization' || e?.status === 401)
    return 'Not authorized — refresh and try again.';
  return 'Could not join — check the code or ask the host for a fresh one.';
}
