-- Realtime for private locks and checkpoint attestations so peer auto-refreshes without manual Reload.
-- Revision bump in season-private-decision / season-checkpoint-attest ensures season_rooms fires even on 1/2 states;
-- adding these tables gives direct push as well for low latency and covers cases where rooms bump is delayed.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_private_decisions'
  ) then
    alter publication supabase_realtime add table public.season_private_decisions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'season_checkpoint_attestations'
  ) then
    alter publication supabase_realtime add table public.season_checkpoint_attestations;
  end if;
end $$;

alter table public.season_private_decisions replica identity full;
alter table public.season_checkpoint_attestations replica identity full;
