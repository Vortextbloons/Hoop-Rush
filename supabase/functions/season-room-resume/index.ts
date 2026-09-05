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
  // Finding 3: optional afterOrdinal to allow fetchSnap+refetch in one RTT (snapshot + commands since afterOrdinal)
  const rawAfter = body?.afterOrdinal;
  const afterOrdinal =
    typeof rawAfter === 'number' && Number.isFinite(rawAfter)
      ? rawAfter
      : typeof rawAfter === 'string' && rawAfter !== '' && Number.isFinite(Number(rawAfter))
        ? Number(rawAfter)
        : null;
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

  // heartbeat: update last_seen_at for caller (fire-and-forget, don't block snapshot)
  const heartbeat = sc
    .from('season_room_members')
    .update({ last_seen_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('room_id', roomId)
    .eq('uid', uidVal)
    .then(
      () => {},
      () => {},
    );

  // Parallelize independent member queries (finding 3: was 5 sequential DB queries, now 3 parallelizable)
  const countPromise = sc
    .from('season_room_members')
    .select('participant_id', { count: 'exact', head: true })
    .eq('room_id', roomId);
  const membersPromise = sc
    .from('season_room_members')
    .select('participant_id, last_seen_at')
    .eq('room_id', roomId);
  // Optional commands fetch in same RTT when afterOrdinal provided
  const commandsPromise =
    afterOrdinal !== null
      ? sc
          .from('season_room_commands')
          .select(
            'command_id, ordinal, run_id, payload, actor_participant_id, actor_franchise_id, receipt',
          )
          .eq('room_id', roomId)
          .gt('ordinal', afterOrdinal)
          .order('ordinal', { ascending: true })
          .limit(1000)
      : null;
  // locks + attestations for current cursor (auto-refresh without manual reload)
  const locksPromise = sc
    .from('season_private_decisions')
    .select('participant_id, revealed, cursor')
    .eq('room_id', roomId)
    .eq('cursor', (room as unknown as { cursor?: string }).cursor ?? room.cursor ?? '');
  const attestPromise = sc
    .from('season_checkpoint_attestations')
    .select('participant_id, attempt, input_digest, result_digest')
    .eq('room_id', roomId)
    .eq('cursor', (room as unknown as { cursor?: string }).cursor ?? room.cursor ?? '');

  const [
    { count },
    { data: allMembers },
    commandsResult,
    { data: locksRows },
    { data: attestRows },
  ] = await Promise.all([
    countPromise,
    membersPromise,
    commandsPromise ?? Promise.resolve({ data: null } as unknown as { data: unknown }),
    locksPromise,
    attestPromise,
  ]);
  // ensure heartbeat settled (already fire-and-forget)
  await heartbeat.catch(() => {});

  // Transform fetched commands to envelope shape (same as season-room-refetch)
  let commands: unknown[] | undefined;
  if (
    afterOrdinal !== null &&
    commandsResult &&
    Array.isArray((commandsResult as { data?: unknown }).data)
  ) {
    const rows = (commandsResult as { data: unknown[] }).data as Array<{
      command_id: string;
      ordinal: number;
      run_id: string;
      payload: unknown;
      actor_participant_id: 'p1' | 'p2';
      actor_franchise_id: string;
      receipt?: { accepted?: boolean } | null;
    }>;
    commands = rows.map((row) => {
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
    });
  }

  const nowMs = Date.now();
  const presence = (allMembers ?? []).map((m: unknown) => {
    const row = m as { participant_id: string; last_seen_at: string | null };
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : nowMs;
    return {
      participantId: row.participant_id as 'p1' | 'p2',
      online: nowMs - lastSeen <= 30_000,
      lastSeenAt: row.last_seen_at ?? new Date(nowMs).toISOString(),
    };
  });

  const isOutdated =
    (room as unknown as { multiplayer_version?: string }).multiplayer_version !==
      'season-multiplayer-v2' ||
    Number(
      (room as unknown as { room_protocol_version?: number | string }).room_protocol_version,
    ) !== 2;

  const locks = (() => {
    const rows = (locksRows ?? []) as Array<{
      participant_id: string;
      revealed?: boolean;
      cursor: string;
    }>;
    const p1 = rows.some((r) => r.participant_id === 'p1');
    const p2 = rows.some((r) => r.participant_id === 'p2');
    const revealed =
      rows.length > 0 ? rows.every((r) => r.revealed === true) || rows.length === 2 : false;
    const cursor = (room as unknown as { cursor?: string }).cursor ?? room.cursor ?? '';
    if (!p1 && !p2) return undefined;
    return { p1Locked: p1, p2Locked: p2, revealed, cursor };
  })();
  const attestationSummary = (() => {
    const rows = (attestRows ?? []) as Array<{
      participant_id: string;
      attempt: number;
      input_digest: string | null;
      result_digest: string | null;
    }>;
    if (rows.length === 0) return undefined;
    const attempt = Math.max(...rows.map((r) => r.attempt ?? 1));
    const attemptRows = rows.filter((r) => r.attempt === attempt);
    const verified =
      attemptRows.length === 2 && attemptRows[0]!.input_digest && attemptRows[0]!.result_digest
        ? attemptRows[0]!.input_digest === attemptRows[1]!.input_digest &&
          attemptRows[0]!.result_digest === attemptRows[1]!.result_digest
        : null;
    return {
      cursor: (room as unknown as { cursor?: string }).cursor ?? room.cursor ?? '',
      attempt,
      count: attemptRows.length,
      verified,
      inputDigest: attemptRows[0]?.input_digest ?? null,
      resultDigest: attemptRows[0]?.result_digest ?? null,
    };
  })();

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
    locks,
    attestationSummary,
  };

  const membership = {
    roomId: member.room_id,
    participantId: member.participant_id as 'p1' | 'p2',
    franchiseId: member.franchise_id as string,
    uid: member.uid as string,
    seat: member.seat as 'p1' | 'p2',
  };

  return json(200, { snapshot: snap, membership, ...(commands !== undefined ? { commands } : {}) });
});
