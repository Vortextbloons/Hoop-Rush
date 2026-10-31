-- Cap Rush multiplayer coordination.
-- Temporary rooms, membership, ordered commands, checkpoints, and verification.
-- IndexedDB remains the save system; this schema never stores league history or tapes.

create table if not exists public.cap_rush_multiplayer_rooms (
  id uuid primary key default gen_random_uuid(),
  code text check (code ~ '^\d{4}$'),
  code_active boolean not null default true,
  code_expires_at timestamptz,
  variant text not null check (variant in ('clash', 'roulette')),
  settings jsonb not null,
  root_seed text not null,
  phase text not null default 'lobby',
  revision integer not null default 0,
  command_count integer not null default 0,
  state jsonb,
  state_digest text,
  deadline jsonb,
  result_digest text,
  confirmed_digest text,
  successor_room_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create unique index if not exists cap_rush_multiplayer_rooms_active_code
  on public.cap_rush_multiplayer_rooms (code) where code_active;
create index if not exists cap_rush_multiplayer_rooms_expiry
  on public.cap_rush_multiplayer_rooms (expires_at);

create table if not exists public.cap_rush_multiplayer_room_members (
  room_id uuid not null references public.cap_rush_multiplayer_rooms (id) on delete cascade,
  uid uuid not null,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  display_name text not null default 'Player',
  online boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id),
  unique (room_id, uid)
);

create table if not exists public.cap_rush_multiplayer_room_commands (
  room_id uuid not null references public.cap_rush_multiplayer_rooms (id) on delete cascade,
  command_id text not null,
  ordinal integer not null check (ordinal >= 0),
  actor_participant_id text not null check (actor_participant_id in ('p1', 'p2')),
  payload jsonb not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (room_id, command_id),
  unique (room_id, ordinal)
);
create index if not exists cap_rush_multiplayer_commands_ordinal
  on public.cap_rush_multiplayer_room_commands (room_id, ordinal);

create table if not exists public.cap_rush_multiplayer_verification_receipts (
  room_id uuid not null references public.cap_rush_multiplayer_rooms (id) on delete cascade,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  receipt_id text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

create table if not exists public.cap_rush_multiplayer_join_attempts (
  id bigserial primary key,
  uid uuid not null,
  code text,
  created_at timestamptz not null default now()
);
create index if not exists cap_rush_multiplayer_attempts_uid
  on public.cap_rush_multiplayer_join_attempts (uid, created_at);

alter table public.cap_rush_multiplayer_rooms enable row level security;
alter table public.cap_rush_multiplayer_room_members enable row level security;
alter table public.cap_rush_multiplayer_room_commands enable row level security;
alter table public.cap_rush_multiplayer_verification_receipts enable row level security;
alter table public.cap_rush_multiplayer_join_attempts enable row level security;

create or replace function public.cap_rush_multiplayer_is_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cap_rush_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid()
  );
$$;

drop policy if exists cap_rush_multiplayer_rooms_read on public.cap_rush_multiplayer_rooms;
create policy cap_rush_multiplayer_rooms_read on public.cap_rush_multiplayer_rooms
  for select to authenticated using (public.cap_rush_multiplayer_is_member(id));

drop policy if exists cap_rush_multiplayer_members_read on public.cap_rush_multiplayer_room_members;
create policy cap_rush_multiplayer_members_read on public.cap_rush_multiplayer_room_members
  for select to authenticated using (public.cap_rush_multiplayer_is_member(room_id));

drop policy if exists cap_rush_multiplayer_commands_read on public.cap_rush_multiplayer_room_commands;
create policy cap_rush_multiplayer_commands_read on public.cap_rush_multiplayer_room_commands
  for select to authenticated using (public.cap_rush_multiplayer_is_member(room_id));

drop policy if exists cap_rush_multiplayer_receipts_read on public.cap_rush_multiplayer_verification_receipts;
create policy cap_rush_multiplayer_receipts_read on public.cap_rush_multiplayer_verification_receipts
  for select to authenticated using (public.cap_rush_multiplayer_is_member(room_id));

