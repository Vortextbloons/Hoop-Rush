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
  if ((uidMin ?? 0) >= 30) return json(429, { code: 'rate-limit', message: 'too many attempts' });
  const { count: uidHour } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('uid', uid)
    .gte('created_at', oneHourAgo);
  if ((uidHour ?? 0) >= 100) return json(429, { code: 'rate-limit', message: 'too many attempts' });
  const { count: ipMin } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneMinAgo);
  if ((ipMin ?? 0) >= 30) return json(429, { code: 'rate-limit', message: 'too many attempts' });
  const { count: ipHour } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneHourAgo);
  if ((ipHour ?? 0) >= 100) return json(429, { code: 'rate-limit', message: 'too many attempts' });
  await serviceClient.from('season_join_attempts').insert({ uid, ip_hash: ipHash, code });
  const { data: rooms } = await serviceClient
    .from('season_rooms')
    .select('*')
    .eq('code', code)
    .gt('code_expires_at', new Date().toISOString())
    .limit(1);
  if (!rooms || rooms.length === 0)
    return json(400, { code: 'invalid-code', message: 'invalid code' });
  const room = rooms[0];
  // allow both v1 and v2 - log outdated but don't block join, to keep backward compat until migration is fully applied
  const isOutdatedJoin = (room as unknown as { multiplayer_version?: string }).multiplayer_version !== 'season-multiplayer-v2' || (room as unknown as { room_protocol_version?: number }).room_protocol_version !== 2;
  if (isOutdatedJoin) console.warn(`joining room ${room.id} with outdated version ${room.multiplayer_version} / ${room.room_protocol_version}, allowing for now`);
  const { data: existingMember } = await serviceClient
    .from('season_room_members')
    .select('*')
    .eq('room_id', room.id)
    .eq('uid', uid)
    .maybeSingle();
  if (existingMember) {
    // heartbeat
    try {
      await serviceClient.from('season_room_members').update({ last_seen_at: new Date().toISOString() } as unknown as Record<string, unknown>).eq('room_id', room.id).eq('uid', uid);
    } catch {}
    return json(200, {
      membership: {
        roomId: existingMember.room_id,
        participantId: existingMember.participant_id,
        franchiseId: existingMember.franchise_id,
        uid: existingMember.uid,
        seat: existingMember.seat,
      },
    });
  }
  const { data: members } = await serviceClient
    .from('season_room_members')
    .select('*')
    .eq('room_id', room.id);
  const memberCount = members?.length ?? 0;
  if (memberCount >= 2) return json(400, { code: 'room-full', message: 'room is full' });
  if (room.phase !== 'waiting')
    return json(400, { code: 'phase', message: 'room not in waiting phase' });
  // check code expiry already filtered but also handle expired
  const participantId = memberCount === 0 ? 'p1' : 'p2';
  const franchiseId = participantId === 'p1' ? 'franchise-p1' : 'franchise-p2';
  const seat = participantId;
  let insertError: unknown = null;
  {
    const base = {
      room_id: room.id,
      uid,
      participant_id: participantId,
      seat,
      franchise_id: franchiseId,
      control: 'human',
      miss_streak: 0,
      reclaim_requested: false,
    } as unknown as Record<string, unknown>;
    const withSeen = { ...base, last_seen_at: new Date().toISOString() } as unknown as Record<string, unknown>;
    let res = await serviceClient.from('season_room_members').insert(withSeen);
    insertError = (res as { error: unknown }).error;
    if (insertError && String((insertError as { message?: string }).message ?? '').includes('last_seen_at')) {
      const retry = await serviceClient.from('season_room_members').insert(base);
      insertError = (retry as { error: unknown }).error;
    }
  }
  if (insertError) {
    const msg = String((insertError as { message?: string }).message ?? '');
    const code = (insertError as { code?: string }).code;
    if (msg.includes('duplicate') || code === '23505')
      return json(400, { code: 'room-full', message: 'room is full' });
    return json(500, {
      code: 'authorization',
      message: 'failed to join',
      detail: msg,
    });
  }
  if (memberCount + 1 === 2) {
    await serviceClient
      .from('season_rooms')
      .update({ code: null, code_expires_at: null, updated_at: new Date().toISOString() })
      .eq('id', room.id);
  }
  return json(200, { membership: { roomId: room.id, participantId, franchiseId, uid, seat } });
});
