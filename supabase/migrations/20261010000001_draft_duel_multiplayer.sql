-- Draft Duel live multiplayer.
-- Tables: draft_duel_rooms, draft_duel_room_members, draft_duel_room_commands,
-- draft_duel_join_attempts, draft_duel_deadline_commitments, draft_duel_verification_receipts.
-- Supabase stores settings, membership, deadlines, accepted commands, draft state,
-- series state, and final digests only.
--
-- Phase ladder driven by accepted commands:
--   lobby --ready+start--> drafting --pick 10--> lineup-showdown
--   --ready-next-game--> preparing-game --broadcast-start--> broadcasting
--   --propose-result--> game-results --both confirm--> preparing-game | championship
--
-- Draft picks alternate by parity of draft_state.pick_ordinal from first_picker.
-- first_picker/home_winner replicate engine seed derivation
-- (packages/engine/src/modes/draft-duel/seeds.ts) so server turn validation
-- matches client derivation.
--
-- Series winner per game: the frozen propose-result payload carries only
-- digests, so the server reads an optional 'winner' key from the proposal when
-- present and records the game only with that hint; both seats must confirm the
-- same digest. Without a hint the game advances without a win being recorded.

create extension if not exists "pgcrypto";

create table if not exists public.draft_duel_rooms (
  id uuid primary key default gen_random_uuid(),
  code text check (code is null or code ~ '^[0-9]{4}$'),
  code_active boolean not null default true,
  code_expires_at timestamptz,
  fairness text not null check (fairness in ('fair', 'unfair')),
  presentation text not null check (presentation in ('ratings', 'ball-knowledge')),
  room_schema_version smallint not null default 1,
  room_protocol_version smallint not null default 1,
  versions jsonb not null,
  root_seed text not null,
  phase text not null default 'lobby'
    check (phase in ('lobby', 'drafting', 'lineup-showdown', 'preparing-game', 'broadcasting', 'game-results', 'championship', 'integrity-failed', 'expired')),
  revision integer not null default 0,
  command_count integer not null default 0,
  digest text,
  result_digest text,
  confirmed_digest text,
  successor_room_id uuid references public.draft_duel_rooms(id) on delete set null,
  deadline_at timestamptz,
  deadline_cursor text,
  deadline_participant text check (deadline_participant is null or deadline_participant in ('p1', 'p2')),
  deadline_fallback jsonb,
  deadline_pick_ordinal integer,
  draft_state jsonb not null default '{}'::jsonb,
  series jsonb,
  broadcast jsonb,
  game_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create unique index if not exists draft_duel_rooms_active_code_uidx
  on public.draft_duel_rooms (code) where code_active and code is not null;
create index if not exists draft_duel_rooms_code_expires_idx
  on public.draft_duel_rooms (code_expires_at) where code is not null;
create index if not exists draft_duel_rooms_expires_idx on public.draft_duel_rooms (expires_at);

create table if not exists public.draft_duel_room_members (
  room_id uuid not null references public.draft_duel_rooms(id) on delete cascade,
  uid uuid not null,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  online boolean not null default true,
  ready boolean not null default false,
  next_game_ready smallint not null default 0 check (next_game_ready between 0 and 7),
  locked boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id),
  unique (room_id, uid)
);
create index if not exists draft_duel_room_members_uid_idx on public.draft_duel_room_members (uid);

create table if not exists public.draft_duel_room_commands (
  room_id uuid not null references public.draft_duel_rooms(id) on delete cascade,
  command_id text not null,
  ordinal integer not null check (ordinal >= 0),
  actor_participant_id text not null check (actor_participant_id in ('p1', 'p2')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, command_id),
  unique (room_id, ordinal)
);
create index if not exists draft_duel_room_commands_room_ordinal_idx
  on public.draft_duel_room_commands (room_id, ordinal);

create table if not exists public.draft_duel_join_attempts (
  id uuid primary key default gen_random_uuid(),
  uid uuid,
  code text,
  created_at timestamptz not null default now()
);
create index if not exists draft_duel_join_attempts_created_idx on public.draft_duel_join_attempts (created_at);
create index if not exists draft_duel_join_attempts_uid_idx on public.draft_duel_join_attempts (uid, created_at);

create table if not exists public.draft_duel_deadline_commitments (
  room_id uuid not null references public.draft_duel_rooms(id) on delete cascade,
  cursor text not null,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  pick_ordinal integer not null check (pick_ordinal >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, cursor, participant_id)
);

create table if not exists public.draft_duel_verification_receipts (
  room_id uuid not null references public.draft_duel_rooms(id) on delete cascade,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  receipt_id text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

create table if not exists public.draft_duel_server_versions (
  key text primary key,
  value text not null
);

alter table public.draft_duel_rooms enable row level security;
alter table public.draft_duel_room_members enable row level security;
alter table public.draft_duel_room_commands enable row level security;
alter table public.draft_duel_join_attempts enable row level security;
alter table public.draft_duel_deadline_commitments enable row level security;
alter table public.draft_duel_verification_receipts enable row level security;
alter table public.draft_duel_server_versions enable row level security;

insert into public.draft_duel_server_versions (key, value) values
  ('multiplayerVersion', 'draft-duel-multiplayer-v1'),
  ('autopickVersion', 'draft-duel-autopick-v1')
on conflict (key) do update set value = excluded.value;

-- Membership checks run in this definer helper: a policy on draft_duel_room_members
-- cannot subquery draft_duel_room_members (infinite recursion -> 500).
create or replace function public.draft_duel_is_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.draft_duel_room_members m
    where m.room_id = p_room_id and m.uid = auth.uid()
  );
$$;
revoke all on function public.draft_duel_is_member(uuid) from public;
grant execute on function public.draft_duel_is_member(uuid) to authenticated;

