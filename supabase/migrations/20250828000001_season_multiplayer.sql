-- M2.7 Season Run Multiplayer — minimal Supabase authority
-- Tables: season_rooms, season_room_members, season_room_commands,
--         season_private_decisions, season_checkpoint_attestations,
--         season_deadlines, season_join_attempts

-- Extensions
create extension if not exists "pgcrypto";

-- season_rooms
create table if not exists public.season_rooms (
    id uuid primary key default gen_random_uuid(),
    code text,
    pace text not null check (pace in ('live','async')),
    room_protocol_version smallint not null default 1,
    multiplayer_version text not null default 'season-multiplayer-v1',
    timer_policy_version text not null default 'season-timers-v1',
    authority_version text not null default 'season-authority-v1',
    root_seed text not null,
    phase text not null default 'waiting' check (phase in ('waiting','drafting','league-verification','checkpoint-setup','market','private-lock','simulation','hash-verification','postseason','completed','integrity-failed','expired')),
    cursor text not null default 'draft-0',
    revision integer not null default 0,
    digest text not null default repeat('0',32),
    code_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    expires_at timestamptz
);
create unique index if not exists season_rooms_active_code_uidx on public.season_rooms (code) where code is not null and code_expires_at > now();
create index if not exists season_rooms_code_expires_idx on public.season_rooms (code_expires_at) where code is not null;

-- season_room_members
create table if not exists public.season_room_members (
    room_id uuid not null references public.season_rooms(id) on delete cascade,
    uid uuid not null,
    participant_id text not null check (participant_id in ('p1','p2')),
    seat text not null check (seat in ('p1','p2')),
    franchise_id text not null,
    control text not null default 'human' check (control in ('human','ai-takeover','surrendered')),
    miss_streak integer not null default 0 check (miss_streak >= 0),
    reclaim_requested boolean not null default false,
    created_at timestamptz not null default now(),
    primary key (room_id, participant_id),
    unique (room_id, seat),
    unique (room_id, uid)
);
create index if not exists season_room_members_uid_idx on public.season_room_members (uid);

-- season_room_commands
create table if not exists public.season_room_commands (
    room_id uuid not null references public.season_rooms(id) on delete cascade,
    command_id text not null,
    ordinal integer not null,
    run_id text not null,
    payload jsonb not null,
    actor_participant_id text not null check (actor_participant_id in ('p1','p2')),
    actor_franchise_id text not null,
    receipt jsonb not null,
    created_at timestamptz not null default now(),
    primary key (room_id, command_id),
    unique (room_id, ordinal)
);
create index if not exists season_room_commands_room_ordinal_idx on public.season_room_commands (room_id, ordinal);

-- season_private_decisions
create table if not exists public.season_private_decisions (
    room_id uuid not null references public.season_rooms(id) on delete cascade,
    cursor text not null,
    participant_id text not null check (participant_id in ('p1','p2')),
    franchise_id text not null,
    payload jsonb not null,
    payload_digest text not null,
    revealed boolean not null default false,
    fallback_verified boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (room_id, cursor, participant_id)
);

-- season_checkpoint_attestations
create table if not exists public.season_checkpoint_attestations (
    room_id uuid not null references public.season_rooms(id) on delete cascade,
    cursor text not null,
    attempt smallint not null check (attempt between 1 and 3),
    participant_id text not null check (participant_id in ('p1','p2')),
    input_digest text not null,
    result_digest text not null,
    run_state_digest text not null,
    versions jsonb not null,
    created_at timestamptz not null default now(),
    primary key (room_id, cursor, attempt, participant_id)
);

-- season_deadlines
create table if not exists public.season_deadlines (
    room_id uuid not null references public.season_rooms(id) on delete cascade,
    cursor text not null,
    deadline_at timestamptz not null,
    fallback_digest text not null,
    fallback_payload jsonb not null,
    resolution_source text check (resolution_source in ('human','timeout-default','ai-takeover')),
    grace_ends_at timestamptz,
    created_at timestamptz not null default now(),
    primary key (room_id, cursor)
);

