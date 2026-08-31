-- Repair multiplayer lobby state on projects whose v2 migration history was
-- recorded without all lobby columns being present.

alter table public.season_rooms
  add column if not exists guest_ready boolean not null default false;

alter table public.season_rooms
  add column if not exists settings_revision integer not null default 0;

alter table public.season_room_members
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists season_room_members_last_seen_idx
  on public.season_room_members (room_id, last_seen_at);
