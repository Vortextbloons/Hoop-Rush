import {
  draftDuelRoomCodeSchema,
  draftDuelRoomMembershipSchema,
  idSchema,
  type DraftDuelRoomMembership,
  type Id,
} from '@hoop-rush/data-contracts';
export function inviteLinkForDraftDuelCode(code: string): string {
  const parsed = draftDuelRoomCodeSchema.parse(code);
  return `/draft-duel?code=${parsed}`;
}
export function friendlyDraftDuelJoinError(error: unknown): string {
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
  if (
    message.trimStart().startsWith('[') ||
    message.includes('invalid_format') ||
    message.includes('invalid_type')
  ) {
    return 'Enter the 4-digit code from the host.';
  }
  return message.slice(0, 240) || 'Something went wrong with the room.';
}
const MEMBERSHIP_PREFIX = 'hoop-rush:draft-duel:membership:';
const LAST_ROOM_KEY = 'hoop-rush:draft-duel:last-room';
export type StoredDraftDuelMembership = DraftDuelRoomMembership;
export function saveDraftDuelMembership(membership: StoredDraftDuelMembership): void {
  try {
    localStorage.setItem(`${MEMBERSHIP_PREFIX}${membership.roomId}`, JSON.stringify(membership));
    localStorage.setItem(LAST_ROOM_KEY, membership.roomId);
  } catch {}
}
export function loadDraftDuelMembership(roomId: string): StoredDraftDuelMembership | null {
  try {
    const parsedRoomId = idSchema.safeParse(roomId);
    if (!parsedRoomId.success) return null;
    const raw = localStorage.getItem(`${MEMBERSHIP_PREFIX}${parsedRoomId.data}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = draftDuelRoomMembershipSchema.safeParse(parsed);
    if (!result.success) return null;
    if (result.data.roomId !== parsedRoomId.data) return null;
    return result.data;
  } catch {
    return null;
  }
}
export function loadLastDraftDuelRoomId(): Id | null {
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    if (raw === null) return null;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
