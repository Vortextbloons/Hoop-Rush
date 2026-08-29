-- Postgres Changes for season rooms: publication + replica identity for filtered realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_rooms'
  ) then
    alter publication supabase_realtime add table public.season_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_room_commands'
  ) then
    alter publication supabase_realtime add table public.season_room_commands;
  end if;
end $$;

alter table public.season_rooms replica identity full;
alter table public.season_room_commands replica identity full;