-- Deny direct client writes: only SELECT for members. Knowing a code never grants access.
drop policy if exists "dd members read their room" on public.draft_duel_rooms;
create policy "dd members read their room"
  on public.draft_duel_rooms for select to authenticated
  using (public.draft_duel_is_member(id));

drop policy if exists "dd members read room membership" on public.draft_duel_room_members;
create policy "dd members read room membership"
  on public.draft_duel_room_members for select to authenticated
  using (public.draft_duel_is_member(room_id));

drop policy if exists "dd members read their commands" on public.draft_duel_room_commands;
create policy "dd members read their commands"
  on public.draft_duel_room_commands for select to authenticated
  using (public.draft_duel_is_member(room_id));

drop policy if exists "dd members read deadline commitments" on public.draft_duel_deadline_commitments;
create policy "dd members read deadline commitments"
  on public.draft_duel_deadline_commitments for select to authenticated
  using (public.draft_duel_is_member(room_id));

drop policy if exists "dd members read verification receipts" on public.draft_duel_verification_receipts;
create policy "dd members read verification receipts"
  on public.draft_duel_verification_receipts for select to authenticated
  using (public.draft_duel_is_member(room_id));

drop policy if exists "dd authenticated read server versions" on public.draft_duel_server_versions;
create policy "dd authenticated read server versions"
  on public.draft_duel_server_versions for select to authenticated
  using (true);
grant select on public.draft_duel_server_versions to authenticated;

-- Realtime: room + command changes for snapshot refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_duel_rooms'
  ) then
    alter publication supabase_realtime add table public.draft_duel_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_duel_room_commands'
  ) then
    alter publication supabase_realtime add table public.draft_duel_room_commands;
  end if;
end $$;

alter table public.draft_duel_rooms replica identity full;
alter table public.draft_duel_room_commands replica identity full;

-- Realtime Authorization: private broadcast channel 'draft-duel:<roomId>' for
-- transient consideration/reaction events, restricted to room members.
drop policy if exists "dd members read room transient channel" on realtime.messages;
create policy "dd members read room transient channel"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() ~ '^draft-duel:[0-9a-f-]{36}$'
    and public.draft_duel_is_member(substring(realtime.topic() from 12)::uuid)
  );

drop policy if exists "dd members send room transient channel" on realtime.messages;
create policy "dd members send room transient channel"
  on realtime.messages for insert to authenticated
  with check (
    realtime.topic() ~ '^draft-duel:[0-9a-f-]{36}$'
    and public.draft_duel_is_member(substring(realtime.topic() from 12)::uuid)
  );

create or replace function public.draft_duel_random_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_value integer;
begin
  loop
    v_bytes := extensions.gen_random_bytes(2);
    v_value := get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1);
    if v_value < 60000 then
      return lpad((v_value % 10000)::text, 4, '0');
    end if;
  end loop;
end;
$$;
revoke all on function public.draft_duel_random_code() from public, anon, authenticated;

