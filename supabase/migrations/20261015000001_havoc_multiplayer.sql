-- Havoc live multiplayer (temporary server coordination).
-- Tables: havoc_multiplayer_rooms, havoc_multiplayer_room_members,
-- havoc_multiplayer_room_commands, havoc_multiplayer_join_attempts,
-- havoc_multiplayer_deadline_commitments, havoc_multiplayer_verification_receipts,
-- havoc_multiplayer_server_versions.
-- Supabase stores settings, membership, deadlines, accepted commands, draft
-- state, series state, and final digests only.
--
-- Phase ladder driven by accepted commands:
--   lobby --ready+start--> drafting --pick/reroll/timeout-pick 10 turns--> lineup-showdown
--   --ready-next-game--> preparing-game --broadcast-start--> broadcasting
--   --propose-result--> game-results --both confirm--> preparing-game | championship
--
-- Turn order: picks alternate by parity of draft_state.turn_ordinal from
-- first_picker. The server never regenerates offers; it validates the phase,
-- the expected picker, the payload turn ordinal, the reroll budget (one per
-- participant), and person-level claim exclusivity. A rerolled offer clears
-- active_offer_id because the server cannot derive the new offer id.
--
-- first_picker/home_court replicate the frozen root-seed byte derivation so
-- server turn validation matches the engine reconciliation wave:
--   first picker = parity of byte 1 (substr(root_seed,1,2))
--   home court   = parity of byte 2 (substr(root_seed,3,2)), games 1,2,5,7
-- packages/engine/src/modes/havoc/multiplayer/draft.ts and series.ts must
-- switch havocMultiplayerFirstPickerSeed/havocMultiplayerHomeCourtSeed to the
-- same byte parity.
--
-- Havoc digests are 32-hex and are never stored in 64-hex receipt/challenge
-- columns; the verification challenge stays sha256 64-hex like draft duel.

create extension if not exists "pgcrypto";

create table if not exists public.havoc_multiplayer_rooms (
  id uuid primary key default gen_random_uuid(),
  code text check (code is null or code ~ '^[0-9]{4}$'),
  code_active boolean not null default true,
  code_expires_at timestamptz,
  versions jsonb not null,
  root_seed text not null,
  phase text not null default 'lobby'
    check (phase in ('lobby', 'drafting', 'lineup-showdown', 'preparing-game', 'broadcasting', 'game-results', 'championship', 'integrity-failed', 'expired')),
  revision integer not null default 0,
  command_count integer not null default 0,
  digest text,
  result_digest text,
  confirmed_digest text,
  successor_room_id uuid references public.havoc_multiplayer_rooms(id) on delete set null,
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

create unique index if not exists havoc_multiplayer_rooms_active_code_uidx
  on public.havoc_multiplayer_rooms (code) where code_active and code is not null;
create index if not exists havoc_multiplayer_rooms_code_expires_idx
  on public.havoc_multiplayer_rooms (code_expires_at) where code is not null;
create index if not exists havoc_multiplayer_rooms_expires_idx on public.havoc_multiplayer_rooms (expires_at);

create table if not exists public.havoc_multiplayer_room_members (
  room_id uuid not null references public.havoc_multiplayer_rooms(id) on delete cascade,
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
create index if not exists havoc_multiplayer_room_members_uid_idx on public.havoc_multiplayer_room_members (uid);

create table if not exists public.havoc_multiplayer_room_commands (
  room_id uuid not null references public.havoc_multiplayer_rooms(id) on delete cascade,
  command_id text not null,
  ordinal integer not null check (ordinal >= 0),
  actor_participant_id text not null check (actor_participant_id in ('p1', 'p2')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, command_id),
  unique (room_id, ordinal)
);
create index if not exists havoc_multiplayer_room_commands_room_ordinal_idx
  on public.havoc_multiplayer_room_commands (room_id, ordinal);

create table if not exists public.havoc_multiplayer_join_attempts (
  id uuid primary key default gen_random_uuid(),
  uid uuid,
  code text,
  created_at timestamptz not null default now()
);
create index if not exists havoc_multiplayer_join_attempts_created_idx on public.havoc_multiplayer_join_attempts (created_at);
create index if not exists havoc_multiplayer_join_attempts_uid_idx on public.havoc_multiplayer_join_attempts (uid, created_at);

create table if not exists public.havoc_multiplayer_deadline_commitments (
  room_id uuid not null references public.havoc_multiplayer_rooms(id) on delete cascade,
  cursor text not null,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  pick_ordinal integer not null check (pick_ordinal >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, cursor, participant_id)
);

create table if not exists public.havoc_multiplayer_verification_receipts (
  room_id uuid not null references public.havoc_multiplayer_rooms(id) on delete cascade,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  receipt_id text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

create table if not exists public.havoc_multiplayer_server_versions (
  key text primary key,
  value text not null
);

alter table public.havoc_multiplayer_rooms enable row level security;
alter table public.havoc_multiplayer_room_members enable row level security;
alter table public.havoc_multiplayer_room_commands enable row level security;
alter table public.havoc_multiplayer_join_attempts enable row level security;
alter table public.havoc_multiplayer_deadline_commitments enable row level security;
alter table public.havoc_multiplayer_verification_receipts enable row level security;
alter table public.havoc_multiplayer_server_versions enable row level security;

insert into public.havoc_multiplayer_server_versions (key, value) values
  ('multiplayerVersion', 'havoc-multiplayer-v1')
on conflict (key) do update set value = excluded.value;

-- Membership checks run in this definer helper: a policy on
-- havoc_multiplayer_room_members cannot subquery itself (infinite recursion).
create or replace function public.havoc_multiplayer_is_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.havoc_multiplayer_room_members m
    where m.room_id = p_room_id and m.uid = auth.uid()
  );
$$;
revoke all on function public.havoc_multiplayer_is_member(uuid) from public;
grant execute on function public.havoc_multiplayer_is_member(uuid) to authenticated;

-- Deny direct client writes: only SELECT for members. Knowing a code never grants access.
drop policy if exists "hm members read their room" on public.havoc_multiplayer_rooms;
create policy "hm members read their room"
  on public.havoc_multiplayer_rooms for select to authenticated
  using (public.havoc_multiplayer_is_member(id));

drop policy if exists "hm members read room membership" on public.havoc_multiplayer_room_members;
create policy "hm members read room membership"
  on public.havoc_multiplayer_room_members for select to authenticated
  using (public.havoc_multiplayer_is_member(room_id));

drop policy if exists "hm members read their commands" on public.havoc_multiplayer_room_commands;
create policy "hm members read their commands"
  on public.havoc_multiplayer_room_commands for select to authenticated
  using (public.havoc_multiplayer_is_member(room_id));

drop policy if exists "hm members read deadline commitments" on public.havoc_multiplayer_deadline_commitments;
create policy "hm members read deadline commitments"
  on public.havoc_multiplayer_deadline_commitments for select to authenticated
  using (public.havoc_multiplayer_is_member(room_id));

drop policy if exists "hm members read verification receipts" on public.havoc_multiplayer_verification_receipts;
create policy "hm members read verification receipts"
  on public.havoc_multiplayer_verification_receipts for select to authenticated
  using (public.havoc_multiplayer_is_member(room_id));

drop policy if exists "hm authenticated read server versions" on public.havoc_multiplayer_server_versions;
create policy "hm authenticated read server versions"
  on public.havoc_multiplayer_server_versions for select to authenticated
  using (true);
grant select on public.havoc_multiplayer_server_versions to authenticated;

-- Realtime: room + command changes for snapshot refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'havoc_multiplayer_rooms'
  ) then
    alter publication supabase_realtime add table public.havoc_multiplayer_rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'havoc_multiplayer_room_commands'
  ) then
    alter publication supabase_realtime add table public.havoc_multiplayer_room_commands;
  end if;
