-- Remove temporary M2.7 coordination state and its RPCs from existing databases.
drop function if exists public.season_room_create(text, text, text);
drop function if exists public.season_room_create(text, text);
drop function if exists public.season_cron_tick();

drop table if exists
  public.season_deadlines,
  public.season_checkpoint_attestations,
  public.season_private_decisions,
  public.season_room_commands,
  public.season_room_members,
  public.season_join_attempts,
  public.season_rooms
  cascade;
