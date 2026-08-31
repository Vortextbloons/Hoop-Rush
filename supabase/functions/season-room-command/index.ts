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

const ENVELOPE_MAX = 32 * 1024;

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const ALLOWED_KINDS = new Set([
  'create-season-draft',
  'draw-season-offer',
  'select-draft-player',
  'finalize-human-rosters',
  'generate-ai-league',
  'reveal-draft-roll',
  'claim-draft-pool',
  'room-draft-pick',
]);

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
  const envelope = body?.envelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
    return json(400, { code: 'phase', message: 'invalid envelope' });

  const {
    roomId,
    commandId,
    ordinal,
    runId,
    actorParticipantId,
    actorFranchiseId,
    payload,
    schemaVersion,
  } = envelope as {
    roomId: unknown;
    commandId: unknown;
    ordinal: unknown;
    runId: unknown;
    actorParticipantId: unknown;
    actorFranchiseId: unknown;
    payload: unknown;
    schemaVersion: unknown;
  };

  // Envelope validation (manual, no @hoop-rush imports in Deno edge)
  if (
    typeof roomId !== 'string' ||
    !ID_PATTERN.test(roomId) ||
    roomId.length < 1 ||
    roomId.length > 64
  )
    return json(400, { code: 'phase', message: 'invalid roomId' });
  if (
    typeof commandId !== 'string' ||
    !ID_PATTERN.test(commandId) ||
    commandId.length < 1 ||
    commandId.length > 64
  )
    return json(400, { code: 'phase', message: 'invalid commandId' });
  if (typeof runId !== 'string' || !ID_PATTERN.test(runId) || runId.length < 1 || runId.length > 64)
    return json(400, { code: 'phase', message: 'invalid runId' });
  if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0)
    return json(400, { code: 'phase', message: 'invalid ordinal' });
  if (schemaVersion !== 1 && schemaVersion !== 2)
    return json(400, { code: 'phase', message: 'invalid schemaVersion' });
  if (actorParticipantId !== 'p1' && actorParticipantId !== 'p2')
    return json(400, { code: 'phase', message: 'invalid actorParticipantId' });
  if (
    typeof actorFranchiseId !== 'string' ||
    !ID_PATTERN.test(actorFranchiseId) ||
    actorFranchiseId.length < 1 ||
    actorFranchiseId.length > 64
  )
    return json(400, { code: 'phase', message: 'invalid actorFranchiseId' });
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    return json(400, { code: 'phase', message: 'invalid payload' });
  // Payload may be direct kind object or wrapped SeasonDraftCommand {commandId, expectedRevision, payload:{kind}}
  const payloadObj = payload as Record<string, unknown>;
  let kind: unknown = payloadObj.kind;
  if (
    typeof kind !== 'string' &&
    payloadObj.payload &&
    typeof payloadObj.payload === 'object' &&
    payloadObj.payload !== null &&
    !Array.isArray(payloadObj.payload)
  ) {
    kind = (payloadObj.payload as Record<string, unknown>).kind;
  }
  if (typeof kind !== 'string' || !ALLOWED_KINDS.has(kind))
    return json(400, { code: 'phase', message: 'unknown payload kind' });

  const size = new TextEncoder().encode(JSON.stringify(envelope)).length;
  if (size > ENVELOPE_MAX) return json(400, { code: 'phase', message: 'envelope too large' });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: member } = await serviceClient
    .from('season_room_members')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uid)
    .maybeSingle();
  if (!member) return json(403, { code: 'membership', message: 'not a member of this room' });
  // Strict binding: uid -> participant_id -> franchise_id. No impersonation.
  if (member.participant_id !== actorParticipantId) {
    return json(403, { code: 'authorization', message: 'actor participant mismatch' });
  }
  if (member.franchise_id !== actorFranchiseId) {
    return json(403, { code: 'authorization', message: 'actor franchise mismatch' });
  }
  const { data: room } = await serviceClient
    .from('season_rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (!room) return json(404, { code: 'membership', message: 'room not found' });
  const { data: existing } = await serviceClient
    .from('season_room_commands')
    .select('receipt')
    .eq('room_id', roomId)
    .eq('command_id', commandId)
    .maybeSingle();
  if (existing) return json(200, { receipt: existing.receipt });
  const { data: latestCommands, error: latestError } = await serviceClient
    .from('season_room_commands')
    .select('ordinal')
    .eq('room_id', roomId)
    .order('ordinal', { ascending: false })
    .limit(1);
  if (latestError) {
    return json(500, {
      code: 'authorization',
      message: 'failed to read command cursor',
      detail: latestError.message,
    });
  }
  const expectedOrdinal = (latestCommands?.[0]?.ordinal ?? -1) + 1;
  if (ordinal !== expectedOrdinal) {
    // Do NOT insert rejected stale commands into the authoritative season_room_commands table at ordinal expectedOrdinal.
    // This prevents poisoning the command stream; rejected payloads must not be replayed as authoritative.
    // Idempotent duplicate case is already handled above via command_id lookup.
    // For stale rejection, return ephemeral receipt without consuming ordinal.
    const receipt = {
      roomId,
      commandId,
      ordinal: expectedOrdinal,
      accepted: false,
      rejectionCode: 'stale-revision',
      resultDigest: null,
      expectedOrdinal,
    };
    return json(200, { receipt });
  }
  // Note: resultDigest currently mirrors room.digest (client-derived draft digest).
  // Future should derive authoritative result via engine to ensure server validates game rules.
  // For now we bump revision but do not claim engine execution.
  const resultDigest = room.digest;
  const receipt = { roomId, commandId, ordinal, accepted: true, rejectionCode: null, resultDigest };
  const { error: insertError } = await serviceClient.from('season_room_commands').insert({
    room_id: roomId,
    command_id: commandId,
    ordinal,
    run_id: runId,
    payload: payload ?? envelope,
    actor_participant_id: actorParticipantId,
    actor_franchise_id: actorFranchiseId,
    receipt,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: again } = await serviceClient
        .from('season_room_commands')
        .select('receipt')
        .eq('room_id', roomId)
        .eq('command_id', commandId)
        .maybeSingle();
      if (again) return json(200, { receipt: again.receipt });
      const { data: latestAfterConflict } = await serviceClient
        .from('season_room_commands')
        .select('ordinal')
        .eq('room_id', roomId)
        .order('ordinal', { ascending: false })
        .limit(1);
      const nextOrdinal = (latestAfterConflict?.[0]?.ordinal ?? ordinal) + 1;
      return json(200, {
        receipt: {
          roomId,
          commandId,
          ordinal: nextOrdinal,
          accepted: false,
          rejectionCode: 'stale-revision',
          resultDigest: null,
          expectedOrdinal: nextOrdinal,
        },
      });
    }
    return json(500, {
      code: 'authorization',
      message: 'failed to persist command',
      detail: insertError.message,
    });
  }
  await serviceClient
    .from('season_rooms')
    .update({ revision: (room.revision ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', roomId);
  return json(200, { receipt });
});
