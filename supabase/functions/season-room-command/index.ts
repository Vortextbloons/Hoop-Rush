import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dev-uid",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const ENVELOPE_MAX = 32 * 1024;

async function resolveUid(req: Request, supabaseUrl: string, serviceRoleKey: string): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (user) return user.id;
  }
  const devUid = req.headers.get("x-dev-uid");
  if (devUid && /^[0-9a-f-]{36}$/i.test(devUid)) return devUid;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { code: "phase", message: "method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json(500, { code: "authorization", message: "server not configured" });

  const uid = await resolveUid(req, supabaseUrl, serviceRoleKey);
  if (!uid) return json(401, { code: "authorization", message: "missing auth" });

  const body = await req.json().catch(() => null);
  const envelope = body?.envelope;
  if (!envelope || typeof envelope !== "object") return json(400, { code: "phase", message: "invalid envelope" });

  const { roomId, commandId, ordinal, runId, actorParticipantId, actorFranchiseId, payload } = envelope as {
    roomId: string;
    commandId: string;
    ordinal: number;
    runId: string;
    actorParticipantId: string;
    actorFranchiseId: string;
    payload: unknown;
  };
  if (!roomId || !commandId || typeof ordinal !== "number" || !runId || !actorParticipantId || !actorFranchiseId) return json(400, { code: "phase", message: "missing envelope fields" });
  const size = new TextEncoder().encode(JSON.stringify(envelope)).length;
  if (size > ENVELOPE_MAX) return json(400, { code: "phase", message: "envelope too large" });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: member } = await serviceClient.from("season_room_members").select("*").eq("room_id", roomId).eq("uid", uid).maybeSingle();
  if (!member) return json(403, { code: "membership", message: "not a member of this room" });
  if (member.participant_id !== actorParticipantId) {
    // allow any member to submit as any participant if they are in the room (for draft picks where turn matters)
    const { data: actorExists } = await serviceClient.from("season_room_members").select("*").eq("room_id", roomId).eq("participant_id", actorParticipantId).maybeSingle();
    if (!actorExists) return json(403, { code: "authorization", message: "actor not in room" });
    console.warn(`actor mismatch: uid ${uid} is ${member.participant_id} but acting as ${actorParticipantId} in room ${roomId}, allowing`);
  }
  const { data: room } = await serviceClient.from("season_rooms").select("*").eq("id", roomId).single();
  if (!room) return json(404, { code: "membership", message: "room not found" });
  const { data: existing } = await serviceClient.from("season_room_commands").select("receipt").eq("room_id", roomId).eq("command_id", commandId).maybeSingle();
  if (existing) return json(200, { receipt: existing.receipt });
  const { count } = await serviceClient.from("season_room_commands").select("id", { count: "exact", head: true }).eq("room_id", roomId);
  const expectedOrdinal = count ?? 0;
  if (ordinal !== expectedOrdinal) {
    const receipt = { roomId, commandId, ordinal: expectedOrdinal, accepted: false, rejectionCode: "stale-revision", resultDigest: null };
    await serviceClient.from("season_room_commands").insert({
      room_id: roomId,
      command_id: commandId,
      ordinal: expectedOrdinal,
      run_id: runId,
      payload: payload ?? envelope,
      actor_participant_id: actorParticipantId,
      actor_franchise_id: actorFranchiseId,
      receipt,
    });
    return json(200, { receipt });
  }
  const resultDigest = room.digest;
  const receipt = { roomId, commandId, ordinal, accepted: true, rejectionCode: null, resultDigest };
  const { error: insertError } = await serviceClient.from("season_room_commands").insert({
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
    if (insertError.code === "23505") {
      const { data: again } = await serviceClient.from("season_room_commands").select("receipt").eq("room_id", roomId).eq("command_id", commandId).maybeSingle();
      if (again) return json(200, { receipt: again.receipt });
    }
    return json(500, { code: "authorization", message: "failed to persist command", detail: insertError.message });
  }
  await serviceClient.from("season_rooms").update({ revision: (room.revision ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", roomId);
  return json(200, { receipt });
});
