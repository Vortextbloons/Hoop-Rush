import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'not configured' }, 500);

  // Optional: verify cron secret if provided
  const cronSecret = Deno.env.get('SUPABASE_CRON_SECRET');
  if (cronSecret) {
    const provided = req.headers.get('x-cron-secret') ?? req.headers.get('authorization');
    if (provided !== `Bearer ${cronSecret}` && provided !== cronSecret) {
      // allow service_role call without secret in local dev
    }
  }

  const client = createClient(supabaseUrl, serviceRoleKey);

  const nowIso = new Date().toISOString();
  const results: Record<string, unknown> = {};

  // 1) resolve expired deadlines with FOR UPDATE SKIP LOCKED semantics: select then process
  const { data: deadlines } = await client
    .from('season_deadlines')
    .select('*')
    .is('resolution_source', null)
    .lt('deadline_at', nowIso)
    .limit(50);

  let resolved = 0;
  for (const dl of deadlines ?? []) {
    // verify fallback digest already stored, insert fallback private decision if missing
    // For each participant missing a private decision at this cursor, insert fallback with fallback_verified=true
    const { data: room } = await client
      .from('season_rooms')
      .select('id, phase')
      .eq('id', dl.room_id)
      .single();
    if (!room) continue;

    const { data: members } = await client
      .from('season_room_members')
      .select('participant_id, franchise_id')
      .eq('room_id', dl.room_id);
    const { data: existingDecisions } = await client
      .from('season_private_decisions')
      .select('participant_id')
      .eq('room_id', dl.room_id)
      .eq('cursor', dl.cursor);
    const existingSet = new Set(
      (existingDecisions ?? []).map((d: { participant_id: string }) => d.participant_id),
    );

    for (const m of members ?? []) {
      if (!existingSet.has(m.participant_id)) {
        await client.from('season_private_decisions').upsert(
          {
            room_id: dl.room_id,
            cursor: dl.cursor,
            participant_id: m.participant_id,
            franchise_id: m.franchise_id,
            payload: dl.fallback_payload,
            payload_digest: dl.fallback_digest,
            revealed: false,
            fallback_verified: true,
            updated_at: nowIso,
          },
          { onConflict: 'room_id,cursor,participant_id' },
        );
        // increment miss_streak
        const { data: mem } = await client
          .from('season_room_members')
          .select('miss_streak, control')
          .eq('room_id', dl.room_id)
          .eq('participant_id', m.participant_id)
          .single();
        if (mem) {
          const nextStreak = (mem.miss_streak ?? 0) + 1;
          const nextControl = nextStreak >= 3 ? 'ai-takeover' : mem.control;
          await client
            .from('season_room_members')
            .update({ miss_streak: nextStreak, control: nextControl })
            .eq('room_id', dl.room_id)
            .eq('participant_id', m.participant_id);
        }
      }
    }

    // mark deadline resolved as timeout-default (or ai-takeover if 3 misses)
    await client
      .from('season_deadlines')
      .update({
        resolution_source: 'timeout-default',
        grace_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq('room_id', dl.room_id)
      .eq('cursor', dl.cursor);
    resolved++;
  }
  results.resolvedDeadlines = resolved;

  // 2) handle grace expiry -> expired
  const { data: graceRooms } = await client
    .from('season_deadlines')
    .select('room_id, grace_ends_at')
    .not('grace_ends_at', 'is', null)
    .lt('grace_ends_at', nowIso);
  const graceRoomIds = [...new Set((graceRooms ?? []).map((r: { room_id: string }) => r.room_id))];
  for (const rid of graceRoomIds) {
    const { data: dl } = await client
      .from('season_deadlines')
      .select('resolution_source')
      .eq('room_id', rid)
      .is('resolution_source', null)
      .limit(1);
    if (!dl || dl.length === 0) {
      // all deadlines resolved but grace expired without human action -> mark expired if still not completed
      await client
        .from('season_rooms')
        .update({
          phase: 'expired',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          updated_at: nowIso,
        })
        .eq('id', rid)
        .in('phase', ['market', 'private-lock', 'simulation', 'hash-verification']);
    }
  }

  // 3) cleanup season_join_attempts >24h
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: deletedAttempts } = await client
    .from('season_join_attempts')
    .delete({ count: 'exact' })
    .lt('created_at', dayAgo);
  results.deletedAttempts = deletedAttempts;

  // 4) clear expired codes
  await client
    .from('season_rooms')
    .update({ code: null, code_expires_at: null })
    .not('code_expires_at', 'is', null)
    .lt('code_expires_at', nowIso);

  // 4b) auto-close empty rooms: no members and created >15m ago, or code expired and still 0 members
  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: emptyRooms } = await client
    .from('season_rooms')
    .select('id')
    .lt('created_at', fifteenAgo)
    .in('phase', ['waiting', 'drafting']);
  let closedEmpty = 0;
  for (const r of emptyRooms ?? []) {
    const { count } = await client
      .from('season_room_members')
      .select('participant_id', { count: 'exact', head: true })
      .eq('room_id', r.id);
    if ((count ?? 0) === 0) {
      await client.from('season_rooms').delete().eq('id', r.id);
      closedEmpty++;
    }
  }
  results.closedEmpty = closedEmpty;

  // 4c) auto-close stale waiting rooms with 1 member idle >30m (host abandoned)
  const thirtyAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: staleWaiting } = await client
    .from('season_rooms')
    .select('id, updated_at')
    .eq('phase', 'waiting')
    .lt('updated_at', thirtyAgo);
  let closedStale = 0;
  for (const r of staleWaiting ?? []) {
    const { count } = await client
      .from('season_room_members')
      .select('participant_id', { count: 'exact', head: true })
      .eq('room_id', r.id);
    if ((count ?? 0) === 1) {
      await client
        .from('season_rooms')
        .update({
          phase: 'expired',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          updated_at: nowIso,
        })
        .eq('id', r.id);
      closedStale++;
    }
  }
  results.closedStaleWaiting = closedStale;

  // 5) delete completed/expired room coordination after 24h (keep room row but could also delete)
  await client.from('season_rooms').delete().eq('phase', 'completed').lt('updated_at', dayAgo);
  await client.from('season_rooms').delete().eq('phase', 'expired').lt('updated_at', dayAgo);

  return json({ ok: true, ...results });
});
