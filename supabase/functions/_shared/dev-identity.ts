export const DEV_UID_HEADER = 'x-dev-uid';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'kong', 'host.docker.internal']);

export function isLocalSupabaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
}

export function isValidDevUid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function resolveDevUid(
  headers: Headers,
  options: { supabaseUrl: string; allowDevUid: boolean },
): string | null {
  if (!options.allowDevUid) return null;
  if (!isLocalSupabaseUrl(options.supabaseUrl)) return null;
  const devUid = (headers.get(DEV_UID_HEADER) ?? '').trim().toLowerCase();
  if (!isValidDevUid(devUid)) return null;
  return devUid;
}
