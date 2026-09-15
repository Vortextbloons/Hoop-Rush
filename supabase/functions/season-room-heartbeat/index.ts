import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolveUid } from '../_shared/http.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-dev-uid, x-captcha-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { code: 'phase', message: 'method not allowed' });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !srk) return json(500, { code: 'authorization', message: 'server not configured' });
  const uidVal = await resolveUid(req, url);
  if (!uidVal) return json(401, { code: 'authorization', message: 'missing auth' });
  const body = await req.json().catch(() => null);
  const roomId = String(body?.roomId ?? '').trim();
  const participantId = String(body?.participantId ?? '').trim() as 'p1' | 'p2';
  if (!roomId || (participantId !== 'p1' && participantId !== 'p2')) {
    return json(400, { code: 'phase', message: 'missing roomId or participant' });
  }
  const sc = createClient(url, srk);
  const { data: member } = await sc
    .from('season_room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uidVal)
    .maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member' });
  if (member.participant_id !== participantId) {
    return json(403, { code: 'authorization', message: 'cannot heartbeat for other participant' });
  }
  await sc
    .from('season_room_members')
    .update({ last_seen_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('room_id', roomId)
    .eq('uid', uidVal);
  return json(200, { ok: true });
});