create or replace function public.cap_rush_multiplayer_initial_state(p_root_seed text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'phase', 'lobby',
    'rootSeed', p_root_seed,
    'franchises', null,
    'ready', jsonb_build_object('p1', false, 'p2', false),
    'lockConfirmations', jsonb_build_object('p1', null, 'p2', null),
    'recruitment', null,
    'locked', null,
    'season', null,
    'postseason', null,
    'completion', null,
    'report', null
  );
$$;

create or replace function public.cap_rush_multiplayer_room_json(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'roomId', r.id,
    'code', r.code,
    'codeActive', r.code_active,
    'settings', r.settings,
    'phase', r.phase,
    'revision', r.revision,
    'commandCount', r.command_count,
    'members', jsonb_build_array(
      jsonb_build_object(
        'participantId', 'p1',
        'displayName', coalesce((select m.display_name from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p1'), 'Host'),
        'online', coalesce((select m.online from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p1'), false),
        'ready', coalesce((r.state->'ready'->>'p1')::boolean, false),
        'lastSeenAt', (select m.last_seen_at from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p1')
      ),
      jsonb_build_object(
        'participantId', 'p2',
        'displayName', coalesce((select m.display_name from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2'), 'Guest'),
        'online', coalesce((select m.online from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2'), false),
        'ready', coalesce((r.state->'ready'->>'p2')::boolean, false),
        'lastSeenAt', (select m.last_seen_at from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2')
      )
    ),
    'rootSeed', r.root_seed,
    'state', r.state,
    'deadline', r.deadline,
    'resultDigest', r.result_digest,
    'confirmedDigest', r.confirmed_digest,
    'successorRoomId', r.successor_room_id,
    'expiresAt', r.expires_at,
    'createdAt', r.created_at
  )
  from public.cap_rush_multiplayer_rooms r
  where r.id = p_room_id;
$$;

create or replace function public.cap_rush_multiplayer_clock()
returns text language sql stable set search_path = '' as $$ select now()::text; $$;

create or replace function public.cap_rush_multiplayer_room_create(
  p_variant text,
  p_settings jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room_id uuid;
  v_code text;
  v_seed text;
begin
  if p_variant not in ('clash', 'roulette') then raise exception 'invalid-variant'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'invalid-settings'; end if;
  perform multiplayer_private.require_actor('P0001');
  v_code := multiplayer_private.allocate_code();
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.cap_rush_multiplayer_rooms(code, code_expires_at, variant, settings, root_seed, state, phase)
    values(v_code, now() + interval '15 minutes', p_variant, p_settings, v_seed,
      public.cap_rush_multiplayer_initial_state(v_seed), 'lobby')
    returning id into v_room_id;
  insert into public.cap_rush_multiplayer_room_members(room_id, uid, participant_id, display_name, online, last_seen_at)
    values(v_room_id, auth.uid(), 'p1', 'Host', true, now());
  return jsonb_build_object('roomId', v_room_id, 'code', v_code, 'rootSeed', v_seed);
end $$;

create or replace function public.cap_rush_multiplayer_room_init(
  p_room_id uuid,
  p_state jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.cap_rush_multiplayer_rooms%rowtype;
begin
  select * into v_room from public.cap_rush_multiplayer_rooms where id = p_room_id for update;
  if not found then raise exception 'invalid-room'; end if;
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  if v_room.state is not null and v_room.command_count > 0 then raise exception 'already-started'; end if;
  update public.cap_rush_multiplayer_rooms
    set state = p_state, phase = coalesce(p_state->>'phase', phase), updated_at = now()
    where id = p_room_id;
  return public.cap_rush_multiplayer_room_json(p_room_id);
end $$;

create or replace function public.cap_rush_multiplayer_room_preview(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.cap_rush_multiplayer_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if v_id is null then raise exception 'invalid-code'; end if;
  return public.cap_rush_multiplayer_room_json(v_id);
end $$;

create or replace function public.cap_rush_multiplayer_room_join(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.cap_rush_multiplayer_rooms%rowtype;
begin
  perform multiplayer_private.require_actor('P0001');
  insert into public.cap_rush_multiplayer_join_attempts(uid, code) values(auth.uid(), p_code);
  select * into v_room from public.cap_rush_multiplayer_rooms
    where code = p_code and code_active and code_expires_at > now() for update;
  if not found then raise exception 'invalid-code'; end if;
  if exists(select 1 from public.cap_rush_multiplayer_room_members where room_id = v_room.id and participant_id = 'p2') then
    if not exists(select 1 from public.cap_rush_multiplayer_room_members where room_id = v_room.id and participant_id = 'p2' and uid = auth.uid()) then
      raise exception 'room-full';
    end if;
  else
    insert into public.cap_rush_multiplayer_room_members(room_id, uid, participant_id, display_name, online, last_seen_at)
      values(v_room.id, auth.uid(), 'p2', 'Guest', true, now());
    update public.cap_rush_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  return jsonb_build_object('roomId', v_room.id, 'participantId', 'p2', 'code', v_room.code);
end $$;

create or replace function public.cap_rush_multiplayer_room_resume(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.cap_rush_multiplayer_rooms%rowtype; v_member public.cap_rush_multiplayer_room_members%rowtype;
begin
  select * into v_room from public.cap_rush_multiplayer_rooms where id = p_room_id for update;
  if not found then raise exception 'invalid-room'; end if;
  select * into v_member from public.cap_rush_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid();
  if not found then raise exception 'membership'; end if;
  update public.cap_rush_multiplayer_room_members set online = true, last_seen_at = now()
    where room_id = p_room_id and participant_id = v_member.participant_id;
  if v_room.state is null then
    update public.cap_rush_multiplayer_rooms
      set state = public.cap_rush_multiplayer_initial_state(v_room.root_seed)
      where id = p_room_id;
  end if;
  return jsonb_build_object('roomId', v_room.id, 'participantId', v_member.participant_id, 'code', v_room.code);
end $$;

create or replace function public.cap_rush_multiplayer_room_sync(
  p_room_id uuid,
  p_after_ordinal integer default -1
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.cap_rush_multiplayer_rooms%rowtype;
begin
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  select * into v_room from public.cap_rush_multiplayer_rooms where id = p_room_id;
  if not found then raise exception 'invalid-room'; end if;
  return jsonb_build_object(
    'room', public.cap_rush_multiplayer_room_json(p_room_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', m.participant_id,
        'display_name', m.display_name,
        'online', m.online,
        'ready', false,
        'last_seen_at', m.last_seen_at
      ) order by m.participant_id)
      from public.cap_rush_multiplayer_room_members m where m.room_id = p_room_id
    ), '[]'::jsonb),
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'command_id', c.command_id,
        'ordinal', c.ordinal,
        'actor_participant_id', c.actor_participant_id,
        'accepted_at', c.accepted_at,
        'payload', c.payload
      ) order by c.ordinal)
      from public.cap_rush_multiplayer_room_commands c
      where c.room_id = p_room_id and c.ordinal > p_after_ordinal
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.cap_rush_multiplayer_command_submit(
  p_room_id uuid,
  p_command_id text,
  p_expected_revision integer,
  p_payload jsonb,
  p_state jsonb,
  p_state_digest text,
  p_accepted_at text,
  p_deadline jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.cap_rush_multiplayer_rooms%rowtype;
  v_member public.cap_rush_multiplayer_room_members%rowtype;
  v_existing public.cap_rush_multiplayer_room_commands%rowtype;
  v_ordinal integer;
  v_revision integer;
begin
  if p_command_id is null or length(p_command_id) = 0 then raise exception 'invalid-command'; end if;
  if octet_length(coalesce(p_payload::text, '')) > 32768 then raise exception 'payload-too-large'; end if;
  select * into v_room from public.cap_rush_multiplayer_rooms where id = p_room_id for update;
  if not found then raise exception 'invalid-room'; end if;
  select * into v_member from public.cap_rush_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid();
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'not-a-member', 'revision', v_room.revision, 'ordinal', v_room.command_count);
  end if;
  select * into v_existing from public.cap_rush_multiplayer_room_commands
    where room_id = p_room_id and command_id = p_command_id;
  if found then
    if v_existing.actor_participant_id = v_member.participant_id and v_existing.payload = p_payload then
      return jsonb_build_object('accepted', true, 'rejectionCode', null, 'revision', v_room.revision,
        'ordinal', v_existing.ordinal, 'commandId', p_command_id);
    end if;
    return jsonb_build_object('accepted', false, 'rejectionCode', 'command-conflict',
      'revision', v_room.revision, 'ordinal', v_existing.ordinal, 'commandId', p_command_id);
  end if;
  if p_expected_revision is distinct from v_room.revision then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'stale-revision',
      'revision', v_room.revision, 'ordinal', v_room.command_count, 'commandId', p_command_id);
  end if;
  v_ordinal := v_room.command_count;
  insert into public.cap_rush_multiplayer_room_commands(
    room_id, command_id, ordinal, actor_participant_id, payload, accepted_at
  ) values(p_room_id, p_command_id, v_ordinal, v_member.participant_id, p_payload,
    coalesce(p_accepted_at::timestamptz, now()));
  v_revision := v_room.revision + 1;
  update public.cap_rush_multiplayer_rooms
    set state = coalesce(p_state, state),
        state_digest = coalesce(p_state_digest, state_digest),
        phase = coalesce(p_state->>'phase', phase),
        deadline = p_deadline,
        revision = v_revision,
        command_count = v_ordinal + 1,
        updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('accepted', true, 'rejectionCode', null, 'revision', v_revision,
    'ordinal', v_ordinal, 'commandId', p_command_id);
end $$;

create or replace function public.cap_rush_multiplayer_room_remove_guest(
  p_room_id uuid,
  p_target text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_host uuid;
begin
  select uid into v_host from public.cap_rush_multiplayer_room_members
    where room_id = p_room_id and participant_id = 'p1';
  if v_host is null or v_host <> auth.uid() then raise exception 'authorization'; end if;
  delete from public.cap_rush_multiplayer_room_members
    where room_id = p_room_id and participant_id = p_target;
  update public.cap_rush_multiplayer_rooms set revision = revision + 1, updated_at = now()
    where id = p_room_id;
end $$;

create or replace function public.cap_rush_multiplayer_room_leave(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.cap_rush_multiplayer_room_members set online = false, last_seen_at = now()
    where room_id = p_room_id and uid = auth.uid();
end $$;

create or replace function public.cap_rush_multiplayer_room_complete(
  p_room_id uuid,
  p_result_digest text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  update public.cap_rush_multiplayer_rooms
    set phase = 'completed', result_digest = p_result_digest,
        confirmed_digest = p_result_digest, updated_at = now()
    where id = p_room_id;
end $$;

create or replace function public.cap_rush_multiplayer_room_fail(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  update public.cap_rush_multiplayer_rooms set phase = 'integrity-failed', updated_at = now()
    where id = p_room_id;
end $$;

create or replace function public.cap_rush_multiplayer_verification_challenge(p_room_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_room public.cap_rush_multiplayer_rooms%rowtype; v_material text;
begin
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  select * into v_room from public.cap_rush_multiplayer_rooms where id = p_room_id;
  select string_agg(c.ordinal::text || '|' || c.command_id || '|' || c.actor_participant_id || '|' || c.payload::text, E'\n' order by c.ordinal)
    into v_material
    from public.cap_rush_multiplayer_room_commands c where c.room_id = p_room_id;
  return encode(extensions.digest(
    'cap-rush-multiplayer-challenge-v1|' || p_room_id::text || '|' || v_room.root_seed || '|' ||
    coalesce(v_material, ''), 'sha256'), 'hex');
end $$;

create or replace function public.cap_rush_multiplayer_verification_submit(
  p_room_id uuid,
  p_participant text,
  p_receipt jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  select uid into v_uid from public.cap_rush_multiplayer_room_members
    where room_id = p_room_id and participant_id = p_participant;
  if v_uid is null or v_uid <> auth.uid() then raise exception 'authorization'; end if;
  insert into public.cap_rush_multiplayer_verification_receipts(room_id, participant_id, receipt_id, receipt)
    values(p_room_id, p_participant, coalesce(p_receipt->>'receiptId', gen_random_uuid()::text), p_receipt)
    on conflict (room_id, participant_id) do update
      set receipt_id = excluded.receipt_id, receipt = excluded.receipt, created_at = now();
end $$;

create or replace function public.cap_rush_multiplayer_cron_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.cap_rush_multiplayer_rooms
    set phase = 'expired', code_active = false, updated_at = now()
    where expires_at <= now() and phase not in ('completed', 'integrity-failed', 'expired');
  update public.cap_rush_multiplayer_rooms
    set code_active = false
    where code_active and code_expires_at is not null and code_expires_at <= now();
  delete from public.cap_rush_multiplayer_join_attempts where created_at <= now() - interval '1 day';
  delete from public.cap_rush_multiplayer_rooms where expires_at <= now() - interval '24 hours';
end $$;

-- Shared lobby integration.
alter table public.multiplayer_lobbies drop constraint if exists multiplayer_lobbies_game_kind_check;
alter table public.multiplayer_lobbies add constraint multiplayer_lobbies_game_kind_check
  check (game_kind in ('fixed-five', 'draft-duel', 'havoc', 'cap-rush'));

create or replace function multiplayer_private.allocate_code()
returns text language plpgsql security invoker set search_path = '' as $$
declare v_code text; v_bytes bytea; v_value integer; v_i integer;
begin
  perform pg_advisory_xact_lock(731904);
  for v_i in 1..10000 loop
    v_bytes := extensions.gen_random_bytes(2);
    v_value := get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1);
    if v_value >= 60000 then continue; end if;
    v_code := lpad((v_value % 10000)::text, 4, '0');
    if not exists (select 1 from public.fixed_five_rooms where code = v_code and code_active)
      and not exists (select 1 from public.draft_duel_rooms where code = v_code and code_active)
      and not exists (select 1 from public.havoc_multiplayer_rooms where code = v_code and code_active)
      and not exists (select 1 from public.cap_rush_multiplayer_rooms where code = v_code and code_active)
      and not exists (select 1 from public.multiplayer_lobbies where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'code capacity exhausted';
end $$;

create or replace function multiplayer_private.cap_rush_adapter(
  p_operation text,
  p_room_id uuid,
  p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_code text; v_created jsonb;
begin
  case p_operation
    when 'status' then
      select jsonb_build_object('phase', phase, 'expires_at', expires_at, 'code', code)
        into v_result from public.cap_rush_multiplayer_rooms where id = p_room_id;
    when 'lookup' then
      select jsonb_build_object('room_id', id) into v_result
        from public.cap_rush_multiplayer_rooms
        where code = p_payload->>'code' and code_active and code_expires_at > now() limit 1;
    when 'join' then v_result := public.cap_rush_multiplayer_room_join(p_payload->>'code');
    when 'preview' then v_result := public.cap_rush_multiplayer_room_preview(p_payload->>'code');
    when 'create' then
      v_created := public.cap_rush_multiplayer_room_create(
        coalesce(p_payload->>'variant', 'clash'), p_payload);
      v_result := jsonb_build_object('room_id', v_created->>'roomId', 'code', v_created->>'code');
    when 'seat-guest' then
      if p_payload->>'uid' is not null then
        insert into public.cap_rush_multiplayer_room_members(room_id, uid, participant_id, display_name)
          values(p_room_id, (p_payload->>'uid')::uuid, 'p2', 'Guest')
          on conflict (room_id, participant_id) do nothing;
      end if;
      update public.cap_rush_multiplayer_rooms set revision = revision + 1, updated_at = now()
        where id = p_room_id;
    when 'transfer-guest' then
      if p_payload->>'uid' is not null then
        insert into public.cap_rush_multiplayer_room_members(room_id, uid, participant_id, display_name)
          values(p_room_id, (p_payload->>'uid')::uuid, 'p2', 'Guest')
          on conflict (room_id, participant_id) do update set uid = excluded.uid;
      end if;
    when 'set-invitation' then
      update public.cap_rush_multiplayer_rooms
        set code = p_payload->>'code', code_expires_at = (p_payload->>'expiresAt')::timestamptz
        where id = p_room_id;
    when 'deactivate' then
      update public.cap_rush_multiplayer_rooms set code_active = false where id = p_room_id;
    when 'remove-guest' then
      delete from public.cap_rush_multiplayer_room_members
        where room_id = p_room_id and participant_id = 'p2';
      select code into v_code from public.cap_rush_multiplayer_rooms where id = p_room_id;
      update public.cap_rush_multiplayer_rooms set revision = revision + 1, updated_at = now()
        where id = p_room_id;
      v_result := jsonb_build_object('code', v_code);
    else raise exception 'invalid-operation';
  end case;
  return v_result;
end $$;

create or replace function multiplayer_private.dispatch(
  p_kind text,
  p_operation text,
  p_room_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_operation is null or p_operation not in ('status', 'lookup', 'join', 'preview', 'create', 'seat-guest', 'transfer-guest', 'set-invitation', 'deactivate', 'remove-guest') then
    raise exception 'invalid-operation';
  end if;
  if p_kind is null and p_operation in ('status', 'seat-guest', 'deactivate') then return null; end if;
  case p_kind
    when 'fixed-five' then return multiplayer_private.fixed_five_adapter(p_operation, p_room_id, p_payload);
    when 'draft-duel' then return multiplayer_private.draft_duel_adapter(p_operation, p_room_id, p_payload);
    when 'havoc' then return multiplayer_private.havoc_multiplayer_adapter(p_operation, p_room_id, p_payload);
    when 'cap-rush' then return multiplayer_private.cap_rush_adapter(p_operation, p_room_id, p_payload);
    else raise exception 'invalid-mode';
  end case;
end $$;

revoke all on all functions in schema multiplayer_private from public, anon, authenticated;
grant execute on function public.cap_rush_multiplayer_is_member(uuid) to authenticated;
grant execute on function public.cap_rush_multiplayer_clock() to authenticated;
grant execute on function public.cap_rush_multiplayer_room_create(text, jsonb) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_init(uuid, jsonb) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_preview(text) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_join(text) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_resume(uuid) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_sync(uuid, integer) to authenticated;
grant execute on function public.cap_rush_multiplayer_command_submit(uuid, text, integer, jsonb, jsonb, text, text, jsonb) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_remove_guest(uuid, text) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_leave(uuid) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_complete(uuid, text) to authenticated;
grant execute on function public.cap_rush_multiplayer_room_fail(uuid) to authenticated;
grant execute on function public.cap_rush_multiplayer_verification_challenge(uuid) to authenticated;
grant execute on function public.cap_rush_multiplayer_verification_submit(uuid, text, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.cap_rush_multiplayer_rooms;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.cap_rush_multiplayer_room_commands;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

alter table public.cap_rush_multiplayer_rooms replica identity full;
alter table public.cap_rush_multiplayer_room_commands replica identity full;

notify pgrst, 'reload schema';
