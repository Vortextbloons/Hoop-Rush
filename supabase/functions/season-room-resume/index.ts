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
  // verify membership via service_role (bypass RLS but check)
  const { data: member } = await sc
    .from('season_room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uidVal)
    .maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member' });
  const { count } = await sc
    .from('season_room_members')
    .select('participant_id', { count: 'exact', head: true })
    .eq('room_id', roomId);
  const snap = {
    roomId: room.id,
    settings: {
      schemaVersion: 1,
      pace: room.pace,
      mode: (room as unknown as { mode?: string }).mode ?? 'season',
      roomProtocolVersion: room.room_protocol_version,
      multiplayerVersion: room.multiplayer_version,
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
  };
  return json(200, { snapshot: snap });
});
