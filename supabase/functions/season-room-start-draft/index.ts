import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dev-uid',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
async function resolveUid(req: Request, url: string, srk: string): Promise<string | null> {
  const ah = req.headers.get('Authorization');
  if (ah) {
    const ac = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? srk, {
      global: { headers: { Authorization: ah } },
    });
    const {
      data: { user },
    } = await ac.auth.getUser();
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
  if (!roomId) return json(400, { code: 'phase', message: 'missing roomId' });
  const sc = createClient(url, srk);
  const { data: room, error: roomErr } = await sc
    .from('season_rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (roomErr || !room) return json(404, { code: 'membership', message: 'room not found' });
  const isV2Start =
    (room as unknown as { multiplayer_version?: string }).multiplayer_version ===
      'season-multiplayer-v2' &&
    (room as unknown as { room_protocol_version?: number }).room_protocol_version === 2;
  if (!isV2Start)
    console.warn(
      `starting room ${room.id} with version ${room.multiplayer_version}/${room.room_protocol_version}, treating as v2-compatible`,
    );
  const { data: member } = await sc
    .from('season_room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uidVal)
    .maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member' });
  if (member.participant_id !== 'p1')
    return json(403, { code: 'authorization', message: 'only host can start draft' });
  if (room.phase !== 'waiting')
    return json(400, { code: 'phase', message: `cannot start draft from phase ${room.phase}` });
  const { data: allMembers, count } = await sc
    .from('season_room_members')
    .select('participant_id, last_seen_at', { count: 'exact' })
    .eq('room_id', roomId);
  if ((count ?? 0) < 2) return json(400, { code: 'phase', message: 'need 2 players to start' });
  // guest readiness gating - only for v2 rooms that have guest_ready column; for v1, allow
  const guestReadyRaw = (room as unknown as { guest_ready?: boolean }).guest_ready;
  const isV2Guest =
    (room as unknown as { multiplayer_version?: string }).multiplayer_version ===
    'season-multiplayer-v2';
  if (isV2Guest && guestReadyRaw === false)
    return json(400, { code: 'not-ready', message: 'guest not ready' });
  // presence gating: both must be online within 15s - only for v2 with last_seen_at
  const nowMs = Date.now();
  const hasPresenceColumn = (allMembers ?? []).some(
    (m) => (m as unknown as { last_seen_at?: string | null }).last_seen_at !== undefined,
  );
  if (isV2Guest && hasPresenceColumn) {
    for (const m of (allMembers ?? []) as unknown as Array<{
      participant_id: string;
      last_seen_at: string | null;
    }>) {
      if (m.last_seen_at === undefined) continue; // column not exists, treat as online
      const lastSeen = m.last_seen_at ? new Date(m.last_seen_at).getTime() : 0;
      if (m.last_seen_at && nowMs - lastSeen > 15_000) {
        return json(400, { code: 'opponent-disconnected', message: 'opponent disconnected' });
      }
    }
  }
  const { data: updated, error: updErr } = await sc
    .from('season_rooms')
    .update({ phase: 'drafting', updated_at: new Date().toISOString() })
    .eq('id', roomId)
    .select('*')
    .single();
  if (updErr || !updated)
    return json(500, { code: 'authorization', message: 'failed to start draft' });
  const presence = (
    (allMembers ?? []) as unknown as Array<{ participant_id: string; last_seen_at: string | null }>
  ).map((m) => {
    const lastSeen = m.last_seen_at ? new Date(m.last_seen_at).getTime() : nowMs;
    return {
      participantId: m.participant_id as 'p1' | 'p2',
      online: nowMs - lastSeen <= 15_000,
      lastSeenAt: m.last_seen_at ?? new Date(nowMs).toISOString(),
    };
  });
  const snap = {
    roomId: updated.id,
    settings: {
      schemaVersion: 2,
      pace: updated.pace,
      mode: (updated as unknown as { mode?: string }).mode ?? 'season',
      roomProtocolVersion: updated.room_protocol_version as unknown as 2,
      multiplayerVersion: updated.multiplayer_version as unknown as 'season-multiplayer-v2',
      timerPolicyVersion: updated.timer_policy_version,
    },
    phase: updated.phase,
    cursor: updated.cursor,
    revision: updated.revision,
    digest: updated.digest,
    memberCount: count ?? 2,
    codeActive:
      !!updated.code &&
      !!updated.code_expires_at &&
      new Date(updated.code_expires_at).getTime() > Date.now(),
    expiresAt: updated.code_expires_at,
    mode: (updated as unknown as { mode?: string }).mode ?? 'season',
    settingsRevision: (updated as unknown as { settings_revision?: number }).settings_revision ?? 0,
    guestReady: (updated as unknown as { guest_ready?: boolean }).guest_ready ?? true,
    presence,
    seed: (updated as unknown as { root_seed?: string }).root_seed ?? null,
    isOutdated: undefined,
  };
  return json(200, { snapshot: snap });
});
