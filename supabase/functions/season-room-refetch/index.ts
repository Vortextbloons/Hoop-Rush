import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

type CommandRow = {
  command_id: string;
  ordinal: number;
  run_id: string;
  payload: unknown;
  actor_participant_id: 'p1' | 'p2';
  actor_franchise_id: string;
  receipt?: { accepted?: boolean } | null;
};

function toEnvelope(roomId: string, row: CommandRow) {
  const p = row.payload;
  if (
    p &&
    typeof p === 'object' &&
    typeof (p as { ordinal?: unknown }).ordinal === 'number' &&
    typeof (p as { commandId?: unknown }).commandId === 'string'
  ) {
    return { ...(p as Record<string, unknown>), accepted: row.receipt?.accepted !== false };
  }
  return {
    schemaVersion: 2,
    roomId,
    commandId: row.command_id,
    ordinal: row.ordinal,
    runId: row.run_id,
    payload: row.payload,
    actorParticipantId: row.actor_participant_id,
    actorFranchiseId: row.actor_franchise_id,
    accepted: row.receipt?.accepted !== false,
  };
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
  const roomId = typeof body?.roomId === 'string' ? body.roomId.trim() : '';
  const rawAfter = body?.afterOrdinal;
  const afterOrdinal =
    typeof rawAfter === 'number'
      ? rawAfter
      : typeof rawAfter === 'string' && rawAfter.trim() !== ''
        ? Number(rawAfter)
        : -1;
  if (!roomId || !Number.isFinite(afterOrdinal)) {
    return json(400, { code: 'phase', message: 'missing fields' });
  }
  const sc = createClient(url, srk);
  const { data: member } = await sc
    .from('season_room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uidVal)
    .maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member' });
  const { data, error } = await sc
    .from('season_room_commands')
    .select(
      'command_id, ordinal, run_id, payload, actor_participant_id, actor_franchise_id, receipt',
    )
    .eq('room_id', roomId)
    .gt('ordinal', afterOrdinal)
    .order('ordinal', { ascending: true })
    .limit(1000);
  if (error) return json(500, { code: 'authorization', message: error.message });
  return json(200, {
    commands: (data ?? []).map((r: CommandRow) => toEnvelope(roomId, r)),
  });
});
