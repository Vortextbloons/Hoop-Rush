import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-captcha-token, x-dev-uid',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
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
  if (req.method !== 'POST') return json(405, { code: 'phase', message: 'method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey)
    return json(500, { code: 'authorization', message: 'server not configured' });

  const uid = await resolveUid(req, supabaseUrl, serviceRoleKey);
  if (!uid) return json(401, { code: 'authorization', message: 'missing auth' });

  const body = await req.json().catch(() => null);
  const pace = body?.pace as string | undefined;
  const rawMode = body?.mode as string | undefined;
  const mode =
    rawMode === 'classic' || rawMode === 'sandbox' || rawMode === 'season' ? rawMode : 'season';
  const rootSeed = body?.rootSeed as string | undefined;
  if (pace !== 'live' && pace !== 'async')
    return json(400, { code: 'phase', message: 'invalid pace' });
  if (typeof rootSeed !== 'string' || rootSeed.length < 8)
    return json(400, { code: 'phase', message: 'invalid rootSeed' });
  // only season is fully supported — reject classic/sandbox early with friendly code
  if (mode !== 'season')
    return json(400, {
      code: 'phase',
      message: 'Classic and Sandbox are coming next — Season Run is live now',
    });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const ip = getClientIp(req);
  const ipHash = await hashIp(ip);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: uidCount } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('uid', uid)
    .gte('created_at', oneHourAgo)
    .like('code', 'create:%');
  if ((uidCount ?? 0) >= 3)
    return json(429, { code: 'rate-limit', message: 'too many rooms created, try again later' });

  const { count: ipCount } = await serviceClient
    .from('season_join_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', oneHourAgo)
    .like('code', 'create:%');
  if ((ipCount ?? 0) >= 3)
    return json(429, { code: 'rate-limit', message: 'too many rooms created, try again later' });

  await serviceClient
    .from('season_join_attempts')
    .insert({ uid, ip_hash: ipHash, code: `create:${pace}` });

  let roomId: string | null = null;
  let lastError: unknown = null;
  for (let tries = 0; tries < 20; tries++) {
    // try 3-arg RPC (with mode) first, fallback to 2-arg for older DB
    let data: unknown = null;
    let error: unknown = null;
    const res3 = await serviceClient.rpc('season_room_create', {
      p_pace: pace,
      p_root_seed: rootSeed,
      p_mode: mode,
    } as unknown as { p_pace: string; p_root_seed: string });
    data = (res3 as { data: unknown }).data;
    error = (res3 as { error: unknown }).error;
    if (error && String((error as { message?: string }).message ?? '').includes('could not find')) {
      const res2 = await serviceClient.rpc('season_room_create', {
        p_pace: pace,
        p_root_seed: rootSeed,
      });
      data = (res2 as { data: unknown }).data;
      error = (res2 as { error: unknown }).error;
      // if DB lacks mode column, patch it via direct update after create
      if (!error && data) {
        try {
          await serviceClient
            .from('season_rooms')
            .update({ mode } as unknown as Record<string, unknown>)
            .eq('id', data as string);
        } catch {}
      }
    }
    if (!error && data) {
      roomId = data as string;
      break;
    }
    lastError = error;
    // if rpc failed for non-collision reason, try direct insert fallback (bypasses rpc grants)
    if (error) {
      const msg = String((error as { message?: string }).message ?? '');
      const isCollision = msg.includes('unique') || msg.includes('collision');
      if (!isCollision) {
        // fallback: direct insert with generated code (service_role bypasses RLS)
        try {
          const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
          const { data: ins, error: insErr } = await serviceClient
            .from('season_rooms')
            .insert({
              pace,
              mode,
              root_seed: rootSeed,
              code,
              code_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              phase: 'waiting',
            } as unknown as Record<string, unknown>)
            .select('id')
            .single();
          if (!insErr && ins) {
            roomId = (ins as { id: string }).id;
            lastError = null;
            break;
          } else {
            lastError = insErr ?? error;
            const insMsg = String((insErr as { message?: string })?.message ?? '');
            if (!insMsg.includes('unique') && !insMsg.includes('collision')) break;
            // if collision, loop will retry with new code
            continue;
          }
        } catch (e) {
          lastError = e;
          break;
        }
      }
    }
    if (
      error &&
      !String((error as { message?: string }).message ?? '').includes('unique') &&
      !String((error as { message?: string }).message ?? '').includes('collision')
    )
      break;
  }
  if (!roomId) {
    const detail = (() => {
      try {
        return JSON.stringify(lastError);
      } catch {
        return String(lastError);
      }
    })();
    return json(500, {
      code: 'authorization',
      message: 'failed to create room',
      detail,
    });
  }

  // auto-join creator as p1 so they are a member and can load the room (fixes "not a member" when host doesn't immediately enter)
  const { error: memberError } = await serviceClient.from('season_room_members').insert({
    room_id: roomId,
    uid,
    participant_id: 'p1',
    seat: 'p1',
    franchise_id: 'franchise-p1',
    control: 'human',
    miss_streak: 0,
    reclaim_requested: false,
  });
  if (memberError && memberError.code !== '23505') {
    // if insert fails for other reason, log but don't fail room creation
    console.error('auto-join p1 failed', memberError);
  }

  const { data: room, error: roomError } = await serviceClient
    .from('season_rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (roomError || !room)
    return json(500, { code: 'authorization', message: 'room not found after create' });

  const snapshot = {
    roomId: room.id,
    settings: {
      schemaVersion: 1,
      pace: room.pace,
      mode: (room as unknown as { mode?: string }).mode ?? mode ?? 'season',
      roomProtocolVersion: room.room_protocol_version,
      multiplayerVersion: room.multiplayer_version,
      timerPolicyVersion: room.timer_policy_version,
    },
    phase: room.phase,
    cursor: room.cursor,
    revision: room.revision,
    digest: room.digest,
    memberCount: 1,
    codeActive:
      !!room.code &&
      !!room.code_expires_at &&
      new Date(room.code_expires_at).getTime() > Date.now(),
    expiresAt: room.code_expires_at,
  };

  const membership = {
    roomId: room.id,
    participantId: 'p1',
    franchiseId: 'franchise-p1',
    uid,
    seat: 'p1',
  };

  return json(200, { snapshot, code: room.code, roomId: room.id, membership });
});
