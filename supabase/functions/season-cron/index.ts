import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Cron: resolve deadlines and clean expired coordination
// Runs once per minute via Supabase Cron, uses FOR UPDATE SKIP LOCKED
Deno.serve(async (_req: Request) => {
    // In production this would:
    // - SELECT ... FOR UPDATE SKIP LOCKED from season_deadlines where deadline_at < now() and resolution_source is null
    // - verify fallback digest, insert fallback private decision or mark timeout
    // - handle grace expiry (24h unresolved -> expired)
    // - cleanup season_join_attempts where created_at < now() - 24h
    // - cleanup completed/expired rooms after 24h
    // - clear expired codes (code_expires_at < now() -> code = null)
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
