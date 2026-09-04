-- Season multiplayer RLS hardening.
--
-- Finding: season_rooms "members may update their room" allowed any room member
-- to UPDATE phase/digest/root_seed/code/revision (no column restriction) and
-- "members may delete their room" allowed any member to DELETE the room,
-- bypassing Edge Function authority. season_room_members insert/update/delete
-- only checked uid = auth.uid(), so anyone could squat any seat and edit
-- franchise_id/control/miss_streak. season_join_attempts SELECT USING (true)
-- leaked every uid/ip_hash/code to any authenticated user.
--
-- Fix: direct client writes are removed. All season mutations go through
-- service_role Edge Functions / SECURITY DEFINER RPCs (which bypass RLS),
-- mirroring the fixed-five model (SELECT-only policies for clients).
-- The web client performs no direct season table writes (verified: no
-- `.from('season_rooms'|'season_room_members')` writes in apps/web/src),
-- so dropping these policies breaks no supported path.
-- Join-attempt reads are scoped to the caller's own uid.

drop policy if exists "members may update their room" on public.season_rooms;
drop policy if exists "members may delete their room" on public.season_rooms;
drop policy if exists "members may insert own member" on public.season_room_members;
drop policy if exists "members may update own member" on public.season_room_members;
drop policy if exists "members may delete own member" on public.season_room_members;

-- Scope join-attempt reads to the caller's own rows. Service_role Edge
-- Functions bypass RLS and are unaffected.
drop policy if exists "authenticated may read own attempts" on public.season_join_attempts;
create policy "authenticated may read own attempts"
  on public.season_join_attempts for select
  to authenticated
  using (uid = auth.uid());

-- Cron/GC must be service_role only. Any authenticated user could otherwise
-- trigger retention sweeps at will.
revoke all on function public.season_cron_tick() from public;
revoke all on function public.season_cron_tick() from authenticated;
revoke all on function public.season_cron_tick() from anon;
grant execute on function public.season_cron_tick() to service_role;
