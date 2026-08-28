import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ code: "authorization", message: "missing auth" }), { status: 401 });
    const body = await req.json().catch(() => null);
    const pace = body?.pace;
    const rootSeed = body?.rootSeed;
    if (pace !== "live" && pace !== "async") return new Response(JSON.stringify({ code: "phase", message: "invalid pace" }), { status: 400 });
    if (typeof rootSeed !== "string" || rootSeed.length < 8) return new Response(JSON.stringify({ code: "phase", message: "invalid rootSeed" }), { status: 400 });
    // rate limit: 3 per hour per UID/IP handled in DB via season_join_attempts
    // call security definer function
    return new Response(JSON.stringify({ ok: true, note: "stub: call season_room_create via service_role" }), {
        headers: { "Content-Type": "application/json" },
    });
});
