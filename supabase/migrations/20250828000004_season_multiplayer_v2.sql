-- M2 multiplayer v2: lobby readiness, presence heartbeat, settings revision, protocol bump
-- Keep v1 rooms readable as outdated

-- add guest_ready and settings_revision to season_rooms
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='season_rooms' and column_name='guest_ready') then
    alter table public.season_rooms add column guest_ready boolean not null default false;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='season_rooms' and column_name='settings_revision') then
    alter table public.season_rooms add column settings_revision integer not null default 0;
  end if;
end $$;

-- ensure root_seed is preserved for authoritative start event
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='season_rooms' and column_name='root_seed') then
    alter table public.season_rooms add column root_seed text;
  end if;
end $$;

-- presence heartbeat: last_seen_at per member
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='season_room_members' and column_name='last_seen_at') then
    alter table public.season_room_members add column last_seen_at timestamptz not null default now();
  end if;
end $$;

-- bump defaults to v2 for new rooms
alter table public.season_rooms alter column room_protocol_version set default 2;
alter table public.season_rooms alter column multiplayer_version set default 'season-multiplayer-v2';

-- update existing v2 handling: create index for heartbeat
create index if not exists season_room_members_last_seen_idx on public.season_room_members (room_id, last_seen_at);

-- helper to check outdated version in queries (no function needed, edge checks string)
