export type MultiplayerErrorMapping = (message: string) => string | null | undefined;
export function friendlyMultiplayerError(
  error: unknown,
  mapping?: MultiplayerErrorMapping,
): string {
  const message = error instanceof Error ? error.message : String(error);
  const mapped = mapping?.(message);
  if (mapped) return mapped;
  const lower = message.toLowerCase();
  if (
    [
      'unreachable',
      'failed to fetch',
      'load failed',
      'networkerror',
      'err_name_not_resolved',
      'name not resolved',
    ].some((part) => lower.includes(part))
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
  if (message.includes('game-in-progress'))
    return 'Finish your current match before choosing another game.';
  if (
    message.trimStart().startsWith('[') ||
    message.includes('invalid_format') ||
    message.includes('invalid_type')
  )
    return 'Enter the 4-digit code from the host.';
  return message.slice(0, 240) || 'Something went wrong with the room.';
}
