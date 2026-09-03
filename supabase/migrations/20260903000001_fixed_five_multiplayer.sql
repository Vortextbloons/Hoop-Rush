-- M2.8 Fixed-Five live multiplayer — fresh vertical independent of archived M2.7.
-- Tables: fixed_five_rooms, fixed_five_room_members, fixed_five_room_commands, fixed_five_join_attempts.
-- Supabase stores only settings, membership, deadlines, accepted commands, and final digest/confirmation.

create extension if not exists "pgcrypto";

-- Rooms: live only, anonymous auth, server-side root seed, 4-digit codes with leading zeroes.
create table if not exists public.fixed_five_rooms (
  id uuid primary key default gen_random_uuid(),
  code text check (code is null or code ~ '^[0-9]{4}$'),
  code_active boolean not null default true,
  code_expires_at timestamptz,
  mode text not null check (mode in ('classic-shared-82', 'sandbox-shared-82', 'duel')),
  source_mode text not null check (source_mode in ('classic', 'sandbox')),
  variant text not null check (variant in ('ratings', 'ball-knowledge')),
  room_schema_version smallint not null default 1,
  room_protocol_version smallint not null default 1,
  multiplayer_version text not null default 'fixed-five-multiplayer-v1',
  timer_policy_version text not null default 'fixed-five-autopick-v1',
  versions jsonb not null,
  root_seed text not null,
  phase text not null default 'lobby'
    check (phase in ('lobby', 'drafting', 'simulating', 'awaiting-confirmation', 'completed', 'integrity-failed', 'expired')),
  revision integer not null default 0,
  command_count integer not null default 0,
  digest text,
  result_digest text,
  confirmed_digest text,
  successor_room_id uuid references public.fixed_five_rooms(id) on delete set null,
  deadline_at timestamptz,
  deadline_cursor text,
  deadline_participant text check (deadline_participant is null or deadline_participant in ('p1', 'p2')),
  deadline_fallback jsonb,
  deadline_pick_ordinal integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create unique index if not exists fixed_five_rooms_active_code_uidx
  on public.fixed_five_rooms (code) where code_active and code is not null;
create index if not exists fixed_five_rooms_code_expires_idx
  on public.fixed_five_rooms (code_expires_at) where code is not null;
create index if not exists fixed_five_rooms_expires_idx on public.fixed_five_rooms (expires_at);

create table if not exists public.fixed_five_room_members (
  room_id uuid not null references public.fixed_five_rooms(id) on delete cascade,
  uid uuid not null,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  online boolean not null default true,
  ready boolean not null default false,
  picks_committed integer not null default 0 check (picks_committed >= 0 and picks_committed <= 10),
  locked boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id),
  unique (room_id, uid)
);
create index if not exists fixed_five_room_members_uid_idx on public.fixed_five_room_members (uid);

create table if not exists public.fixed_five_room_commands (
  room_id uuid not null references public.fixed_five_rooms(id) on delete cascade,
  command_id text not null,
  ordinal integer not null check (ordinal >= 0),
  actor_participant_id text not null check (actor_participant_id in ('p1', 'p2')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, command_id),
  unique (room_id, ordinal)
);
create index if not exists fixed_five_room_commands_room_ordinal_idx
  on public.fixed_five_room_commands (room_id, ordinal);

create table if not exists public.fixed_five_join_attempts (
  id uuid primary key default gen_random_uuid(),
  uid uuid,
  code text,
  created_at timestamptz not null default now()
);
create index if not exists fixed_five_join_attempts_created_idx on public.fixed_five_join_attempts (created_at);
create index if not exists fixed_five_join_attempts_uid_idx on public.fixed_five_join_attempts (uid, created_at);

alter table public.fixed_five_rooms enable row level security;
alter table public.fixed_five_room_members enable row level security;
alter table public.fixed_five_room_commands enable row level security;
alter table public.fixed_five_join_attempts enable row level security;

-- Deny direct client writes: only SELECT for members. Knowing a code never grants access.
-- (DROP guards keep `supabase db push` idempotent alongside the already-applied remote migration.)
drop policy if exists "ff members read their room" on public.fixed_five_rooms;
drop policy if exists "ff members read their commands" on public.fixed_five_room_commands;
drop policy if exists "ff members read their membership" on public.fixed_five_room_members;
drop policy if exists "ff members read room membership" on public.fixed_five_room_members;
create policy "ff members read their room"
  on public.fixed_five_rooms for select to authenticated
  using (exists (select 1 from public.fixed_five_room_members m where m.room_id = fixed_five_rooms.id and m.uid = auth.uid()));