-- First mulberry32 output for an engine-style seed material, as an unsigned
-- 32-bit integer. Mirrors fnv1a32 + mulberry32 in engine rng.ts.
create or replace function public.draft_duel_rng_draw(p_material text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hash bigint := 2166136261;
  v_len integer;
  v_i integer;
  v_a bigint;
  v_x bigint;
  v_t bigint;
begin
  v_len := length(p_material);
  for v_i in 1..v_len loop
    v_hash := ((v_hash # ascii(substring(p_material from v_i for 1))) * 16777619) % 4294967296;
  end loop;
  v_a := (v_hash + 1831565813) % 4294967296;
  v_x := (v_a # (v_a >> 15)) % 4294967296;
  v_t := (v_x * ((1 | v_a) % 4294967296)) % 4294967296;
  v_x := (v_t # (v_t >> 7)) % 4294967296;
  v_x := (v_x * ((61 | v_t) % 4294967296)) % 4294967296;
  v_t := ((v_t + v_x) % 4294967296) # v_t;
  return (v_t # (v_t >> 14)) % 4294967296;
end;
$$;
revoke all on function public.draft_duel_rng_draw(text) from public, anon, authenticated;

create or replace function public.draft_duel_first_picker(p_root_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.draft_duel_rng_draw('hoop-rush:draft-duel-v1:' || p_root_seed || ':first-picker') < 2147483648
      then 'p1'
    else 'p2'
  end;
$$;
revoke all on function public.draft_duel_first_picker(text) from public, anon, authenticated;

create or replace function public.draft_duel_home_winner(p_root_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.draft_duel_rng_draw('hoop-rush:draft-duel-v1:' || p_root_seed || ':home-draw') < 2147483648
      then 'p1'
    else 'p2'
  end;
$$;
revoke all on function public.draft_duel_home_winner(text) from public, anon, authenticated;

-- Version locks: 11-key shape plus exact equality with the server lock table
-- for every key the server pins.
create or replace function public.draft_duel_versions_valid(p_versions jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_versions is null or jsonb_typeof(p_versions) is distinct from 'object' then false
    when not (p_versions ?& array[
      'dataVersion', 'ratingsVersion', 'catalogVersion', 'catalogHash',
      'playerVersionIdVersion', 'positionNormalizationVersion', 'engineVersion',
      'profileVersion', 'seedDerivationVersion', 'multiplayerVersion', 'autopickVersion']) then false
    when exists (
      select 1 from jsonb_each_text(p_versions) e
      where e.value is null or length(e.value) < 1 or length(e.value) > 64
    ) then false
    when (p_versions->>'catalogHash') !~ '^[0-9a-f]{64}$' then false
    else not exists (
      select 1
      from public.draft_duel_server_versions sv
      where (p_versions->>sv.key) is distinct from sv.value
    )
  end;
$$;
revoke all on function public.draft_duel_versions_valid(jsonb) from public, anon;
grant execute on function public.draft_duel_versions_valid(jsonb) to authenticated;

-- RPC: create room. Server-side root seed, rate-limited by UID, 15-minute codes.
create or replace function public.draft_duel_room_create(
  p_fairness text, p_presentation text, p_versions jsonb)
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
begin
  if p_fairness not in ('fair', 'unfair') then
    raise exception 'invalid fairness' using errcode = '22023';
  end if;
  if p_presentation not in ('ratings', 'ball-knowledge') then
    raise exception 'invalid presentation' using errcode = '22023';
  end if;
  if not public.draft_duel_versions_valid(p_versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.draft_duel_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.draft_duel_join_attempts (uid, code) values (auth.uid(), 'create');
  select count(*) into v_recent from public.draft_duel_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.draft_duel_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.draft_duel_random_code();
    begin
      insert into public.draft_duel_rooms (fairness, presentation, versions, root_seed, code, code_active, code_expires_at, phase)
        values (p_fairness, p_presentation, p_versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.draft_duel_room_members (room_id, uid, participant_id)
    values (v_room_id, auth.uid(), 'p1');
  return jsonb_build_object('room_id', v_room_id, 'code', v_code);
end;
$$;
revoke all on function public.draft_duel_room_create(text, text, jsonb) from public, anon;
grant execute on function public.draft_duel_room_create(text, text, jsonb) to authenticated;

-- RPC: preview room by code (rate-limited, never leaks membership).
create or replace function public.draft_duel_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_recent integer;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.draft_duel_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.draft_duel_join_attempts (uid, code) values (auth.uid(), p_code);
  select * into v_room from public.draft_duel_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'room_id', v_room.id,
    'fairness', v_room.fairness,
    'presentation', v_room.presentation,
    'phase', v_room.phase,
    'revision', v_room.revision,
    'versions', v_room.versions,
    'expires_at', v_room.expires_at,
    'created_at', v_room.created_at);
end;
$$;
revoke all on function public.draft_duel_room_preview(text) from public, anon;
grant execute on function public.draft_duel_room_preview(text) to authenticated;

-- RPC: join room by code. Row-locks the room; idempotent rejoin keeps its seat.
create or replace function public.draft_duel_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_count integer;
  v_seat text;
  v_inserted integer;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.draft_duel_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select participant_id into v_seat from public.draft_duel_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if found then
    update public.draft_duel_room_members set online = true, last_seen_at = now()
      where room_id = v_room.id and uid = auth.uid();
    update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
    return jsonb_build_object('room_id', v_room.id, 'participant_id', v_seat);
  end if;
  select count(*) into v_count from public.draft_duel_room_members where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  insert into public.draft_duel_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do nothing;
  get diagnostics v_inserted = row_count;
  select participant_id into v_seat from public.draft_duel_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if not found or v_seat <> 'p2' then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  if v_inserted > 0 then
    update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  insert into public.draft_duel_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;
revoke all on function public.draft_duel_room_join(text) from public, anon;
grant execute on function public.draft_duel_room_join(text) to authenticated;

-- RPC: submit command. Row-locks the room; the actor seat comes from membership.
-- Enforces phase/turn/claim/revision/idempotency/payload limits and maintains
-- draft_state, series, broadcast, digests, ready flags, and deadlines.
create or replace function public.draft_duel_command_submit(
  p_room_id uuid, p_command_id text, p_expected_revision integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_member public.draft_duel_room_members%rowtype;
  v_existing public.draft_duel_room_commands%rowtype;
  v_ordinal integer;
  v_kind text;
  v_count integer;
  v_pick_ordinal integer;
  v_next integer;
  v_first text;
  v_picker text;
  v_claimed jsonb;
  v_commitment public.draft_duel_deadline_commitments%rowtype;
  v_game integer;
  v_home text;
  v_away text;
  v_winner text;
  v_series jsonb;
  v_p1 integer;
  v_p2 integer;
  v_code text;
  v_tries integer := 0;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'payload-too-large');
  end if;
  if p_command_id is null or octet_length(p_command_id) < 1 or octet_length(p_command_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  v_kind := p_payload->>'kind';
  if v_kind is null or v_kind not in (
    'ready', 'settings', 'start', 'pick', 'timeout-autopick', 'ready-next-game',
    'broadcast-start', 'propose-result', 'confirm-result', 'rematch-request',
    'rematch-confirm', 'leave', 'remove-guest') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  case v_kind
    when 'ready' then
      if jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'settings' then
      if (p_payload->>'fairness' is distinct from 'fair' and p_payload->>'fairness' is distinct from 'unfair')
        or (p_payload->>'presentation' is distinct from 'ratings' and p_payload->>'presentation' is distinct from 'ball-knowledge') then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'pick' then
      if p_payload->>'pickOrdinal' is null
        or (p_payload->>'pickOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'pickOrdinal')::integer not between 0 and 9
        or p_payload->>'playerId' is null
        or (p_payload->>'playerId') !~ '^[a-z0-9][a-z0-9._:-]*$'
        or p_payload->>'playerVersionId' is null
        or (p_payload->>'playerVersionId') !~ '^pv-[0-9a-f]{32}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'timeout-autopick' then
      if p_payload->>'pickOrdinal' is null
        or (p_payload->>'pickOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'pickOrdinal')::integer not between 0 and 9
        or p_payload->>'playerId' is null
        or (p_payload->>'playerId') !~ '^[a-z0-9][a-z0-9._:-]*$'
        or p_payload->>'playerVersionId' is null
        or (p_payload->>'playerVersionId') !~ '^pv-[0-9a-f]{32}$'
        or p_payload->>'seedPath' is null
        or octet_length(p_payload->>'seedPath') > 256 then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'ready-next-game' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'broadcast-start' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7 then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'propose-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{64}$'
        or p_payload->>'tapeDigest' is null or (p_payload->>'tapeDigest') !~ '^[0-9a-f]{64}$'
        or p_payload->>'inputDigest' is null or (p_payload->>'inputDigest') !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
      if p_payload ? 'winner' and p_payload->>'winner' is null then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'confirm-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'remove-guest' then
      if p_payload->>'targetParticipantId' is distinct from 'p2' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    else
      null;
  end case;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  select * into v_existing from public.draft_duel_room_commands
    where room_id = p_room_id and command_id = p_command_id limit 1;
  if found then
    if v_existing.actor_participant_id is distinct from v_member.participant_id then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    if v_existing.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'duplicate-command', 'revision', v_room.revision);
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing.ordinal, 'revision', v_room.revision);
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'stale-revision', 'revision', v_room.revision);
  end if;
  if v_kind = 'ready' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    update public.draft_duel_room_members
      set ready = (p_payload->>'ready')::boolean, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
  elsif v_kind = 'settings' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    update public.draft_duel_rooms
      set fairness = p_payload->>'fairness', presentation = p_payload->>'presentation'
      where id = p_room_id;
    update public.draft_duel_room_members set ready = false where room_id = p_room_id;
  elsif v_kind = 'start' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    select count(*) into v_count from public.draft_duel_room_members where room_id = p_room_id;
    if v_count < 2 or exists (
      select 1 from public.draft_duel_room_members
      where room_id = p_room_id and ready = false
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
    v_first := public.draft_duel_first_picker(v_room.root_seed);
    update public.draft_duel_rooms
      set phase = 'drafting',
          draft_state = jsonb_build_object(
            'pick_ordinal', 0,
            'first_picker', v_first,
            'claimed_players', '[]'::jsonb),
          series = jsonb_build_object(
            'homeWinner', public.draft_duel_home_winner(v_room.root_seed),
            'games', '[]'::jsonb,
            'p1Wins', 0,
            'p2Wins', 0,
            'currentGameNumber', 1,
            'champion', null),
          deadline_at = now() + interval '60 seconds',
          deadline_cursor = 't0',
          deadline_participant = v_first,
          deadline_pick_ordinal = 0,
          deadline_fallback = null
      where id = p_room_id;
    update public.draft_duel_room_members set next_game_ready = 0, locked = false where room_id = p_room_id;
  elsif v_kind = 'pick' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_pick_ordinal := (p_payload->>'pickOrdinal')::integer;
    v_picker := case
      when v_pick_ordinal % 2 = 0 then v_first
      when v_first = 'p1' then 'p2'
      else 'p1'
    end;
    if v_member.participant_id <> v_picker
      or v_pick_ordinal <> coalesce((v_room.draft_state->>'pick_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb)) e
      where e = p_payload->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken', 'revision', v_room.revision);
    end if;
    v_claimed := coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb) || to_jsonb(p_payload->>'playerId');
    v_next := v_pick_ordinal + 1;
    if v_next >= 10 then
      update public.draft_duel_rooms
        set phase = 'lineup-showdown',
            draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = null,
            deadline_cursor = null,
            deadline_participant = null,
            deadline_pick_ordinal = null,
            deadline_fallback = null
        where id = p_room_id;
    else
      update public.draft_duel_rooms
        set draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = now() + interval '60 seconds',
            deadline_cursor = 't' || v_next::text,
            deadline_participant = case when v_next % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end,
            deadline_pick_ordinal = v_next,
            deadline_fallback = null
        where id = p_room_id;
    end if;
  elsif v_kind = 'timeout-autopick' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_pick_ordinal := (p_payload->>'pickOrdinal')::integer;
    v_picker := case
      when v_pick_ordinal % 2 = 0 then v_first
      when v_first = 'p1' then 'p2'
      else 'p1'
    end;
    if v_room.deadline_at is null or v_room.deadline_at > now() then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_room.deadline_cursor is null or v_room.deadline_participant is null
      or v_room.deadline_pick_ordinal is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> v_room.deadline_participant
      or v_member.participant_id <> v_picker
      or v_pick_ordinal <> v_room.deadline_pick_ordinal
      or v_pick_ordinal <> coalesce((v_room.draft_state->>'pick_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_room.deadline_fallback is null or p_payload is distinct from v_room.deadline_fallback then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    select * into v_commitment from public.draft_duel_deadline_commitments
      where room_id = p_room_id
        and cursor = v_room.deadline_cursor
        and participant_id = v_room.deadline_participant
        and pick_ordinal = v_room.deadline_pick_ordinal;
    if not found or v_commitment.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    if p_command_id is distinct from
      ('timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb)) e
      where e = p_payload->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken', 'revision', v_room.revision);
    end if;
    v_claimed := coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb) || to_jsonb(p_payload->>'playerId');
    v_next := v_pick_ordinal + 1;
    if v_next >= 10 then
      update public.draft_duel_rooms
        set phase = 'lineup-showdown',
            draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = null,
            deadline_cursor = null,
            deadline_participant = null,
            deadline_pick_ordinal = null,
            deadline_fallback = null
        where id = p_room_id;
    else
      update public.draft_duel_rooms
        set draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = now() + interval '60 seconds',
            deadline_cursor = 't' || v_next::text,
            deadline_participant = case when v_next % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end,
            deadline_pick_ordinal = v_next,
            deadline_fallback = null
        where id = p_room_id;
    end if;
  elsif v_kind = 'ready-next-game' then
    if v_room.phase not in ('lineup-showdown', 'preparing-game', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    update public.draft_duel_room_members
      set next_game_ready = case when (p_payload->>'ready')::boolean then v_game else 0 end,
          last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
    if (p_payload->>'ready')::boolean and v_room.phase = 'lineup-showdown' then
      update public.draft_duel_rooms set phase = 'preparing-game' where id = p_room_id;
    end if;
  elsif v_kind = 'broadcast-start' then
    if v_room.phase <> 'preparing-game' or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    select count(*) into v_count from public.draft_duel_room_members
      where room_id = p_room_id and next_game_ready = v_game;
    if v_count < 2 then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
    update public.draft_duel_rooms
      set phase = 'broadcasting',
          broadcast = jsonb_build_object(
            'gameNumber', v_game,
            'startedAtIso', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'durationMs', 30000)
      where id = p_room_id;
    update public.draft_duel_room_members set next_game_ready = 0 where room_id = p_room_id;
  elsif v_kind = 'propose-result' then
    if v_room.phase not in ('broadcasting', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if p_payload ? 'winner' then
      v_home := case
        when v_game in (1, 2, 5, 6, 7) then v_room.series->>'homeWinner'
        when v_room.series->>'homeWinner' = 'p1' then 'p2'
        else 'p1'
      end;
      v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
      if p_payload->>'winner' is distinct from v_home and p_payload->>'winner' is distinct from v_away then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
      end if;
    end if;
    update public.draft_duel_rooms
      set phase = case when phase = 'broadcasting' then 'game-results' else phase end,
          result_digest = p_payload->>'resultDigest',
          game_state = jsonb_set(
            coalesce(game_state, '{}'::jsonb),
            array['proposals', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'resultDigest', p_payload->>'resultDigest',
              'tapeDigest', p_payload->>'tapeDigest',
              'inputDigest', p_payload->>'inputDigest',
              'winner', p_payload->>'winner'),
            true)
      where id = p_room_id;
  elsif v_kind = 'confirm-result' then
    if v_room.phase not in ('broadcasting', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if not exists (
      select 1 from public.draft_duel_room_commands c
      where c.room_id = p_room_id
        and c.payload->>'kind' = 'propose-result'
        and (c.payload->>'gameNumber')::integer = v_game
        and c.payload->>'resultDigest' = p_payload->>'resultDigest'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    update public.draft_duel_rooms
      set phase = case when phase = 'broadcasting' then 'game-results' else phase end,
          game_state = jsonb_set(
            coalesce(game_state, '{}'::jsonb),
            array['confirmations', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'resultDigest', p_payload->>'resultDigest',
              'verified', (p_payload->>'verified')::boolean),
            true)
      where id = p_room_id;
    select * into v_room from public.draft_duel_rooms where id = p_room_id;
    if v_room.game_state->'confirmations'->'p1'->>'gameNumber' = v_game::text
      and v_room.game_state->'confirmations'->'p2'->>'gameNumber' = v_game::text
      and v_room.game_state->'confirmations'->'p1'->>'resultDigest' = v_room.game_state->'confirmations'->'p2'->>'resultDigest'
      and v_room.game_state->'confirmations'->'p1'->>'verified' = 'true'
      and v_room.game_state->'confirmations'->'p2'->>'verified' = 'true' then
      v_winner := coalesce(
        v_room.game_state->'proposals'->'p1'->>'winner',
        v_room.game_state->'proposals'->'p2'->>'winner');
      v_series := v_room.series;
      if v_winner is not null then
        v_home := case
          when v_game in (1, 2, 5, 6, 7) then v_series->>'homeWinner'
          when v_series->>'homeWinner' = 'p1' then 'p2'
          else 'p1'
        end;
        v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
        v_p1 := coalesce((v_series->>'p1Wins')::integer, 0) + case when v_winner = 'p1' then 1 else 0 end;
        v_p2 := coalesce((v_series->>'p2Wins')::integer, 0) + case when v_winner = 'p2' then 1 else 0 end;
        v_series := jsonb_build_object(
          'homeWinner', v_series->>'homeWinner',
          'games', coalesce(v_series->'games', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'gameNumber', v_game,
            'homeParticipantId', v_home,
            'awayParticipantId', v_away,
            'winner', v_winner)),
          'p1Wins', v_p1,
          'p2Wins', v_p2,
          'currentGameNumber', case when v_p1 >= 4 or v_p2 >= 4 then null else v_game + 1 end,
          'champion', case when v_p1 >= 4 then 'p1' when v_p2 >= 4 then 'p2' else null end);
      else
        v_series := jsonb_build_object(
          'homeWinner', v_series->>'homeWinner',
          'games', coalesce(v_series->'games', '[]'::jsonb),
          'p1Wins', coalesce((v_series->>'p1Wins')::integer, 0),
          'p2Wins', coalesce((v_series->>'p2Wins')::integer, 0),
          'currentGameNumber', case when v_game >= 7 then null else v_game + 1 end,
          'champion', null);
      end if;
      if v_series->>'champion' is not null then
        v_code := null;
        update public.draft_duel_rooms
          set series = v_series,
              phase = 'championship',
              broadcast = null,
              game_state = '{}'::jsonb,
              result_digest = p_payload->>'resultDigest',
              confirmed_digest = p_payload->>'resultDigest',
              code = null,
              code_active = false,
              code_expires_at = null
          where id = p_room_id;
      else
        update public.draft_duel_rooms
          set series = v_series,
              phase = 'preparing-game',
              broadcast = null,
              game_state = '{}'::jsonb,
              confirmed_digest = p_payload->>'resultDigest'
          where id = p_room_id;
      end if;
    end if;
  elsif v_kind = 'rematch-request' then
    if v_room.phase <> 'championship' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
  elsif v_kind = 'rematch-confirm' then
    if v_room.phase <> 'championship' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if not exists (
      select 1 from public.draft_duel_room_commands c
      where c.room_id = p_room_id
        and c.payload->>'kind' = 'rematch-request'
        and c.actor_participant_id <> v_member.participant_id
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
  elsif v_kind = 'leave' then
    update public.draft_duel_room_members set online = false, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
  elsif v_kind = 'remove-guest' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    delete from public.draft_duel_room_members where room_id = p_room_id and participant_id = 'p2';
    loop
      v_code := public.draft_duel_random_code();
      begin
        update public.draft_duel_rooms
          set code = v_code, code_active = true, code_expires_at = now() + interval '15 minutes'
          where id = p_room_id;
        exit;
      exception when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
      end;
    end loop;
  end if;
  v_ordinal := v_room.command_count;
  begin
    insert into public.draft_duel_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
      values (p_room_id, p_command_id, v_ordinal, v_member.participant_id, p_payload);
  exception when unique_violation then
    select * into v_existing from public.draft_duel_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    if v_existing.actor_participant_id is distinct from v_member.participant_id then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    if v_existing.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'duplicate-command', 'revision', v_room.revision);
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing.ordinal, 'revision', v_room.revision);
  end;
  update public.draft_duel_rooms
    set command_count = command_count + 1, revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object(
    'roomId', p_room_id,
    'commandId', p_command_id,
    'accepted', true,
    'rejectionCode', null,
    'ordinal', v_ordinal,
    'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.draft_duel_command_submit(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.draft_duel_command_submit(uuid, text, integer, jsonb) to authenticated;

-- RPC: the timed-out seat locks in its exact autopick payload before the server applies it.
create or replace function public.draft_duel_commit_fallback(
  p_room_id uuid, p_cursor text, p_payload jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_member public.draft_duel_room_members%rowtype;
  v_pick_ordinal integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if p_cursor is null or octet_length(p_cursor) < 1 or octet_length(p_cursor) > 128 then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'payload-too-large');
  end if;
  if p_payload->>'kind' is distinct from 'timeout-autopick'
    or p_payload->>'playerId' is null
    or (p_payload->>'playerId') !~ '^[a-z0-9][a-z0-9._:-]*$'
    or p_payload->>'playerVersionId' is null
    or (p_payload->>'playerVersionId') !~ '^pv-[0-9a-f]{32}$'
    or p_payload->>'seedPath' is null
    or (p_payload->>'pickOrdinal' is null or (p_payload->>'pickOrdinal') !~ '^[0-9]{1,2}$') then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  v_pick_ordinal := (p_payload->>'pickOrdinal')::integer;
  if v_pick_ordinal not between 0 and 9 then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'phase',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.phase <> 'drafting' then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'phase',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_participant is null or v_member.participant_id <> v_room.deadline_participant then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'turn',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_cursor is null or p_cursor is distinct from v_room.deadline_cursor then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'turn',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_pick_ordinal is null or v_pick_ordinal <> v_room.deadline_pick_ordinal then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'turn',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'stale-revision',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  insert into public.draft_duel_deadline_commitments
    (room_id, cursor, participant_id, pick_ordinal, payload)
    values (p_room_id, v_room.deadline_cursor, v_member.participant_id, v_room.deadline_pick_ordinal, p_payload)
    on conflict (room_id, cursor, participant_id)
    do update set pick_ordinal = excluded.pick_ordinal, payload = excluded.payload, updated_at = now();
  update public.draft_duel_rooms
    set deadline_fallback = p_payload, revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object(
    'roomId', p_room_id,
    'stored', true,
    'accepted', true,
    'rejectionCode', null,
    'cursor', v_room.deadline_cursor,
    'participantId', v_member.participant_id,
    'pickOrdinal', v_room.deadline_pick_ordinal,
    'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.draft_duel_commit_fallback(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.draft_duel_commit_fallback(uuid, text, jsonb, integer) to authenticated;

-- Internal timeout application. Cron calls this directly; the member-facing
-- draft_duel_timeout_resolve wraps it with the membership gate.
create or replace function public.draft_duel_timeout_apply(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_commitment public.draft_duel_deadline_commitments%rowtype;
  v_command_id text;
  v_ordinal integer;
  v_pick_ordinal integer;
  v_next integer;
  v_first text;
  v_claimed jsonb;
begin
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'authorization');
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.phase <> 'drafting' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_at is null or v_room.deadline_at > now() then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'not-due',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_cursor is null or v_room.deadline_participant is null
    or v_room.deadline_pick_ordinal is null then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'no-commitment',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  select * into v_commitment from public.draft_duel_deadline_commitments
    where room_id = p_room_id
      and cursor = v_room.deadline_cursor
      and participant_id = v_room.deadline_participant
      and pick_ordinal = v_room.deadline_pick_ordinal;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'no-commitment',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  v_command_id := 'timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text;
  select ordinal into v_ordinal from public.draft_duel_room_commands
    where room_id = p_room_id and command_id = v_command_id limit 1;
  if found then
    return jsonb_build_object(
      'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
      'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision,
      'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
      'pickOrdinal', v_room.deadline_pick_ordinal);
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb)) e
    where e = v_commitment.payload->>'playerId'
  ) then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  v_first := coalesce(v_room.draft_state->>'first_picker', 'p1');
  v_pick_ordinal := v_room.deadline_pick_ordinal;
  v_claimed := coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb) || to_jsonb(v_commitment.payload->>'playerId');
  v_next := v_pick_ordinal + 1;
  v_ordinal := v_room.command_count;
  insert into public.draft_duel_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
    values (p_room_id, v_command_id, v_ordinal, v_room.deadline_participant, v_commitment.payload);
  if v_next >= 10 then
    update public.draft_duel_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          phase = 'lineup-showdown',
          draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
          deadline_at = null,
          deadline_cursor = null,
          deadline_participant = null,
          deadline_pick_ordinal = null,
          deadline_fallback = null
      where id = p_room_id;
  else
    update public.draft_duel_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
          deadline_at = now() + interval '60 seconds',
          deadline_cursor = 't' || v_next::text,
          deadline_participant = case when v_next % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end,
          deadline_pick_ordinal = v_next,
          deadline_fallback = null
      where id = p_room_id;
  end if;
  return jsonb_build_object(
    'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
    'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision + 1,
    'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
    'pickOrdinal', v_room.deadline_pick_ordinal);
end;
$$;
revoke all on function public.draft_duel_timeout_apply(uuid) from public, anon, authenticated;
grant execute on function public.draft_duel_timeout_apply(uuid) to service_role;

-- RPC: any member may push an overdue, committed deadline.
create or replace function public.draft_duel_timeout_resolve(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  return public.draft_duel_timeout_apply(p_room_id);
end;
$$;
revoke all on function public.draft_duel_timeout_resolve(uuid) from public, anon;
grant execute on function public.draft_duel_timeout_resolve(uuid) to authenticated;

-- RPC: server-owned nonce bound to the room seed, version locks, and command log.
create or replace function public.draft_duel_verification_challenge(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_log text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.draft_duel_rooms where id = p_room_id;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  select coalesce(
    string_agg(
      c.ordinal::text || '|' || c.command_id || '|' || c.actor_participant_id || '|' || c.payload::text,
      E'\n' order by c.ordinal
    ), '')
    into v_log
    from public.draft_duel_room_commands c
    where c.room_id = p_room_id;
  return encode(
    extensions.digest(
      'draft-duel-challenge-v1|' || p_room_id::text || '|' || v_room.root_seed || '|'
        || v_room.versions::text || '|' || v_log,
      'sha256'
    ),
    'hex'
  );
end;
$$;
revoke all on function public.draft_duel_verification_challenge(uuid) from public, anon;
grant execute on function public.draft_duel_verification_challenge(uuid) to authenticated;

-- RPC: store the caller's receipt after validating it against the current
-- server challenge, version locks, and accepted command log.
create or replace function public.draft_duel_verification_submit(
  p_room_id uuid, p_receipt_id text, p_receipt jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_member public.draft_duel_room_members%rowtype;
  v_command_ids jsonb;
  v_result_digest text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if p_receipt_id is null or octet_length(p_receipt_id) < 1 or octet_length(p_receipt_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase',
      'revision', v_room.revision);
  end if;
  if v_room.phase <> 'championship' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase',
      'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'stale-revision',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'schemaVersion') is distinct from '1'
    or (p_receipt->>'roomId') is distinct from p_room_id::text
    or (p_receipt->>'rootSeed') is distinct from v_room.root_seed then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt->'versions' is distinct from v_room.versions then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'challenge') is distinct from public.draft_duel_verification_challenge(p_room_id) then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt->'participantIds' is distinct from '["p1", "p2"]'::jsonb then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  select coalesce(jsonb_agg(c.command_id order by c.ordinal), '[]'::jsonb)
    into v_command_ids
    from public.draft_duel_room_commands c
    where c.room_id = p_room_id;
  if p_receipt->'commandIds' is distinct from v_command_ids then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  v_result_digest := p_receipt->>'resultDigest';
  if v_result_digest is null or v_result_digest !~* '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'receiptDigest') is null
    or (p_receipt->>'receiptDigest') !~* '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if jsonb_typeof(p_receipt->'gameSeeds') is distinct from 'array' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if jsonb_array_length(p_receipt->'gameSeeds') < 1 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  insert into public.draft_duel_verification_receipts
    (room_id, participant_id, receipt_id, receipt)
    values (p_room_id, v_member.participant_id, p_receipt_id, p_receipt)
    on conflict (room_id, participant_id)
    do update set receipt_id = excluded.receipt_id, receipt = excluded.receipt, created_at = now();
  update public.draft_duel_rooms
    set revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object(
    'accepted', true, 'rejectionCode', null,
    'receiptId', p_receipt_id, 'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.draft_duel_verification_submit(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.draft_duel_verification_submit(uuid, text, jsonb, integer) to authenticated;

-- RPC: both seats must have stored receipts with the same series result digest.
create or replace function public.draft_duel_complete(p_room_id uuid, p_receipt_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_receipt jsonb;
  v_result_digest text;
  v_seats integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('completed', false, 'phase', v_room.phase);
  end if;
  if v_room.phase <> 'championship' then
    return jsonb_build_object('completed', false, 'rejectionCode', 'phase', 'phase', v_room.phase);
  end if;
  if p_receipt_id is null then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  select r.receipt into v_receipt
    from public.draft_duel_verification_receipts r
    where r.room_id = p_room_id and r.receipt_id = p_receipt_id
    limit 1;
  if not found then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  if (v_receipt->>'challenge') is distinct from public.draft_duel_verification_challenge(p_room_id) then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  v_result_digest := v_receipt->>'resultDigest';
  if v_result_digest is null then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  select count(distinct r.participant_id) into v_seats
    from public.draft_duel_verification_receipts r
    where r.room_id = p_room_id and r.receipt->>'resultDigest' = v_result_digest;
  if v_seats < 2 then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  update public.draft_duel_rooms
    set confirmed_digest = v_result_digest, updated_at = now()
    where id = p_room_id;
  update public.draft_duel_room_members set locked = true where room_id = p_room_id;
  return jsonb_build_object(
    'completed', true, 'phase', 'championship',
    'resultDigest', v_result_digest, 'receiptId', p_receipt_id);
end;
$$;
revoke all on function public.draft_duel_complete(uuid, text) from public, anon;
grant execute on function public.draft_duel_complete(uuid, text) to authenticated;

-- RPC: integrity failure from disagreeing receipts or proposals.
create or replace function public.draft_duel_fail(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_receipt_digests integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('failed', v_room.phase = 'integrity-failed', 'phase', v_room.phase);
  end if;
  select count(distinct r.receipt->>'receiptDigest') into v_receipt_digests
    from public.draft_duel_verification_receipts r
    where r.room_id = p_room_id and r.receipt->>'receiptDigest' is not null;
  if v_receipt_digests >= 2 then
    update public.draft_duel_rooms
      set phase = 'integrity-failed', code_active = false, code = null,
          code_expires_at = null, updated_at = now()
      where id = p_room_id;
    return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
  end if;
  if not exists (
    select 1
    from public.draft_duel_room_commands p1
    join public.draft_duel_room_commands p2
      on p2.room_id = p1.room_id
      and p2.payload->>'kind' = 'propose-result'
      and p2.payload->>'gameNumber' = p1.payload->>'gameNumber'
      and p2.payload->>'resultDigest' <> p1.payload->>'resultDigest'
      and p2.actor_participant_id <> p1.actor_participant_id
    where p1.room_id = p_room_id
      and p1.payload->>'kind' = 'propose-result'
      and p1.payload->>'resultDigest' is not null
      and exists (select 1 from public.draft_duel_room_members m1
        where m1.room_id = p_room_id and m1.participant_id = p1.actor_participant_id)
      and exists (select 1 from public.draft_duel_room_members m2
        where m2.room_id = p_room_id and m2.participant_id = p2.actor_participant_id)
  ) then
    return jsonb_build_object('failed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  if not exists (
    select 1 from public.draft_duel_room_commands c
    where c.room_id = p_room_id and c.payload->>'kind' = 'confirm-result'
      and c.payload->>'verified' = 'false'
      and exists (select 1 from public.draft_duel_room_members m
        where m.room_id = p_room_id and m.participant_id = c.actor_participant_id)
  ) then
    return jsonb_build_object('failed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  update public.draft_duel_rooms
    set phase = 'integrity-failed', code_active = false, code = null,
        code_expires_at = null, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
end;
$$;
revoke all on function public.draft_duel_fail(uuid) from public, anon;
grant execute on function public.draft_duel_fail(uuid) to authenticated;

-- RPC: only members leave; strangers do not churn the revision.
create or replace function public.draft_duel_leave(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  update public.draft_duel_room_members set online = false, last_seen_at = now()
    where room_id = p_room_id and uid = auth.uid();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;
revoke all on function public.draft_duel_leave(uuid) from public, anon;
grant execute on function public.draft_duel_leave(uuid) to authenticated;

-- RPC: rematch. Requires a championship room; creates a successor with fresh
-- root seed, fresh code, and no carried-over draft state.
create or replace function public.draft_duel_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_caller_seat text;
  v_new_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
  v_recent integer;
  v_existing_code text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  select participant_id into v_caller_seat from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase <> 'championship' then
    raise exception 'phase' using errcode = 'P0001';
  end if;
  if v_room.successor_room_id is not null then
    select code into v_existing_code from public.draft_duel_rooms
      where id = v_room.successor_room_id limit 1;
    if found then
      return jsonb_build_object('room_id', v_room.successor_room_id, 'code', v_existing_code);
    end if;
  end if;
  select count(*) into v_recent from public.draft_duel_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.draft_duel_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  if not public.draft_duel_versions_valid(v_room.versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.draft_duel_random_code();
    begin
      insert into public.draft_duel_rooms (fairness, presentation, versions, root_seed, code, code_active, code_expires_at, phase)
        values (v_room.fairness, v_room.presentation, v_room.versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_new_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.draft_duel_room_members (room_id, uid, participant_id)
    values (v_new_id, auth.uid(), v_caller_seat)
    on conflict (room_id, participant_id) do nothing;
  update public.draft_duel_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.draft_duel_rematch(uuid) from public, anon;
grant execute on function public.draft_duel_rematch(uuid) to authenticated;

-- Cron: resolve committed overdue drafting rooms, then code expiry and retention.
create or replace function public.draft_duel_cron_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  for v_room_id in
    select r.id
    from public.draft_duel_rooms r
    where r.phase = 'drafting'
      and r.deadline_at is not null
      and r.deadline_at <= now()
      and exists (
        select 1
        from public.draft_duel_deadline_commitments c
        where c.room_id = r.id
          and c.cursor = r.deadline_cursor
          and c.participant_id = r.deadline_participant
          and c.pick_ordinal = r.deadline_pick_ordinal
      )
  loop
    perform public.draft_duel_timeout_apply(v_room_id);
  end loop;
  delete from public.draft_duel_join_attempts where created_at < now() - interval '24 hours';
  update public.draft_duel_rooms set code = null, code_active = false, code_expires_at = null
    where code_active and code_expires_at is not null and code_expires_at < now();
  update public.draft_duel_rooms set phase = 'expired', updated_at = now()
    where phase not in ('championship', 'expired') and expires_at < now();
  delete from public.draft_duel_rooms where expires_at < now() - interval '24 hours';
end;
$$;
revoke all on function public.draft_duel_cron_tick() from public, anon, authenticated;
grant execute on function public.draft_duel_cron_tick() to service_role;

notify pgrst, 'reload schema';
