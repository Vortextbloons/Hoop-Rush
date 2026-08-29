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

const CHECKPOINT_MAX = 16 * 1024;

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
  const sub = body?.submission as { roomId: string; cursor: string; participantId: string; franchiseId: string; payloadDigest: string; payload: unknown } | undefined;
  if (!sub || !sub.roomId || !sub.cursor || !sub.participantId || !sub.franchiseId || !sub.payloadDigest) return json(400, { code: "phase", message: "invalid submission" });
  const size = new TextEncoder().encode(JSON.stringify(sub.payload ?? "")).length;
  if (size > CHECKPOINT_MAX) return json(400, { code: "phase", message: "private decision too large" });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: member } = await serviceClient.from("season_room_members").select("*").eq("room_id", sub.roomId).eq("uid", uid).maybeSingle();
  if (!member) return json(403, { code: "membership", message: "not a member" });
  if (member.participant_id !== sub.participantId) return json(403, { code: "authorization", message: "participant mismatch" });
  const { data: room } = await serviceClient.from("season_rooms").select("*").eq("id", sub.roomId).single();
  if (!room) return json(404, { code: "membership", message: "room not found" });
  const { error: upsertError } = await serviceClient.from("season_private_decisions").upsert(
    {
      room_id: sub.roomId,
      cursor: sub.cursor,
      participant_id: sub.participantId,
      franchise_id: sub.franchiseId,
      payload: sub.payload ?? null,
      payload_digest: sub.payloadDigest,
      revealed: false,
      fallback_verified: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "room_id,cursor,participant_id" },
  );
  if (upsertError) return json(500, { code: "authorization", message: "failed to persist decision", detail: upsertError.message });
  const { data: decisions } = await serviceClient.from("season_private_decisions").select("participant_id").eq("room_id", sub.roomId).eq("cursor", sub.cursor);
  const locked = (decisions?.length ?? 0) === 2;
  if (locked) {
    await serviceClient.from("season_private_decisions").update({ revealed: true }).eq("room_id", sub.roomId).eq("cursor", sub.cursor);
    await serviceClient.from("season_rooms").update({ phase: "simulation", updated_at: new Date().toISOString() }).eq("id", sub.roomId);
  }
  return json(200, { locked });
});
