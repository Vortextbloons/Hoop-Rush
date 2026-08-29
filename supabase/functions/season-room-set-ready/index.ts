import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dev-uid',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });
}
async function resolveUid(req: Request, url: string, srk: string): Promise<string | null> {
  const ah = req.headers.get('Authorization');
  if (ah) {
    const ac = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? srk, { global: { headers: { Authorization: ah } } });
    const { data: { user } } = await ac.auth.getUser();
    if (user) return user.id;
  }
  const du = req.headers.get('x-dev-uid');
  if (du && /^[0-9a-f-]{36}$/i.test(du)) return du;
  return null;
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'phase', message: 'method not allowed' });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !srk) return json(500, { code: 'authorization', message: 'server not configured' });
  const uidVal = await resolveUid(req, url, srk);
  if (!uidVal) return json(401, { code: 'authorization', message: 'missing auth' });
  const body = await req.json().catch(() => null);
  const roomId = String(body?.roomId ?? '').trim();
  const participantId = String(body?.participantId ?? '').trim() as 'p1' | 'p2';
  const ready = Boolean(body?.ready);
  const expectedRev = body?.expectedSettingsRevision as number | undefined;
  if (!roomId) return json(400, { code: 'phase', message: 'missing roomId' });
  if (participantId !== 'p1' && participantId !== 'p2') return json(400, { code: 'phase', message: 'invalid participant' });
  const sc = createClient(url, srk);
  const { data: room } = await sc.from('season_rooms').select('*').eq('id', roomId).single();
  if (!room) return json(404, { code: 'membership', message: 'room not found' });
  if ((room as unknown as { multiplayer_version?: string }).multiplayer_version !== 'season-multiplayer-v2' || (room as unknown as { room_protocol_version?: number }).room_protocol_version !== 2) {
    return json(400, { code: 'outdated-room', message: 'outdated room—create a new one' });
  }
  if (room.phase !== 'waiting') return json(400, { code: 'phase', message: 'can only set ready in waiting phase' });
  const { data: member } = await sc.from('season_room_members').select('*').eq('room_id', roomId).eq('uid', uidVal).maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member' });
  // guest-authorized only: only p2 can set ready, and must be own seat
  if (participantId === 'p1') return json(403, { code: 'authorization', message: 'only guest can set ready' });
  if (member.participant_id !== participantId) return json(403, { code: 'authorization', message: 'cannot set ready for other participant' });
  const currentRev = (room as unknown as { settings_revision?: number }).settings_revision ?? 0;
  if (expectedRev !== undefined && expectedRev !== currentRev) {
    return json(409, { code: 'stale-revision', message: 'stale settings revision' });
  }
  const { data: updated, error } = await sc.from('season_rooms').update({ guest_ready: ready, updated_at: new Date().toISOString() } as unknown as Record<string, unknown>).eq('id', roomId).select('*').single();
  if (error || !updated) return json(500, { code: 'authorization', message: 'failed to set ready' });
  try { await sc.from('season_room_members').update({ last_seen_at: new Date().toISOString() } as unknown as Record<string, unknown>).eq('room_id', roomId).eq('uid', uidVal); } catch {}
  const { count } = await sc.from('season_room_members').select('participant_id', { count: 'exact', head: true }).eq('room_id', roomId);
  const { data: allMembers } = await sc.from('season_room_members').select('participant_id, last_seen_at').eq('room_id', roomId);
  const nowMs = Date.now();
  const presence = (allMembers ?? []).map((m: unknown) => {
    const row = m as { participant_id: string; last_seen_at: string | null };
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : nowMs;
    return { participantId: row.participant_id as 'p1' | 'p2', online: nowMs - lastSeen <= 15_000, lastSeenAt: row.last_seen_at ?? new Date(nowMs).toISOString() };
  });
  const snap = {
    roomId: updated.id,
    settings: { schemaVersion: 2, pace: updated.pace, mode: (updated as unknown as { mode?: string }).mode ?? 'season', roomProtocolVersion: updated.room_protocol_version as unknown as 2, multiplayerVersion: updated.multiplayer_version as unknown as 'season-multiplayer-v2', timerPolicyVersion: updated.timer_policy_version },
    phase: updated.phase,
    cursor: updated.cursor,
    revision: updated.revision,
    digest: updated.digest,
    memberCount: count ?? 0,
    codeActive: !!updated.code && !!updated.code_expires_at && new Date(updated.code_expires_at).getTime() > Date.now(),
    expiresAt: updated.code_expires_at,
    mode: (updated as unknown as { mode?: string }).mode ?? 'season',
    settingsRevision: (updated as unknown as { settings_revision?: number }).settings_revision ?? currentRev,
    guestReady: (updated as unknown as { guest_ready?: boolean }).guest_ready ?? ready,
    presence,
    seed: (updated as unknown as { root_seed?: string }).root_seed ?? null,
    isOutdated: undefined,
  };
  return json(200, { snapshot: snap });
});