-- season_join_attempts
create table if not exists public.season_join_attempts (
    id uuid primary key default gen_random_uuid(),
    uid uuid,
    ip_hash text not null,
    code text,
    created_at timestamptz not null default now()
);
create index if not exists season_join_attempts_created_idx on public.season_join_attempts (created_at);
create index if not exists season_join_attempts_uid_idx on public.season_join_attempts (uid, created_at);
create index if not exists season_join_attempts_ip_idx on public.season_join_attempts (ip_hash, created_at);

-- Enable RLS
alter table public.season_rooms enable row level security;
alter table public.season_room_members enable row level security;
alter table public.season_room_commands enable row level security;
alter table public.season_private_decisions enable row level security;
alter table public.season_checkpoint_attestations enable row level security;
alter table public.season_deadlines enable row level security;
alter table public.season_join_attempts enable row level security;

-- Deny direct client writes: no policies for anon/authenticated on inserts/updates/deletes
-- Only service_role / security definer functions may mutate
-- Read policies: members may read their room's public state
create policy "members may read their room"
on public.season_rooms for select
to authenticated
using (exists (select 1 from public.season_room_members m where m.room_id = season_rooms.id and m.uid = auth.uid()));

create policy "members may read their room commands"
on public.season_room_commands for select
to authenticated
using (exists (select 1 from public.season_room_members m where m.room_id = season_room_commands.room_id and m.uid = auth.uid()));

create policy "members may read private decisions only after reveal"
on public.season_private_decisions for select
to authenticated
using (
    revealed = true
    and exists (select 1 from public.season_room_members m where m.room_id = season_private_decisions.room_id and m.uid = auth.uid())
);

create policy "members may read their own pending private decision"
on public.season_private_decisions for select
to authenticated
using (
    participant_id = (select participant_id from public.season_room_members m where m.room_id = season_private_decisions.room_id and m.uid = auth.uid() limit 1)
);

create policy "members may read checkpoint attestations"
on public.season_checkpoint_attestations for select
to authenticated
using (exists (select 1 from public.season_room_members m where m.room_id = season_checkpoint_attestations.room_id and m.uid = auth.uid()));

create policy "members may read deadlines"
on public.season_deadlines for select
to authenticated
using (exists (select 1 from public.season_room_members m where m.room_id = season_deadlines.room_id and m.uid = auth.uid()));

-- Security definer helpers must set empty search_path and qualify relations
-- Revoke default execution
revoke all on function public.season_rooms from public;
revoke all on function public.season_room_members from public;

-- Helper function: create room (called via Edge Function with service_role)
create or replace function public.season_room_create(p_pace text, p_root_seed text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_room_id uuid;
    v_code text;
    v_tries integer := 0;
begin
    if p_pace not in ('live','async') then
        raise exception 'invalid pace';
    end if;
    loop
        v_code := lpad((floor(random()*10000))::text, 4, '0');
        begin
            insert into public.season_rooms (pace, root_seed, code, code_expires_at, phase)
            values (p_pace, p_root_seed, v_code, now() + interval '15 minutes', 'waiting')
            returning id into v_room_id;
            exit;
        exception when unique_violation then
            v_tries := v_tries + 1;
            if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
        end;
    end loop;
    return v_room_id;
end;
$$;
revoke all on function public.season_room_create(text, text) from public;
grant execute on function public.season_room_create(text, text) to authenticated;

-- Cron: resolve deadlines and clean expired coordination (FOR UPDATE SKIP LOCKED)
create or replace function public.season_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- resolve expired deadlines: mark timeout, insert fallback private decision if needed
    -- placeholder: actual Edge Function cron does the work; this function is for local testing
    delete from public.season_join_attempts where created_at < now() - interval '24 hours';
    delete from public.season_rooms where phase = 'completed' and updated_at < now() - interval '24 hours';
    delete from public.season_rooms where phase = 'expired' and updated_at < now() - interval '24 hours';
    update public.season_rooms set code = null, code_expires_at = null where code_expires_at is not null and code_expires_at < now();
end;
$$;
revoke all on function public.season_cron_tick() from public;
grant execute on function public.season_cron_tick() to authenticated;