create policy "ff members read their commands"
  on public.fixed_five_room_commands for select to authenticated
  using (exists (select 1 from public.fixed_five_room_members m where m.room_id = fixed_five_room_commands.room_id and m.uid = auth.uid()));

create policy "ff members read room membership"
  on public.fixed_five_room_members for select to authenticated
  using (exists (select 1 from public.fixed_five_room_members m where m.room_id = fixed_five_room_members.room_id and m.uid = auth.uid()));
-- Realtime: one room subscription covering room and command changes (Postgres Changes).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fixed_five_rooms'
  ) then
    alter publication supabase_realtime add table public.fixed_five_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fixed_five_room_commands'
  ) then
    alter publication supabase_realtime add table public.fixed_five_room_commands;
  end if;
end $$;

alter table public.fixed_five_rooms replica identity full;
alter table public.fixed_five_room_commands replica identity full;

-- RPC: create room. Server-side root seed, rate-limited by UID, 15-minute codes.
create or replace function public.fixed_five_room_create(p_mode text, p_source_mode text, p_variant text, p_versions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
  v_recent integer;
  v_deadline timestamptz;
begin
  if p_mode not in ('classic-shared-82', 'sandbox-shared-82', 'duel') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_source_mode not in ('classic', 'sandbox') then
    raise exception 'invalid source mode' using errcode = '22023';
  end if;
  if p_variant not in ('ratings', 'ball-knowledge') then
    raise exception 'invalid variant' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.fixed_five_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), 'create');
  select count(*) into v_recent from public.fixed_five_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.fixed_five_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(public.gen_random_bytes(16), 'hex');
  if p_mode = 'sandbox-shared-82' then
    v_deadline := now() + interval '5 minutes';
  else
    v_deadline := now() + interval '90 seconds';
  end if;
  loop
    v_code := lpad((floor(random() * 10000))::text, 4, '0');
    begin
      insert into public.fixed_five_rooms (mode, source_mode, variant, versions, root_seed, code, code_active, code_expires_at, phase, deadline_at, deadline_cursor, deadline_participant, deadline_pick_ordinal)
        values (p_mode, p_source_mode, p_variant, p_versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby', v_deadline, 'lobby', 'p1', 0)
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_room_id, auth.uid(), 'p1');
  return jsonb_build_object('room_id', v_room_id, 'code', v_code);
end;
$$;
revoke all on function public.fixed_five_room_create(text, text, text, jsonb) from public;
grant execute on function public.fixed_five_room_create(text, text, text, jsonb) to authenticated;

-- RPC: preview room by code (rate-limited, never leaks membership).
create or replace function public.fixed_five_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), p_code);
  select * into v_room from public.fixed_five_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'room_id', v_room.id, 'mode', v_room.mode, 'source_mode', v_room.source_mode,
    'variant', v_room.variant, 'phase', v_room.phase, 'revision', v_room.revision,
    'versions', v_room.versions);
end;
$$;
revoke all on function public.fixed_five_room_preview(text) from public;
grant execute on function public.fixed_five_room_preview(text) to authenticated;

-- RPC: join room by code. Row-locks the room, enforces capacity and expiry.
create or replace function public.fixed_five_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_count integer;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.fixed_five_room_members where room_id = v_room.id;
  if v_count >= 2 then
    if not exists (select 1 from public.fixed_five_room_members where room_id = v_room.id and uid = auth.uid()) then
      raise exception 'room-full' using errcode = 'P0001';
    end if;
  end if;
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do update set online = true, last_seen_at = now()
    where public.fixed_five_room_members.uid = excluded.uid;
  update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;
revoke all on function public.fixed_five_room_join(text) from public;
grant execute on function public.fixed_five_room_join(text) to authenticated;

-- RPC: submit command. Row-locks room, enforces membership/seat/phase/turn/revision/idempotency/payload limits.
create or replace function public.fixed_five_command_submit(
  p_room_id uuid, p_command_id text, p_expected_revision integer, p_actor text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_member public.fixed_five_room_members%rowtype;
  v_ordinal integer;
  v_existing_ordinal integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'payload-too-large');
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_member.participant_id <> p_actor then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  select ordinal into v_existing_ordinal from public.fixed_five_room_commands
    where room_id = p_room_id and command_id = p_command_id limit 1;
  if found then
    return jsonb_build_object('accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejection_code', 'stale-revision', 'revision', v_room.revision);
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  v_ordinal := v_room.command_count;
  begin
    insert into public.fixed_five_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
      values (p_room_id, p_command_id, v_ordinal, p_actor, p_payload);
  exception when unique_violation then
    select ordinal into v_existing_ordinal from public.fixed_five_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end;
  update public.fixed_five_rooms
    set command_count = command_count + 1, revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('accepted', true, 'ordinal', v_ordinal, 'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) from public;
grant execute on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) to authenticated;

