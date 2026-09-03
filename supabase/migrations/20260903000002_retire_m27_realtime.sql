-- M2.8: remove archived M2.7 Season Run tables from the active Realtime publication.
-- Archived source files stay untouched; only live publication changes.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_rooms'
  ) then
    alter publication supabase_realtime drop table public.season_rooms;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_room_commands'
  ) then
    alter publication supabase_realtime drop table public.season_room_commands;
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_private_decisions'
  ) then
    alter publication supabase_realtime drop table public.season_private_decisions;
  end if;
end $$;
