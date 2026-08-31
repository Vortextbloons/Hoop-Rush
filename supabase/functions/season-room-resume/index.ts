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
async function uid(req: Request, url: string, srk: string) {
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
  const uidVal = await uid(req, url, srk);
  if (!uidVal) return json(401, { code: 'authorization', message: 'missing auth' });
  const body = await req.json().catch(() => null);
  const roomId = body?.roomId as string | undefined;
  if (!roomId) return json(400, { code: 'phase', message: 'missing roomId' });
  const sc = createClient(url, srk);
  const { data: room, error } = await sc.from('season_rooms').select('*').eq('id', roomId).single();
  if (error || !room) return json(404, { code: 'membership', message: 'room not found' });
  const { data: member } = await sc
    .from('season_room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uidVal)
    .maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member' });

  // heartbeat: update last_seen_at for caller
  try {
    await sc
      .from('season_room_members')
      .update({ last_seen_at: new Date().toISOString() } as unknown as Record<string, unknown>)
      .eq('room_id', roomId)
      .eq('uid', uidVal);
  } catch {}

  const { count } = await sc
    .from('season_room_members')
    .select('participant_id', { count: 'exact', head: true })
    .eq('room_id', roomId);

  const { data: allMembers } = await sc
    .from('season_room_members')
    .select('participant_id, last_seen_at')
    .eq('room_id', roomId);

  const nowMs = Date.now();
  const presence = (allMembers ?? []).map((m: unknown) => {
    const row = m as { participant_id: string; last_seen_at: string | null };
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : nowMs;
    return {
      participantId: row.participant_id as 'p1' | 'p2',
      online: nowMs - lastSeen <= 15_000,
      lastSeenAt: row.last_seen_at ?? new Date(nowMs).toISOString(),
    };
  });

  const isOutdated =
    (room as unknown as { multiplayer_version?: string }).multiplayer_version !==
      'season-multiplayer-v2' ||
    Number(
      (room as unknown as { room_protocol_version?: number | string }).room_protocol_version,
    ) !== 2;

  const snap = {
    roomId: room.id,
    settings: {
      schemaVersion: 2,
      pace: room.pace,
      mode: (room as unknown as { mode?: string }).mode ?? 'season',
      roomProtocolVersion: room.room_protocol_version as unknown as 2,
      multiplayerVersion: room.multiplayer_version as unknown as 'season-multiplayer-v2',
      timerPolicyVersion: room.timer_policy_version,
    },
    phase: room.phase,
    cursor: room.cursor,
    revision: room.revision,
    digest: room.digest,
    memberCount: count ?? 0,
    codeActive:
      !!room.code &&
      !!room.code_expires_at &&
      new Date(room.code_expires_at).getTime() > Date.now(),
    expiresAt: room.code_expires_at,
    mode: (room as unknown as { mode?: string }).mode ?? 'season',
    settingsRevision: (room as unknown as { settings_revision?: number }).settings_revision ?? 0,
    guestReady: (room as unknown as { guest_ready?: boolean }).guest_ready ?? false,
    presence,
    seed: (room as unknown as { root_seed?: string }).root_seed ?? null,
    isOutdated: isOutdated || undefined,
  };

  const membership = {
    roomId: member.room_id,
    participantId: member.participant_id as 'p1' | 'p2',
    franchiseId: member.franchise_id as string,
    uid: member.uid as string,
    seat: member.seat as 'p1' | 'p2',
  };

  return json(200, { snapshot: snap, membership });
});
