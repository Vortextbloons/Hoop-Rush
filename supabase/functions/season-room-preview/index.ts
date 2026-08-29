import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dev-uid',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'unknown';
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

async function resolveUid(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') ?? serviceRoleKey,
      {
        global: { headers: { Authorization: authHeader } },
      },
    );
    const {
      data: { user },
    } = await anonClient.auth.getUser();
    if (user) return user.id;
  }
  const devUid = req.headers.get('x-dev-uid');
  if (devUid && /^[0-9a-f-]{36}$/i.test(devUid)) return devUid;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')
    return json(405, { code: 'invalid-code', message: 'method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey)
    return json(500, { code: 'authorization', message: 'server not configured' });

  const uid = await resolveUid(req, supabaseUrl, serviceRoleKey);
  if (!uid) return json(401, { code: 'authorization', message: 'missing auth' });

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? '').trim();
  if (!/^[0-9]{4}$/.test(code)) return json(400, { code: 'invalid-code', message: 'invalid code' });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const ip = getClientIp(req);
  const ipHash = await hashIp(ip);

  const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count: uidMin } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('uid', uid)
    .gte('created_at', oneMinAgo);
  if ((uidMin ?? 0) >= 5)
    return json(429, { code: 'rate-limit', message: 'too many attempts, try again later' });
  const { count: uidHour } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('uid', uid)
    .gte('created_at', oneHourAgo);
  if ((uidHour ?? 0) >= 20)
    return json(429, { code: 'rate-limit', message: 'too many attempts, try again later' });
  const { count: ipMin } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneMinAgo);
  if ((ipMin ?? 0) >= 5)
    return json(429, { code: 'rate-limit', message: 'too many attempts, try again later' });
  const { count: ipHour } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneHourAgo);
  if ((ipHour ?? 0) >= 20)
    return json(429, { code: 'rate-limit', message: 'too many attempts, try again later' });
  await serviceClient.from('season_join_attempts').insert({ uid, ip_hash: ipHash, code });
  const { data: rooms, error } = await serviceClient
    .from('season_rooms')
    .select('*')
    .eq('code', code)
    .gt('code_expires_at', new Date().toISOString())
    .limit(1);
  if (error || !rooms || rooms.length === 0)
    return json(400, { code: 'invalid-code', message: 'invalid code' });
  const room = rooms[0];
  const snapshot = {
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
    memberCount: 0,
    codeActive: true,
    expiresAt: room.code_expires_at,
  };
  const { count: memberCount } = await serviceClient
    .from('season_room_members')
    .select('participant_id', { count: 'exact', head: true })
    .eq('room_id', room.id);
  (snapshot as { memberCount: number }).memberCount = memberCount ?? 0;
  return json(200, { snapshot });
});