end $$;

alter table public.havoc_multiplayer_rooms replica identity full;
alter table public.havoc_multiplayer_room_commands replica identity full;

-- Realtime Authorization: private broadcast channel 'havoc-multiplayer:<roomId>'
-- for transient consideration/reaction events, restricted to room members.
do $guard$
begin
  if to_regclass('realtime.messages') is not null then
    execute $sql$drop policy if exists "hm members read room transient channel" on realtime.messages$sql$;
    execute $sql$create policy "hm members read room transient channel" on realtime.messages for select to authenticated using (realtime.topic() ~ '^havoc-multiplayer:[0-9a-f-]{36}$' and public.havoc_multiplayer_is_member(substring(realtime.topic() from 19)::uuid))$sql$;
    execute $sql$drop policy if exists "hm members send room transient channel" on realtime.messages$sql$;
    execute $sql$create policy "hm members send room transient channel" on realtime.messages for insert to authenticated with check (realtime.topic() ~ '^havoc-multiplayer:[0-9a-f-]{36}$' and public.havoc_multiplayer_is_member(substring(realtime.topic() from 19)::uuid))$sql$;
  end if;
end $guard$;

-- Shared 4-digit namespace: fixed_five_random_code is taught about active
-- havoc room codes in the follow-up lobby migration; havoc wraps it like
-- draft_duel_random_code does.
create or replace function public.havoc_multiplayer_random_code()
returns text
language sql
security definer
set search_path = ''
as $$
  select public.fixed_five_random_code();
$$;
revoke all on function public.havoc_multiplayer_random_code() from public, anon, authenticated;