-- RPC: resolve overdue timeout fallback. Server appends the stored command once.
create or replace function public.fixed_five_timeout_resolve(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_command_id text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.fixed_five_room_members where room_id = p_room_id and uid = auth.uid()) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.deadline_at is null or v_room.deadline_at > now() then
    return jsonb_build_object('resolved', false);
  end if;
  if v_room.deadline_fallback is null then
    return jsonb_build_object('resolved', false);
  end if;
  v_command_id := 'timeout-' || coalesce(v_room.deadline_cursor, 'lobby') || '-' || coalesce(v_room.deadline_pick_ordinal, 0)::text;
  if exists (select 1 from public.fixed_five_room_commands where room_id = p_room_id and command_id = v_command_id) then
    return jsonb_build_object('resolved', false);
  end if;
  insert into public.fixed_five_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
    values (p_room_id, v_command_id, v_room.command_count, coalesce(v_room.deadline_participant, 'p1'), v_room.deadline_fallback);
  update public.fixed_five_rooms
    set command_count = command_count + 1, revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('resolved', true, 'command_id', v_command_id);
end;
$$;
revoke all on function public.fixed_five_timeout_resolve(uuid) from public;
grant execute on function public.fixed_five_timeout_resolve(uuid) to authenticated;

-- RPC: pre-draft guest removal (host only, lobby only, rotates the code).
create or replace function public.fixed_five_guest_remove(p_room_id uuid, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_code text;
  v_tries integer := 0;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  if v_room.phase <> 'lobby' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if not exists (select 1 from public.fixed_five_room_members where room_id = p_room_id and uid = auth.uid() and participant_id = 'p1') then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if p_target <> 'p2' then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  delete from public.fixed_five_room_members where room_id = p_room_id and participant_id = 'p2';
  loop
    v_code := lpad((floor(random() * 10000))::text, 4, '0');
    begin
      update public.fixed_five_rooms set code = v_code, code_active = true, code_expires_at = now() + interval '15 minutes', revision = revision + 1, updated_at = now()
        where id = p_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  return jsonb_build_object('accepted', true, 'code', v_code);
end;
$$;
revoke all on function public.fixed_five_guest_remove(uuid, text) from public;
grant execute on function public.fixed_five_guest_remove(uuid, text) to authenticated;

-- RPC: leave room.
create or replace function public.fixed_five_leave(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  update public.fixed_five_room_members set online = false, last_seen_at = now()
    where room_id = p_room_id and uid = auth.uid();
  update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;
revoke all on function public.fixed_five_leave(uuid) from public;
grant execute on function public.fixed_five_leave(uuid) to authenticated;

-- RPC: rematch. Requires a completed room; creates a successor with the same settings and a fresh seed.
create or replace function public.fixed_five_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_new_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.fixed_five_room_members where room_id = p_room_id and uid = auth.uid()) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase <> 'completed' then
    raise exception 'phase' using errcode = 'P0001';
  end if;
  v_seed := encode(public.gen_random_bytes(16), 'hex');
  loop
    v_code := lpad((floor(random() * 10000))::text, 4, '0');
    begin
      insert into public.fixed_five_rooms (mode, source_mode, variant, versions, root_seed, code, code_active, code_expires_at, phase)
        values (v_room.mode, v_room.source_mode, v_room.variant, v_room.versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_new_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  update public.fixed_five_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.fixed_five_rematch(uuid) from public;
grant execute on function public.fixed_five_rematch(uuid) to authenticated;

-- Cron: 24-hour retention and code expiry. Never deletes local saves.
create or replace function public.fixed_five_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.fixed_five_join_attempts where created_at < now() - interval '24 hours';
  update public.fixed_five_rooms set code = null, code_active = false, code_expires_at = null
    where code_active and code_expires_at is not null and code_expires_at < now();
  update public.fixed_five_rooms set phase = 'expired', updated_at = now()
    where phase not in ('completed', 'expired') and expires_at < now();
  delete from public.fixed_five_rooms where expires_at < now() - interval '24 hours';
end;
$$;
revoke all on function public.fixed_five_cron_tick() from public;
grant execute on function public.fixed_five_cron_tick() to authenticated;
