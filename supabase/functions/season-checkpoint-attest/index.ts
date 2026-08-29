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
  const att = body?.attestation as { roomId: string; cursor: string; attempt: number; participantId: string; inputDigest: string; resultDigest: string; runStateDigest: string; versions: Record<string, string> } | undefined;
  if (!att || !att.roomId || !att.cursor || typeof att.attempt !== "number" || !att.participantId || !att.inputDigest || !att.resultDigest) return json(400, { code: "phase", message: "invalid attestation" });
  if (att.attempt < 1 || att.attempt > 3) return json(400, { code: "phase", message: "invalid attempt" });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: member } = await serviceClient.from("season_room_members").select("*").eq("room_id", att.roomId).eq("uid", uid).maybeSingle();
  if (!member) return json(403, { code: "membership", message: "not a member" });
  if (member.participant_id !== att.participantId) return json(403, { code: "authorization", message: "participant mismatch" });
  const { data: room } = await serviceClient.from("season_rooms").select("*").eq("id", att.roomId).single();
  if (!room) return json(404, { code: "membership", message: "room not found" });
  const { data: existing } = await serviceClient
    .from("season_checkpoint_attestations")
    .select("*")
    .eq("room_id", att.roomId)
    .eq("cursor", att.cursor)
    .eq("attempt", att.attempt)
    .eq("participant_id", att.participantId)
    .maybeSingle();
  if (existing) {
    if (existing.input_digest !== att.inputDigest || existing.result_digest !== att.resultDigest) return json(400, { code: "hash-mismatch", message: "attestation digest mismatch" });
  } else {
    const { error: insertError } = await serviceClient.from("season_checkpoint_attestations").insert({
      room_id: att.roomId,
      cursor: att.cursor,
      attempt: att.attempt,
      participant_id: att.participantId,
      input_digest: att.inputDigest,
      result_digest: att.resultDigest,
      run_state_digest: att.runStateDigest,
      versions: att.versions ?? {},
    });
    if (insertError) {
      if (insertError.code !== "23505") return json(500, { code: "authorization", message: "failed to persist attestation", detail: insertError.message });
    }
  }
  const { data: list } = await serviceClient.from("season_checkpoint_attestations").select("*").eq("room_id", att.roomId).eq("cursor", att.cursor).eq("attempt", att.attempt);
  if (!list || list.length < 2) return json(200, { kind: "rerun", reason: "awaiting peer attestation", attempt: att.attempt });
  const [a, b] = list as Array<{ input_digest: string; result_digest: string }>;
  if (a.input_digest === b.input_digest && a.result_digest === b.result_digest) {
    await serviceClient.from("season_rooms").update({ phase: "checkpoint-setup", cursor: att.cursor, revision: (room.revision ?? 0) + 1, digest: a.result_digest, updated_at: new Date().toISOString() }).eq("id", att.roomId);
    return json(200, { kind: "accepted", accepted: { roomId: att.roomId, cursor: att.cursor, inputDigest: a.input_digest, resultDigest: a.result_digest, acceptedAt: new Date().toISOString() } });
  }
  if (att.attempt === 1) return json(200, { kind: "rerun", reason: "hash mismatch, rerun from last checkpoint", attempt: 2 });
  await serviceClient.from("season_rooms").update({ phase: "integrity-failed", updated_at: new Date().toISOString() }).eq("id", att.roomId);
  return json(200, { kind: "integrity-failed", failure: { roomId: att.roomId, cursor: att.cursor, expectedInputDigest: a.input_digest, expectedResultDigest: a.result_digest, attestations: list.slice(0, 2), terminal: true } });
});