-- FIRST PICKER: parity of root seed byte 1, exactly like draft duel.
create or replace function public.havoc_multiplayer_first_picker(p_root_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (('x' || substr(p_root_seed, 1, 2))::bit(8)::integer) % 2 = 0 then 'p1'
    else 'p2'
  end;
$$;
revoke all on function public.havoc_multiplayer_first_picker(text) from public, anon, authenticated;

-- HOME COURT side (owns games 1,2,5,7): parity of root seed byte 2.
create or replace function public.havoc_multiplayer_home_court(p_root_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (('x' || substr(p_root_seed, 3, 2))::bit(8)::integer) % 2 = 0 then 'p1'
    else 'p2'
  end;
$$;
revoke all on function public.havoc_multiplayer_home_court(text) from public, anon, authenticated;

-- Version locks: the contract version-lock keys plus the server
-- multiplayerVersion, each string-shaped, hashes 64-hex, and exact equality
-- with the server lock table for every pinned key.
create or replace function public.havoc_multiplayer_versions_valid(p_versions jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_versions is null or jsonb_typeof(p_versions) is distinct from 'object' then false
    when not (p_versions ?& array[
      'schemaVersion', 'engineVersion', 'rulesVersion', 'mutationCatalogVersion',
      'profileVersion', 'dataVersion', 'catalogVersion', 'catalogHash',
      'profileHash', 'multiplayerVersion']) then false
    when exists (
      select 1 from jsonb_each_text(p_versions) e
      where e.value is null or length(e.value) < 1 or length(e.value) > 64
    ) then false
    when (p_versions->>'catalogHash') !~ '^[0-9a-f]{64}$' then false
    when (p_versions->>'profileHash') !~ '^[0-9a-f]{64}$' then false
    else not exists (
      select 1
      from public.havoc_multiplayer_server_versions sv
      where (p_versions->>sv.key) is distinct from sv.value
    )
  end;
$$;
revoke all on function public.havoc_multiplayer_versions_valid(jsonb) from public, anon;
grant execute on function public.havoc_multiplayer_versions_valid(jsonb) to authenticated;

-- RPC: create room. Server-side root seed, rate-limited by UID, 15-minute codes.
create or replace function public.havoc_multiplayer_room_create(p_versions jsonb)
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
  if not public.havoc_multiplayer_versions_valid(p_versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.havoc_multiplayer_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.havoc_multiplayer_join_attempts (uid, code) values (auth.uid(), 'create');
  select count(*) into v_recent from public.havoc_multiplayer_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.havoc_multiplayer_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.havoc_multiplayer_random_code();
    begin
      insert into public.havoc_multiplayer_rooms (versions, root_seed, code, code_active, code_expires_at, phase)
        values (p_versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
    values (v_room_id, auth.uid(), 'p1');
  return jsonb_build_object('room_id', v_room_id, 'code', v_code);
end;
$$;
revoke all on function public.havoc_multiplayer_room_create(jsonb) from public, anon;
grant execute on function public.havoc_multiplayer_room_create(jsonb) to authenticated;

-- RPC: preview room by code (rate-limited, never leaks membership).
create or replace function public.havoc_multiplayer_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_recent integer;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.havoc_multiplayer_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.havoc_multiplayer_join_attempts (uid, code) values (auth.uid(), p_code);
  select * into v_room from public.havoc_multiplayer_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'room_id', v_room.id,
    'phase', v_room.phase,
    'revision', v_room.revision,
    'versions', v_room.versions,
    'expires_at', v_room.expires_at,
    'created_at', v_room.created_at);
end;
$$;
revoke all on function public.havoc_multiplayer_room_preview(text) from public, anon;
grant execute on function public.havoc_multiplayer_room_preview(text) to authenticated;

-- RPC: join room by code. Row-locks the room; idempotent rejoin keeps its seat.
create or replace function public.havoc_multiplayer_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
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
  select * into v_room from public.havoc_multiplayer_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select participant_id into v_seat from public.havoc_multiplayer_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if found then
    update public.havoc_multiplayer_room_members set online = true, last_seen_at = now()
      where room_id = v_room.id and uid = auth.uid();
    update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
    return jsonb_build_object('room_id', v_room.id, 'participant_id', v_seat);
  end if;
  select count(*) into v_count from public.havoc_multiplayer_room_members where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do nothing;
  get diagnostics v_inserted = row_count;
  select participant_id into v_seat from public.havoc_multiplayer_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if not found or v_seat <> 'p2' then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  if v_inserted > 0 then
    update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  insert into public.havoc_multiplayer_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;
revoke all on function public.havoc_multiplayer_room_join(text) from public, anon;
grant execute on function public.havoc_multiplayer_room_join(text) to authenticated;

-- RPC: submit command. Row-locks the room; the actor seat comes from membership.
-- Enforces phase/turn/claim/reroll/revision/idempotency/payload limits and
-- maintains draft_state, series, broadcast, digests, ready flags, and deadlines.
create or replace function public.havoc_multiplayer_command_submit(
  p_room_id uuid, p_command_id text, p_expected_revision integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_member public.havoc_multiplayer_room_members%rowtype;
  v_existing public.havoc_multiplayer_room_commands%rowtype;
  v_ordinal integer;
  v_kind text;
  v_count integer;
  v_turn integer;
  v_next integer;
  v_first text;
  v_picker text;
  v_claimed_players jsonb;
  v_claimed_cards jsonb;
  v_rerolls jsonb;
  v_active_offer text;
  v_commitment public.havoc_multiplayer_deadline_commitments%rowtype;
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
    'ready', 'start', 'pick', 'reroll', 'timeout-pick', 'ready-next-game',
    'broadcast-start', 'propose-result', 'confirm-result', 'rematch-request',
    'rematch-confirm', 'leave', 'remove-guest') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  case v_kind
    when 'pick' then
      if p_payload->>'turnOrdinal' is null
        or (p_payload->>'turnOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'turnOrdinal')::integer not between 0 and 9
        or p_payload->>'offerId' is null or (p_payload->>'offerId') !~ '^hvo-[0-9a-f]{32}$'
        or p_payload->>'cardId' is null or (p_payload->>'cardId') !~ '^hvc-[0-9a-f]{32}$'
        or jsonb_typeof(p_payload->'claimKey') is distinct from 'object'
        or p_payload->'claimKey'->>'playerId' is null
        or (p_payload->'claimKey'->>'playerId') !~ '^[a-z0-9][a-z0-9._:-]*$'
        or octet_length(p_payload->'claimKey'->>'playerId') > 64
        or p_payload->'claimKey'->>'seasonKey' is null
        or (p_payload->'claimKey'->>'seasonKey') !~ '^(19|20)[0-9]{2}-[0-9]{2}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'reroll' then
      if p_payload->>'turnOrdinal' is null
        or (p_payload->>'turnOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'turnOrdinal')::integer not between 0 and 9
        or p_payload->>'offerId' is null or (p_payload->>'offerId') !~ '^hvo-[0-9a-f]{32}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'timeout-pick' then
      if p_payload->>'turnOrdinal' is null
        or (p_payload->>'turnOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'turnOrdinal')::integer not between 0 and 9
        or p_payload->>'offerId' is null or (p_payload->>'offerId') !~ '^hvo-[0-9a-f]{32}$'
        or p_payload->>'cardId' is null or (p_payload->>'cardId') !~ '^hvc-[0-9a-f]{32}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'ready-next-game' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7 then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'broadcast-start' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7 then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
      if jsonb_exists(p_payload, 'auto') and jsonb_typeof(p_payload->'auto') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'propose-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or (p_payload->>'winner' is distinct from 'p1' and p_payload->>'winner' is distinct from 'p2')
        or p_payload->>'inputDigest' is null or (p_payload->>'inputDigest') !~ '^[0-9a-f]{32}$'
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{32}$'
        or p_payload->>'tapeDigest' is null or (p_payload->>'tapeDigest') !~ '^[0-9a-f]{32}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'confirm-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean'
        or p_payload->>'inputDigest' is null or (p_payload->>'inputDigest') !~ '^[0-9a-f]{32}$'
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{32}$'
        or p_payload->>'tapeDigest' is null or (p_payload->>'tapeDigest') !~ '^[0-9a-f]{32}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'remove-guest' then
      if p_payload->>'targetParticipantId' is distinct from 'p2' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    else
      null;
  end case;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.havoc_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  select * into v_existing from public.havoc_multiplayer_room_commands
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
  if v_room.phase = 'expired' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'expiry', 'revision', v_room.revision);
  end if;
  if v_room.phase = 'integrity-failed' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'stale-revision', 'revision', v_room.revision);
  end if;
  if v_kind = 'ready' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    update public.havoc_multiplayer_room_members
      set ready = true, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
  elsif v_kind = 'start' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    select count(*) into v_count from public.havoc_multiplayer_room_members where room_id = p_room_id;
    if v_count < 2 or exists (
      select 1 from public.havoc_multiplayer_room_members
      where room_id = p_room_id and online = false
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
    v_first := public.havoc_multiplayer_first_picker(v_room.root_seed);
    update public.havoc_multiplayer_rooms
      set phase = 'drafting',
          draft_state = jsonb_build_object(
            'turn_ordinal', 0,
            'first_picker', v_first,
            'claimed_player_ids', '[]'::jsonb,
            'claimed_card_ids', '[]'::jsonb,
            'rerolls_used', jsonb_build_object('p1', 0, 'p2', 0),
            'active_offer_id', null),
          series = jsonb_build_object(
            'homeParticipantId', public.havoc_multiplayer_home_court(v_room.root_seed),
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
    update public.havoc_multiplayer_room_members set next_game_ready = 0, locked = false where room_id = p_room_id;
  elsif v_kind = 'pick' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_turn := (p_payload->>'turnOrdinal')::integer;
    v_picker := case
      when v_turn % 2 = 0 then v_first
      when v_first = 'p1' then 'p2'
      else 'p1'
    end;
    if v_member.participant_id <> v_picker
      or v_turn <> coalesce((v_room.draft_state->>'turn_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    v_active_offer := v_room.draft_state->>'active_offer_id';
    if v_active_offer is not null and v_active_offer <> p_payload->>'offerId' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_player_ids', '[]'::jsonb)) e
      where e = p_payload->'claimKey'->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_card_ids', '[]'::jsonb)) e
      where e = p_payload->>'cardId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    v_claimed_players := coalesce(v_room.draft_state->'claimed_player_ids', '[]'::jsonb)
      || to_jsonb(p_payload->'claimKey'->>'playerId');
    v_claimed_cards := coalesce(v_room.draft_state->'claimed_card_ids', '[]'::jsonb)
      || to_jsonb(p_payload->>'cardId');
    v_next := v_turn + 1;
    update public.havoc_multiplayer_rooms
      set phase = case when v_next >= 10 then 'lineup-showdown' else phase end,
          draft_state = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(coalesce(draft_state, '{}'::jsonb), '{claimed_player_ids}', v_claimed_players, true),
                '{claimed_card_ids}', v_claimed_cards, true),
              '{turn_ordinal}', to_jsonb(v_next), true),
            '{active_offer_id}', 'null'::jsonb, true),
          deadline_at = case when v_next >= 10 then null else now() + interval '60 seconds' end,
          deadline_cursor = case when v_next >= 10 then null else 't' || v_next::text end,
          deadline_participant = case
            when v_next >= 10 then null
            when v_next % 2 = 0 then v_first
            when v_first = 'p1' then 'p2'
            else 'p1'
          end,
          deadline_pick_ordinal = case when v_next >= 10 then null else v_next end,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_kind = 'reroll' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_turn := (p_payload->>'turnOrdinal')::integer;
    v_picker := case
      when v_turn % 2 = 0 then v_first
      when v_first = 'p1' then 'p2'
      else 'p1'
    end;
    if v_member.participant_id <> v_picker
      or v_turn <> coalesce((v_room.draft_state->>'turn_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    v_active_offer := v_room.draft_state->>'active_offer_id';
    if v_active_offer is not null and v_active_offer <> p_payload->>'offerId' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    v_rerolls := coalesce(v_room.draft_state->'rerolls_used', '{}'::jsonb);
    if coalesce((v_rerolls->>v_member.participant_id)::integer, 0) >= 1 then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    v_rerolls := jsonb_set(v_rerolls, array[v_member.participant_id], '1'::jsonb, true);
    update public.havoc_multiplayer_rooms
      set draft_state = jsonb_set(
            jsonb_set(coalesce(draft_state, '{}'::jsonb), '{rerolls_used}', v_rerolls, true),
            '{active_offer_id}', 'null'::jsonb, true),
          deadline_fallback = null
      where id = p_room_id;
    delete from public.havoc_multiplayer_deadline_commitments
      where room_id = p_room_id
        and cursor = v_room.deadline_cursor
        and participant_id = v_member.participant_id;
  elsif v_kind = 'timeout-pick' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_turn := (p_payload->>'turnOrdinal')::integer;
    v_picker := case
      when v_turn % 2 = 0 then v_first
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
      or v_turn <> v_room.deadline_pick_ordinal
      or v_turn <> coalesce((v_room.draft_state->>'turn_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_room.deadline_fallback is null or p_payload is distinct from v_room.deadline_fallback then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    select * into v_commitment from public.havoc_multiplayer_deadline_commitments
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
    v_active_offer := v_room.draft_state->>'active_offer_id';
    if v_active_offer is not null and v_active_offer <> p_payload->>'offerId' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_card_ids', '[]'::jsonb)) e
      where e = p_payload->>'cardId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    v_claimed_cards := coalesce(v_room.draft_state->'claimed_card_ids', '[]'::jsonb)
      || to_jsonb(p_payload->>'cardId');
    v_next := v_turn + 1;
    update public.havoc_multiplayer_rooms
      set phase = case when v_next >= 10 then 'lineup-showdown' else phase end,
          draft_state = jsonb_set(
            jsonb_set(
              jsonb_set(coalesce(draft_state, '{}'::jsonb), '{claimed_card_ids}', v_claimed_cards, true),
              '{turn_ordinal}', to_jsonb(v_next), true),
            '{active_offer_id}', 'null'::jsonb, true),
          deadline_at = case when v_next >= 10 then null else now() + interval '60 seconds' end,
          deadline_cursor = case when v_next >= 10 then null else 't' || v_next::text end,
          deadline_participant = case
            when v_next >= 10 then null
            when v_next % 2 = 0 then v_first
            when v_first = 'p1' then 'p2'
            else 'p1'
          end,
          deadline_pick_ordinal = case when v_next >= 10 then null else v_next end,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_kind = 'ready-next-game' then
    if v_room.phase not in ('lineup-showdown', 'preparing-game', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    update public.havoc_multiplayer_room_members
      set next_game_ready = v_game, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
    if v_room.phase <> 'preparing-game' then
      update public.havoc_multiplayer_rooms set phase = 'preparing-game' where id = p_room_id;
    end if;
  elsif v_kind = 'broadcast-start' then
    if v_room.phase <> 'preparing-game' or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    select count(*) into v_count from public.havoc_multiplayer_room_members
      where room_id = p_room_id and next_game_ready = v_game;
    if v_count < 2 then
      if coalesce((p_payload->>'auto')::boolean, false) is not true
        or v_room.updated_at > now() - interval '60 seconds' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
      end if;
      update public.havoc_multiplayer_room_members set next_game_ready = v_game where room_id = p_room_id;
    end if;
    update public.havoc_multiplayer_rooms
      set phase = 'broadcasting',
          broadcast = jsonb_build_object(
            'gameNumber', v_game,
            'startedAtIso', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'durationMs', 8000)
      where id = p_room_id;
    update public.havoc_multiplayer_room_members set next_game_ready = 0 where room_id = p_room_id;
  elsif v_kind = 'propose-result' then
    if v_room.phase not in ('broadcasting', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    update public.havoc_multiplayer_rooms
      set phase = case when phase = 'broadcasting' then 'game-results' else phase end,
          result_digest = p_payload->>'resultDigest',
          game_state = jsonb_set(
            jsonb_set(
              coalesce(game_state, '{}'::jsonb),
              array['proposals'],
              coalesce(game_state->'proposals', '{}'::jsonb),
              true),
            array['proposals', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'winner', p_payload->>'winner',
              'inputDigest', p_payload->>'inputDigest',
              'resultDigest', p_payload->>'resultDigest',
              'tapeDigest', p_payload->>'tapeDigest'),
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
      select 1 from public.havoc_multiplayer_room_commands c
      where c.room_id = p_room_id
        and c.payload->>'kind' = 'propose-result'
        and (c.payload->>'gameNumber')::integer = v_game
        and c.payload->>'inputDigest' = p_payload->>'inputDigest'
        and c.payload->>'resultDigest' = p_payload->>'resultDigest'
        and c.payload->>'tapeDigest' = p_payload->>'tapeDigest'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    update public.havoc_multiplayer_rooms
      set phase = case when phase = 'broadcasting' then 'game-results' else phase end,
          game_state = jsonb_set(
            jsonb_set(
              coalesce(game_state, '{}'::jsonb),
              array['confirmations'],
              coalesce(game_state->'confirmations', '{}'::jsonb),
              true),
            array['confirmations', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'inputDigest', p_payload->>'inputDigest',
              'resultDigest', p_payload->>'resultDigest',
              'tapeDigest', p_payload->>'tapeDigest',
              'verified', (p_payload->>'verified')::boolean),
            true)
      where id = p_room_id;
    select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id;
    if v_room.game_state->'confirmations'->'p1'->>'gameNumber' = v_game::text
      and v_room.game_state->'confirmations'->'p2'->>'gameNumber' = v_game::text
      and v_room.game_state->'confirmations'->'p1'->>'inputDigest' = v_room.game_state->'confirmations'->'p2'->>'inputDigest'
      and v_room.game_state->'confirmations'->'p1'->>'resultDigest' = v_room.game_state->'confirmations'->'p2'->>'resultDigest'
      and v_room.game_state->'confirmations'->'p1'->>'tapeDigest' = v_room.game_state->'confirmations'->'p2'->>'tapeDigest'
      and v_room.game_state->'confirmations'->'p1'->>'verified' = 'true'
      and v_room.game_state->'confirmations'->'p2'->>'verified' = 'true' then
      v_winner := coalesce(
        v_room.game_state->'proposals'->'p1'->>'winner',
        v_room.game_state->'proposals'->'p2'->>'winner');
      v_series := v_room.series;
      if v_winner is not null then
        v_home := case
          when v_game in (1, 2, 5, 7) then v_series->>'homeParticipantId'
          when v_series->>'homeParticipantId' = 'p1' then 'p2'
          else 'p1'
        end;
        v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
        v_p1 := coalesce((v_series->>'p1Wins')::integer, 0) + case when v_winner = 'p1' then 1 else 0 end;
        v_p2 := coalesce((v_series->>'p2Wins')::integer, 0) + case when v_winner = 'p2' then 1 else 0 end;
        v_series := jsonb_build_object(
          'homeParticipantId', v_series->>'homeParticipantId',
          'games', coalesce(v_series->'games', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'gameNumber', v_game,
            'homeParticipantId', v_home,
            'awayParticipantId', v_away,
            'status', 'verified',
            'winner', v_winner,
            'inputDigest', p_payload->>'inputDigest',
            'resultDigest', p_payload->>'resultDigest',
            'tapeDigest', p_payload->>'tapeDigest')),
          'p1Wins', v_p1,
          'p2Wins', v_p2,
          'currentGameNumber', case when v_p1 >= 4 or v_p2 >= 4 then null else v_game + 1 end,
          'champion', case when v_p1 >= 4 then 'p1' when v_p2 >= 4 then 'p2' else null end);
      else
        v_series := jsonb_build_object(
          'homeParticipantId', v_series->>'homeParticipantId',
          'games', coalesce(v_series->'games', '[]'::jsonb),
          'p1Wins', coalesce((v_series->>'p1Wins')::integer, 0),
          'p2Wins', coalesce((v_series->>'p2Wins')::integer, 0),
          'currentGameNumber', case when v_game >= 7 then null else v_game + 1 end,
          'champion', null);
      end if;
      if v_series->>'champion' is not null then
        update public.havoc_multiplayer_rooms
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
        update public.havoc_multiplayer_rooms
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
      select 1 from public.havoc_multiplayer_room_commands c
      where c.room_id = p_room_id
        and c.payload->>'kind' = 'rematch-request'
        and c.actor_participant_id <> v_member.participant_id
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
  elsif v_kind = 'leave' then
    update public.havoc_multiplayer_room_members set online = false, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
  elsif v_kind = 'remove-guest' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    delete from public.havoc_multiplayer_room_members where room_id = p_room_id and participant_id = 'p2';
    loop
      v_code := public.havoc_multiplayer_random_code();
      begin
        update public.havoc_multiplayer_rooms
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
    insert into public.havoc_multiplayer_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
      values (p_room_id, p_command_id, v_ordinal, v_member.participant_id, p_payload);
  exception when unique_violation then
    select * into v_existing from public.havoc_multiplayer_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    if v_existing.actor_participant_id is distinct from v_member.participant_id then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    if v_existing.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'duplicate-command', 'revision', v_room.revision);
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing.ordinal, 'revision', v_room.revision);
  end;
  update public.havoc_multiplayer_rooms
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
revoke all on function public.havoc_multiplayer_command_submit(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.havoc_multiplayer_command_submit(uuid, text, integer, jsonb) to authenticated;

-- RPC: the timed-out seat locks in its exact timeout-pick payload before the server applies it.
create or replace function public.havoc_multiplayer_commit_fallback(
  p_room_id uuid, p_cursor text, p_payload jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_member public.havoc_multiplayer_room_members%rowtype;
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
  if p_payload->>'kind' is distinct from 'timeout-pick'
    or p_payload->>'turnOrdinal' is null or (p_payload->>'turnOrdinal') !~ '^[0-9]{1,2}$'
    or p_payload->>'offerId' is null or (p_payload->>'offerId') !~ '^hvo-[0-9a-f]{32}$'
    or p_payload->>'cardId' is null or (p_payload->>'cardId') !~ '^hvc-[0-9a-f]{32}$' then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  v_pick_ordinal := (p_payload->>'turnOrdinal')::integer;
  if v_pick_ordinal not between 0 and 9 then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.havoc_multiplayer_room_members
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
  insert into public.havoc_multiplayer_deadline_commitments
    (room_id, cursor, participant_id, pick_ordinal, payload)
    values (p_room_id, v_room.deadline_cursor, v_member.participant_id, v_room.deadline_pick_ordinal, p_payload)
    on conflict (room_id, cursor, participant_id)
    do update set pick_ordinal = excluded.pick_ordinal, payload = excluded.payload, updated_at = now();
  update public.havoc_multiplayer_rooms
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
revoke all on function public.havoc_multiplayer_commit_fallback(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.havoc_multiplayer_commit_fallback(uuid, text, jsonb, integer) to authenticated;

-- Internal timeout application. Cron calls this directly; the member-facing
-- havoc_multiplayer_timeout_resolve wraps it with the membership gate.
create or replace function public.havoc_multiplayer_timeout_apply(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_commitment public.havoc_multiplayer_deadline_commitments%rowtype;
  v_command_id text;
  v_ordinal integer;
  v_pick_ordinal integer;
  v_next integer;
  v_first text;
  v_claimed_cards jsonb;
begin
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
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
  select * into v_commitment from public.havoc_multiplayer_deadline_commitments
    where room_id = p_room_id
      and cursor = v_room.deadline_cursor
      and participant_id = v_room.deadline_participant
      and pick_ordinal = v_room.deadline_pick_ordinal;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'no-commitment',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  v_command_id := 'timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text;
  select ordinal into v_ordinal from public.havoc_multiplayer_room_commands
    where room_id = p_room_id and command_id = v_command_id limit 1;
  if found then
    return jsonb_build_object(
      'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
      'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision,
      'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
      'pickOrdinal', v_room.deadline_pick_ordinal);
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_card_ids', '[]'::jsonb)) e
    where e = v_commitment.payload->>'cardId'
  ) then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  v_first := coalesce(v_room.draft_state->>'first_picker', 'p1');
  v_pick_ordinal := v_room.deadline_pick_ordinal;
  v_claimed_cards := coalesce(v_room.draft_state->'claimed_card_ids', '[]'::jsonb)
    || to_jsonb(v_commitment.payload->>'cardId');
  v_next := v_pick_ordinal + 1;
  v_ordinal := v_room.command_count;
  insert into public.havoc_multiplayer_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
    values (p_room_id, v_command_id, v_ordinal, v_room.deadline_participant, v_commitment.payload);
  update public.havoc_multiplayer_rooms
    set command_count = command_count + 1,
        revision = revision + 1,
        updated_at = now(),
        phase = case when v_next >= 10 then 'lineup-showdown' else phase end,
        draft_state = jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(draft_state, '{}'::jsonb), '{claimed_card_ids}', v_claimed_cards, true),
            '{turn_ordinal}', to_jsonb(v_next), true),
          '{active_offer_id}', 'null'::jsonb, true),
        deadline_at = case when v_next >= 10 then null else now() + interval '60 seconds' end,
        deadline_cursor = case when v_next >= 10 then null else 't' || v_next::text end,
        deadline_participant = case
          when v_next >= 10 then null
          when v_next % 2 = 0 then v_first
          when v_first = 'p1' then 'p2'
          else 'p1'
        end,
        deadline_pick_ordinal = case when v_next >= 10 then null else v_next end,
        deadline_fallback = null
    where id = p_room_id;
  return jsonb_build_object(
    'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
    'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision + 1,
    'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
    'pickOrdinal', v_room.deadline_pick_ordinal);
end;
$$;
revoke all on function public.havoc_multiplayer_timeout_apply(uuid) from public, anon, authenticated;
grant execute on function public.havoc_multiplayer_timeout_apply(uuid) to service_role;

-- RPC: any member may push an overdue, committed deadline.
create or replace function public.havoc_multiplayer_timeout_resolve(p_room_id uuid)
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
    select 1 from public.havoc_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  return public.havoc_multiplayer_timeout_apply(p_room_id);
end;
$$;
revoke all on function public.havoc_multiplayer_timeout_resolve(uuid) from public, anon;
grant execute on function public.havoc_multiplayer_timeout_resolve(uuid) to authenticated;

-- RPC: server-owned nonce bound to the room seed, version locks, and command log.
create or replace function public.havoc_multiplayer_verification_challenge(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_log text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.havoc_multiplayer_room_members
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
    from public.havoc_multiplayer_room_commands c
    where c.room_id = p_room_id;
  return encode(
    extensions.digest(
      'havoc-multiplayer-challenge-v1|' || p_room_id::text || '|' || v_room.root_seed || '|'
        || v_room.versions::text || '|' || v_log,
      'sha256'
    ),
    'hex'
  );
end;
$$;
revoke all on function public.havoc_multiplayer_verification_challenge(uuid) from public, anon;
grant execute on function public.havoc_multiplayer_verification_challenge(uuid) to authenticated;

-- RPC: store the caller's receipt after validating it against the current
-- server challenge and accepted command log. Havoc digests are 32-hex;
-- challenge and receipt digest stay sha256 64-hex.
create or replace function public.havoc_multiplayer_verification_submit(
  p_room_id uuid, p_receipt_id text, p_receipt jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_member public.havoc_multiplayer_room_members%rowtype;
  v_command_ids jsonb;
  v_result_digest text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.havoc_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if p_receipt_id is null or octet_length(p_receipt_id) < 1 or octet_length(p_receipt_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
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
  if (p_receipt->>'challenge') is distinct from public.havoc_multiplayer_verification_challenge(p_room_id) then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  v_result_digest := p_receipt->>'resultDigest';
  if v_result_digest is null or v_result_digest !~* '^[0-9a-f]{32}$' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'receiptDigest') is null
    or (p_receipt->>'receiptDigest') !~* '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  select coalesce(jsonb_agg(c.command_id order by c.ordinal), '[]'::jsonb)
    into v_command_ids
    from public.havoc_multiplayer_room_commands c
    where c.room_id = p_room_id;
  if p_receipt->'commandIds' is distinct from v_command_ids then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  if jsonb_typeof(p_receipt->'gameSeeds') is distinct from 'array' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  if jsonb_array_length(p_receipt->'gameSeeds') < 1 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move',
      'revision', v_room.revision);
  end if;
  insert into public.havoc_multiplayer_verification_receipts
    (room_id, participant_id, receipt_id, receipt)
    values (p_room_id, v_member.participant_id, p_receipt_id, p_receipt)
    on conflict (room_id, participant_id)
    do update set receipt_id = excluded.receipt_id, receipt = excluded.receipt, created_at = now();
  update public.havoc_multiplayer_rooms
    set revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object(
    'accepted', true, 'rejectionCode', null,
    'receiptId', p_receipt_id, 'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.havoc_multiplayer_verification_submit(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.havoc_multiplayer_verification_submit(uuid, text, jsonb, integer) to authenticated;

-- RPC: both seats must have stored receipts with the same series result digest.
create or replace function public.havoc_multiplayer_complete(p_room_id uuid, p_receipt_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_receipt jsonb;
  v_result_digest text;
  v_seats integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.havoc_multiplayer_room_members
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
    from public.havoc_multiplayer_verification_receipts r
    where r.room_id = p_room_id and r.receipt_id = p_receipt_id
    limit 1;
  if not found then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  if (v_receipt->>'challenge') is distinct from public.havoc_multiplayer_verification_challenge(p_room_id) then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  v_result_digest := v_receipt->>'resultDigest';
  if v_result_digest is null then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  select count(distinct r.participant_id) into v_seats
    from public.havoc_multiplayer_verification_receipts r
    where r.room_id = p_room_id and r.receipt->>'resultDigest' = v_result_digest;
  if v_seats < 2 then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  update public.havoc_multiplayer_rooms
    set confirmed_digest = v_result_digest, updated_at = now()
    where id = p_room_id;
  update public.havoc_multiplayer_room_members set locked = true where room_id = p_room_id;
  return jsonb_build_object(
    'completed', true, 'phase', 'championship',
    'resultDigest', v_result_digest, 'receiptId', p_receipt_id);
end;
$$;
revoke all on function public.havoc_multiplayer_complete(uuid, text) from public, anon;
grant execute on function public.havoc_multiplayer_complete(uuid, text) to authenticated;

-- RPC: integrity failure from disagreeing receipts, disagreeing proposals, or
-- a rejected confirmation.
create or replace function public.havoc_multiplayer_fail(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_receipt_digests integer;
  v_conflicts integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.havoc_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('failed', v_room.phase = 'integrity-failed', 'phase', v_room.phase);
  end if;
  select count(distinct r.receipt->>'receiptDigest') into v_receipt_digests
    from public.havoc_multiplayer_verification_receipts r
    where r.room_id = p_room_id and r.receipt->>'receiptDigest' is not null;
  if v_receipt_digests >= 2 then
    update public.havoc_multiplayer_rooms
      set phase = 'integrity-failed', code_active = false, code = null,
          code_expires_at = null, updated_at = now()
      where id = p_room_id;
    return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
  end if;
  select count(*) into v_conflicts
    from public.havoc_multiplayer_room_commands p1
    join public.havoc_multiplayer_room_commands p2
      on p2.room_id = p1.room_id
      and p2.payload->>'kind' = 'propose-result'
      and p2.payload->>'gameNumber' = p1.payload->>'gameNumber'
      and p2.payload->>'resultDigest' <> p1.payload->>'resultDigest'
      and p2.actor_participant_id <> p1.actor_participant_id
    where p1.room_id = p_room_id
      and p1.payload->>'kind' = 'propose-result'
      and p1.payload->>'resultDigest' is not null;
  if v_conflicts > 0 then
    update public.havoc_multiplayer_rooms
      set phase = 'integrity-failed', code_active = false, code = null,
          code_expires_at = null, updated_at = now()
      where id = p_room_id;
    return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
  end if;
  if exists (
    select 1 from public.havoc_multiplayer_room_commands c
    where c.room_id = p_room_id and c.payload->>'kind' = 'confirm-result'
      and c.payload->>'verified' = 'false'
  ) then
    update public.havoc_multiplayer_rooms
      set phase = 'integrity-failed', code_active = false, code = null,
          code_expires_at = null, updated_at = now()
      where id = p_room_id;
    return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
  end if;
  return jsonb_build_object('failed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
end;
$$;
revoke all on function public.havoc_multiplayer_fail(uuid) from public, anon;
grant execute on function public.havoc_multiplayer_fail(uuid) to authenticated;

-- RPC: only members leave; strangers do not churn the revision.
create or replace function public.havoc_multiplayer_leave(p_room_id uuid)
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
  update public.havoc_multiplayer_room_members set online = false, last_seen_at = now()
    where room_id = p_room_id and uid = auth.uid();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;
revoke all on function public.havoc_multiplayer_leave(uuid) from public, anon;
grant execute on function public.havoc_multiplayer_leave(uuid) to authenticated;

-- RPC: rematch. Requires a championship room; creates a successor with fresh
-- root seed, fresh code, and no carried-over draft state.
create or replace function public.havoc_multiplayer_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
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
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  select participant_id into v_caller_seat from public.havoc_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase <> 'championship' then
    raise exception 'phase' using errcode = 'P0001';
  end if;
  if v_room.successor_room_id is not null then
    select code into v_existing_code from public.havoc_multiplayer_rooms
      where id = v_room.successor_room_id limit 1;
    if found then
      return jsonb_build_object('room_id', v_room.successor_room_id, 'code', v_existing_code);
    end if;
  end if;
  select count(*) into v_recent from public.havoc_multiplayer_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.havoc_multiplayer_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  if not public.havoc_multiplayer_versions_valid(v_room.versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.havoc_multiplayer_random_code();
    begin
      insert into public.havoc_multiplayer_rooms (versions, root_seed, code, code_active, code_expires_at, phase)
        values (v_room.versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_new_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
    values (v_new_id, auth.uid(), v_caller_seat)
    on conflict (room_id, participant_id) do nothing;
  update public.havoc_multiplayer_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.havoc_multiplayer_rematch(uuid) from public, anon;
grant execute on function public.havoc_multiplayer_rematch(uuid) to authenticated;

-- Cron: resolve committed overdue drafting rooms, then code expiry and retention.
create or replace function public.havoc_multiplayer_cron_tick()
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
    from public.havoc_multiplayer_rooms r
    where r.phase = 'drafting'
      and r.deadline_at is not null
      and r.deadline_at <= now()
      and exists (
        select 1
        from public.havoc_multiplayer_deadline_commitments c
        where c.room_id = r.id
          and c.cursor = r.deadline_cursor
          and c.participant_id = r.deadline_participant
          and c.pick_ordinal = r.deadline_pick_ordinal
      )
  loop
    perform public.havoc_multiplayer_timeout_apply(v_room_id);
  end loop;
  delete from public.havoc_multiplayer_join_attempts where created_at < now() - interval '24 hours';
  update public.havoc_multiplayer_rooms set code = null, code_active = false, code_expires_at = null
    where code_active and code_expires_at is not null and code_expires_at < now();
  update public.havoc_multiplayer_rooms set phase = 'expired', updated_at = now()
    where phase not in ('championship', 'expired') and expires_at < now();
  delete from public.havoc_multiplayer_rooms where expires_at < now() - interval '24 hours';
end;
$$;
revoke all on function public.havoc_multiplayer_cron_tick() from public, anon, authenticated;
grant execute on function public.havoc_multiplayer_cron_tick() to service_role;

notify pgrst, 'reload schema';
