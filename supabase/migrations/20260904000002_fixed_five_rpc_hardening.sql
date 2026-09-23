-- Fixed-five multiplayer protocol rewrite: server-owned timeouts, server
-- version locks, and verifier-issued receipts.
--
-- This file is the last fixed-five migration, so it redefines the complete
-- RPC surface. Replay never falls back to an earlier, weaker definition.
-- The project is reset rather than migrated, so the old
-- fixed_five_complete(uuid, text) signature is dropped instead of deprecated.
--
-- Frozen interface (the web client builds against exactly these):
--   fixed_five_commit_fallback(uuid, text, jsonb, integer) -> jsonb
--   fixed_five_timeout_resolve(uuid) -> jsonb
--   fixed_five_command_submit(uuid, text, integer, text, jsonb) -> jsonb
--   fixed_five_verification_challenge(uuid) -> text
--   fixed_five_verification_submit(uuid, text, jsonb, integer) -> jsonb
--   fixed_five_complete(uuid, text) -> jsonb
--
-- Receipt JSON keys used by the new surface: roomId, accepted, rejectionCode,
-- revision, plus cursor/participantId/pickOrdinal (deadline turns) and
-- commandId/ordinal (applied timeout commands).
--
-- Deadline advancement contract: applying a stored commitment (through
-- command_submit, timeout_resolve, or the cron) moves the room to the next
-- deadline in the same statement. deadline_cursor becomes 't<pickOrdinal>'
-- (bounded: 't0', 't1', ...), deadline_participant alternates,
-- deadline_pick_ordinal increments, deadline_at advances one timeout step, and
-- deadline_fallback clears. The timeout command id is always
-- 'timeout-<cursor>-<pickOrdinal>'.
--
-- Phase ladder (needed by the awaiting-confirmation gates below): accepted
-- 'start' moves lobby -> drafting and opens a fresh drafting deadline
-- (cursor 't0'); accepted 'propose-result' moves drafting ->
-- awaiting-confirmation.

-- 0. Server version locks.
create table if not exists public.fixed_five_server_versions (
  key text primary key,
  value text not null
);

alter table public.fixed_five_server_versions enable row level security;

drop policy if exists "ff authenticated read server versions" on public.fixed_five_server_versions;
create policy "ff authenticated read server versions"
  on public.fixed_five_server_versions for select to authenticated
  using (true);
grant select on public.fixed_five_server_versions to authenticated;

-- Canonical protocol constants. Keep engineVersion in sync with ENGINE_VERSION
-- in packages/engine/src/sim/constants.ts whenever the engine version is bumped.
insert into public.fixed_five_server_versions (key, value) values
  ('multiplayerVersion', 'fixed-five-multiplayer-v1'),
  ('autopickVersion', 'fixed-five-autopick-v1'),
  ('seedDerivationVersion', 'seed-v1'),
  ('classicRollVersion', 'classic-roll-v1'),
  ('positionNormalizationVersion', 'position-v3'),
  ('engineVersion', 'm3-engine-v22')
on conflict (key) do update set value = excluded.value;

-- 1. Deadline commitments: the server-owned autopick each seat locks in.
create table if not exists public.fixed_five_deadline_commitments (
  room_id uuid not null references public.fixed_five_rooms(id) on delete cascade,
  cursor text not null,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  pick_ordinal integer not null check (pick_ordinal >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, cursor, participant_id)
);

alter table public.fixed_five_deadline_commitments enable row level security;

drop policy if exists "ff members read deadline commitments" on public.fixed_five_deadline_commitments;
create policy "ff members read deadline commitments"
  on public.fixed_five_deadline_commitments for select to authenticated
  using (public.fixed_five_is_member(room_id));
grant select on public.fixed_five_deadline_commitments to authenticated;

-- 2. Verification receipts: one stored receipt per seat.
create table if not exists public.fixed_five_verification_receipts (
  room_id uuid not null references public.fixed_five_rooms(id) on delete cascade,
  participant_id text not null check (participant_id in ('p1', 'p2')),
  receipt_id text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (room_id, participant_id)
);

alter table public.fixed_five_verification_receipts enable row level security;

drop policy if exists "ff members read verification receipts" on public.fixed_five_verification_receipts;
create policy "ff members read verification receipts"
  on public.fixed_five_verification_receipts for select to authenticated
  using (public.fixed_five_is_member(room_id));
grant select on public.fixed_five_verification_receipts to authenticated;

-- 3. Version locks: 11-key shape plus exact equality with the server table.
create or replace function public.fixed_five_versions_valid(p_versions jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_versions is not null
    and jsonb_typeof(p_versions) = 'object'
    and p_versions ?& array[
      'dataVersion', 'ratingVersion', 'positionNormalizationVersion',
      'engineVersion', 'bracketVersion', 'scheduleVersion',
      'seedDerivationVersion', 'classicRollVersion', 'profileVersion',
      'multiplayerVersion', 'autopickVersion']
    and not exists (
      select 1
      from public.fixed_five_server_versions sv
      where (p_versions->>sv.key) is distinct from sv.value
    );
$$;
revoke all on function public.fixed_five_versions_valid(jsonb) from public;
grant execute on function public.fixed_five_versions_valid(jsonb) to authenticated;

-- 4. Create: validate versions against the server locks.
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
  if not public.fixed_five_versions_valid(p_versions) then
    raise exception 'invalid versions' using errcode = '22023';
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
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  if p_mode = 'sandbox-shared-82' then
    v_deadline := now() + interval '5 minutes';
  else
    v_deadline := now() + interval '90 seconds';
  end if;
  loop
    v_code := public.fixed_five_random_code();
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

-- 5. Preview: rate-limit enumeration of the 10k code space.
create or replace function public.fixed_five_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_recent integer;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.fixed_five_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
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

-- 6. Join: idempotent rejoin keeps its seat; fresh joins must actually land p2.
create or replace function public.fixed_five_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
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
  select * into v_room from public.fixed_five_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select participant_id into v_seat from public.fixed_five_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if found then
    update public.fixed_five_room_members set online = true, last_seen_at = now()
      where room_id = v_room.id and uid = auth.uid();
    update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
    return jsonb_build_object('room_id', v_room.id, 'participant_id', v_seat);
  end if;
  select count(*) into v_count from public.fixed_five_room_members where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do nothing;
  get diagnostics v_inserted = row_count;
  select participant_id into v_seat from public.fixed_five_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if not found or v_seat <> 'p2' then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  if v_inserted > 0 then
    update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;
revoke all on function public.fixed_five_room_join(text) from public;
grant execute on function public.fixed_five_room_join(text) to authenticated;

-- 7. Command submit: payload shape checks, seat authorization, and the
--    server-owned timeout-autopick path. A caller-chosen timeout payload is
--    never accepted: the payload must equal both the stored deadline fallback
--    and the stored commitment row for the current (cursor, seat, ordinal).
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
  v_existing_actor text;
  v_kind text;
  v_step interval;
  v_next_cursor text;
  v_commitment public.fixed_five_deadline_commitments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'payload-too-large');
  end if;
  if p_command_id is null or octet_length(p_command_id) < 1 or octet_length(p_command_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  if p_actor is null or p_actor not in ('p1', 'p2') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  v_kind := p_payload->>'kind';
  if v_kind is null or v_kind not in (
    'ready', 'start',
    'reroll', 'classic-pick', 'duel-claim',
    'sandbox-place', 'sandbox-remove', 'sandbox-lock',
    'timeout-autopick',
    'propose-result', 'confirm-result',
    'rematch-request', 'rematch-confirm',
    'leave', 'remove-guest') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  case v_kind
    when 'ready' then
      if jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'reroll' then
      if p_payload->>'axis' is distinct from 'franchise'
        and p_payload->>'axis' is distinct from 'era' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'classic-pick' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'duel-claim' then
      if p_payload->>'playerId' is null or p_payload->>'franchiseId' is null
        or p_payload->>'eraId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'sandbox-place' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'sandbox-remove' then
      if (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
        or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'timeout-autopick' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]{1,2}$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4)
        or (p_payload->>'pickOrdinal' is null or p_payload->>'pickOrdinal' !~ '^[0-9]{1,6}$')
        or p_payload->>'seedPath' is null then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'propose-result' then
      if p_payload->>'resultDigest' is null
        or octet_length(p_payload->>'resultDigest') not between 32 and 256 then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'confirm-result' then
      if p_payload->>'resultDigest' is null
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'remove-guest' then
      if p_payload->>'targetParticipantId' is distinct from 'p2' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    else
      null;
  end case;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  select ordinal, actor_participant_id into v_existing_ordinal, v_existing_actor
    from public.fixed_five_room_commands
    where room_id = p_room_id and command_id = p_command_id limit 1;
  if found then
    if v_existing_actor is distinct from p_actor then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end if;
  if v_kind = 'start' and v_room.phase <> 'lobby' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_kind = 'remove-guest'
    and (v_room.phase <> 'lobby' or v_member.participant_id <> 'p1') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_member.participant_id <> p_actor then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  if v_kind = 'timeout-autopick' then
    if v_room.deadline_at is null or v_room.deadline_at > now() then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_cursor is null or v_room.deadline_participant is null
      or v_room.deadline_pick_ordinal is null then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if p_actor <> v_room.deadline_participant then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if (p_payload->>'pickOrdinal')::integer <> v_room.deadline_pick_ordinal then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_fallback is null or p_payload is distinct from v_room.deadline_fallback then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    select * into v_commitment from public.fixed_five_deadline_commitments
      where room_id = p_room_id
        and cursor = v_room.deadline_cursor
        and participant_id = p_actor
        and pick_ordinal = v_room.deadline_pick_ordinal;
    if not found or v_commitment.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if p_command_id is distinct from
      ('timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
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
    select ordinal, actor_participant_id into v_existing_ordinal, v_existing_actor
      from public.fixed_five_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    if v_existing_actor is distinct from p_actor then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end;
  if v_room.mode = 'sandbox-shared-82' then
    v_step := interval '5 minutes';
  else
    v_step := interval '90 seconds';
  end if;
  if v_kind = 'timeout-autopick' then
    v_next_cursor := 't' || (v_room.deadline_pick_ordinal + 1)::text;
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = case when v_room.deadline_participant = 'p1' then 'p2' else 'p1' end,
          deadline_pick_ordinal = v_room.deadline_pick_ordinal + 1,
          deadline_at = now() + v_step,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_kind = 'start' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'drafting',
          deadline_cursor = 't0',
          deadline_participant = 'p1',
          deadline_pick_ordinal = 0,
          deadline_at = now() + v_step,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_kind = 'propose-result' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'awaiting-confirmation'
      where id = p_room_id;
  else
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now()
      where id = p_room_id;
  end if;
  return jsonb_build_object('accepted', true, 'ordinal', v_ordinal, 'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) from public;
grant execute on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) to authenticated;

-- 8. Commit fallback: the timed-out seat locks in its exact autopick payload
--    before the server applies it.
create or replace function public.fixed_five_commit_fallback(
  p_room_id uuid, p_cursor text, p_payload jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_member public.fixed_five_room_members%rowtype;
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
    or p_payload->>'seedPath' is null
    or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]{1,2}$'
      or (p_payload->>'slotIndex')::integer not between 0 and 4)
    or (p_payload->>'pickOrdinal' is null or p_payload->>'pickOrdinal' !~ '^[0-9]{1,6}$') then
    return jsonb_build_object('stored', false, 'accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  v_pick_ordinal := (p_payload->>'pickOrdinal')::integer;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
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
  insert into public.fixed_five_deadline_commitments
    (room_id, cursor, participant_id, pick_ordinal, payload)
    values (p_room_id, v_room.deadline_cursor, v_member.participant_id, v_room.deadline_pick_ordinal, p_payload)
    on conflict (room_id, cursor, participant_id)
    do update set pick_ordinal = excluded.pick_ordinal, payload = excluded.payload, updated_at = now();
  update public.fixed_five_rooms
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
revoke all on function public.fixed_five_commit_fallback(uuid, text, jsonb, integer) from public;
grant execute on function public.fixed_five_commit_fallback(uuid, text, jsonb, integer) to authenticated;

-- 9. Internal timeout application. Cron calls this directly; the member-facing
--    fixed_five_timeout_resolve wraps it with the membership gate.
create or replace function public.fixed_five_timeout_apply(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_commitment public.fixed_five_deadline_commitments%rowtype;
  v_command_id text;
  v_next_cursor text;
  v_ordinal integer;
  v_step interval;
begin
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'authorization');
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
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
  select * into v_commitment from public.fixed_five_deadline_commitments
    where room_id = p_room_id
      and cursor = v_room.deadline_cursor
      and participant_id = v_room.deadline_participant
      and pick_ordinal = v_room.deadline_pick_ordinal;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'no-commitment',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  v_command_id := 'timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text;
  select ordinal into v_ordinal from public.fixed_five_room_commands
    where room_id = p_room_id and command_id = v_command_id limit 1;
  if found then
    return jsonb_build_object(
      'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
      'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision,
      'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
      'pickOrdinal', v_room.deadline_pick_ordinal);
  end if;
  if v_room.mode = 'sandbox-shared-82' then
    v_step := interval '5 minutes';
  else
    v_step := interval '90 seconds';
  end if;
  v_next_cursor := 't' || (v_room.deadline_pick_ordinal + 1)::text;
  v_ordinal := v_room.command_count;
  insert into public.fixed_five_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
    values (p_room_id, v_command_id, v_ordinal, v_room.deadline_participant, v_commitment.payload);
  update public.fixed_five_rooms
    set command_count = command_count + 1,
        revision = revision + 1,
        updated_at = now(),
        deadline_cursor = v_next_cursor,
        deadline_participant = case when v_room.deadline_participant = 'p1' then 'p2' else 'p1' end,
        deadline_pick_ordinal = v_room.deadline_pick_ordinal + 1,
        deadline_at = now() + v_step,
        deadline_fallback = null
    where id = p_room_id;
  return jsonb_build_object(
    'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
    'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision + 1,
    'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
    'pickOrdinal', v_room.deadline_pick_ordinal);
end;
$$;
revoke all on function public.fixed_five_timeout_apply(uuid) from public;
revoke all on function public.fixed_five_timeout_apply(uuid) from anon;
revoke all on function public.fixed_five_timeout_apply(uuid) from authenticated;
grant execute on function public.fixed_five_timeout_apply(uuid) to service_role;

-- 10. Timeout resolve: any member may push an overdue, committed deadline.
create or replace function public.fixed_five_timeout_resolve(p_room_id uuid)
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
    select 1 from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  return public.fixed_five_timeout_apply(p_room_id);
end;
$$;
revoke all on function public.fixed_five_timeout_resolve(uuid) from public;
grant execute on function public.fixed_five_timeout_resolve(uuid) to authenticated;

-- 11. Verification challenge: the server-owned nonce bound to the room seed,
--     version locks, and the exact accepted command log in ordinal order.
create or replace function public.fixed_five_verification_challenge(p_room_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_log text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.fixed_five_room_members
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
    from public.fixed_five_room_commands c
    where c.room_id = p_room_id;
  return encode(
    extensions.digest(
      'fixed-five-challenge-v1|' || p_room_id::text || '|' || v_room.root_seed || '|'
        || v_room.versions::text || '|' || v_log,
      'sha256'
    ),
    'hex'
  );
end;
$$;
revoke all on function public.fixed_five_verification_challenge(uuid) from public;
grant execute on function public.fixed_five_verification_challenge(uuid) to authenticated;

-- 12. Verification submit: store the caller's receipt after validating it
--     against the current server challenge and accepted command log.
create or replace function public.fixed_five_verification_submit(
  p_room_id uuid, p_receipt_id text, p_receipt jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_member public.fixed_five_room_members%rowtype;
  v_command_ids jsonb;
  v_result_digest text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
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
  if p_receipt_id is null or octet_length(p_receipt_id) < 1 or octet_length(p_receipt_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if v_room.phase <> 'awaiting-confirmation' then
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
  if (p_receipt->>'challenge') is distinct from public.fixed_five_verification_challenge(p_room_id) then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt->'participantIds' is distinct from '["p1", "p2"]'::jsonb then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  select coalesce(jsonb_agg(c.command_id order by c.ordinal), '[]'::jsonb)
    into v_command_ids
    from public.fixed_five_room_commands c
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
  insert into public.fixed_five_verification_receipts
    (room_id, participant_id, receipt_id, receipt)
    values (p_room_id, v_member.participant_id, p_receipt_id, p_receipt)
    on conflict (room_id, participant_id)
    do update set receipt_id = excluded.receipt_id, receipt = excluded.receipt, created_at = now();
  update public.fixed_five_rooms
    set revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('receiptId', p_receipt_id, 'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.fixed_five_verification_submit(uuid, text, jsonb, integer) from public;
grant execute on function public.fixed_five_verification_submit(uuid, text, jsonb, integer) to authenticated;

-- 13. Complete: the receipt must be the one issued against the current server
--     challenge, and both seats must have verified confirmations for its
--     result digest. No caller-supplied digest exists any more.
drop function if exists public.fixed_five_complete(uuid, text);
create or replace function public.fixed_five_complete(p_room_id uuid, p_receipt_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_receipt jsonb;
  v_result_digest text;
  v_confirmations integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('completed', v_room.phase = 'completed', 'phase', v_room.phase);
  end if;
  if v_room.phase <> 'awaiting-confirmation' then
    return jsonb_build_object('completed', false, 'rejectionCode', 'phase', 'phase', v_room.phase);
  end if;
  if p_receipt_id is null then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  select r.receipt into v_receipt
    from public.fixed_five_verification_receipts r
    where r.room_id = p_room_id and r.receipt_id = p_receipt_id
    limit 1;
  if not found then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  if (v_receipt->>'challenge') is distinct from public.fixed_five_verification_challenge(p_room_id) then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  v_result_digest := v_receipt->>'resultDigest';
  if v_result_digest is null then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  select count(distinct c.actor_participant_id) into v_confirmations
    from public.fixed_five_room_commands c
    where c.room_id = p_room_id
      and c.payload->>'kind' = 'confirm-result'
      and c.payload->>'verified' = 'true'
      and c.payload->>'resultDigest' = v_result_digest
      and exists (
        select 1 from public.fixed_five_room_members m
        where m.room_id = p_room_id and m.participant_id = c.actor_participant_id
      );
  if v_confirmations < 2 then
    return jsonb_build_object('completed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  update public.fixed_five_rooms
    set phase = 'completed',
        result_digest = v_result_digest,
        confirmed_digest = v_result_digest,
        code_active = false,
        code = null,
        code_expires_at = null,
        updated_at = now()
    where id = p_room_id;
  return jsonb_build_object(
    'completed', true, 'phase', 'completed',
    'resultDigest', v_result_digest, 'receiptId', p_receipt_id);
end;
$$;
revoke all on function public.fixed_five_complete(uuid, text) from public;
grant execute on function public.fixed_five_complete(uuid, text) to authenticated;

-- 14. Fail: receipt disagreement (two stored receipts with different
--     receiptDigest) plus the existing distinct-digest path.
create or replace function public.fixed_five_fail(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_receipt_digests integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid()
  ) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('failed', v_room.phase = 'integrity-failed', 'phase', v_room.phase);
  end if;
  select count(distinct r.receipt->>'receiptDigest') into v_receipt_digests
    from public.fixed_five_verification_receipts r
    where r.room_id = p_room_id and r.receipt->>'receiptDigest' is not null;
  if v_receipt_digests >= 2 then
    update public.fixed_five_rooms
      set phase = 'integrity-failed', code_active = false, code = null,
          code_expires_at = null, updated_at = now()
      where id = p_room_id;
    return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
  end if;
  if not exists (
    select 1
    from public.fixed_five_room_commands p1
    join public.fixed_five_room_commands p2
      on p2.room_id = p1.room_id
      and p2.payload->>'kind' = 'propose-result'
      and p2.payload->>'resultDigest' <> p1.payload->>'resultDigest'
      and p2.actor_participant_id <> p1.actor_participant_id
    where p1.room_id = p_room_id
      and p1.payload->>'kind' = 'propose-result'
      and exists (select 1 from public.fixed_five_room_members m1
        where m1.room_id = p_room_id and m1.participant_id = p1.actor_participant_id)
      and exists (select 1 from public.fixed_five_room_members m2
        where m2.room_id = p_room_id and m2.participant_id = p2.actor_participant_id)
  ) then
    return jsonb_build_object('failed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  if not exists (select 1 from public.fixed_five_room_commands c
    where c.room_id = p_room_id and c.payload->>'kind' = 'confirm-result'
      and c.payload->>'verified' = 'false'
      and exists (select 1 from public.fixed_five_room_members m
        where m.room_id = p_room_id and m.participant_id = c.actor_participant_id)) then
    return jsonb_build_object('failed', false, 'rejectionCode', 'not-ready', 'phase', v_room.phase);
  end if;
  update public.fixed_five_rooms
    set phase = 'integrity-failed', code_active = false, code = null, code_expires_at = null, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
end;
$$;
revoke all on function public.fixed_five_fail(uuid) from public;
grant execute on function public.fixed_five_fail(uuid) to authenticated;

-- 15. Leave: only members leave; strangers do not churn the revision.
create or replace function public.fixed_five_leave(p_room_id uuid)
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
  update public.fixed_five_room_members set online = false, last_seen_at = now()
    where room_id = p_room_id and uid = auth.uid();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
end;
$$;
revoke all on function public.fixed_five_leave(uuid) from public;
grant execute on function public.fixed_five_leave(uuid) to authenticated;

-- 16. Rematch: idempotent, seats the caller, carries a deadline, rate-limited.
create or replace function public.fixed_five_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_caller_seat text;
  v_new_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
  v_recent integer;
  v_deadline timestamptz;
  v_existing_code text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  select participant_id into v_caller_seat from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase <> 'completed' then
    raise exception 'phase' using errcode = 'P0001';
  end if;
  if v_room.successor_room_id is not null then
    select code into v_existing_code from public.fixed_five_rooms
      where id = v_room.successor_room_id limit 1;
    if found then
      return jsonb_build_object('room_id', v_room.successor_room_id, 'code', v_existing_code);
    end if;
  end if;
  select count(*) into v_recent from public.fixed_five_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.fixed_five_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  if not public.fixed_five_versions_valid(v_room.versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  if v_room.mode = 'sandbox-shared-82' then
    v_deadline := now() + interval '5 minutes';
  else
    v_deadline := now() + interval '90 seconds';
  end if;
  loop
    v_code := public.fixed_five_random_code();
    begin
      insert into public.fixed_five_rooms (mode, source_mode, variant, versions, root_seed, code, code_active, code_expires_at, phase, deadline_at, deadline_cursor, deadline_participant, deadline_pick_ordinal)
        values (v_room.mode, v_room.source_mode, v_room.variant, v_room.versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby', v_deadline, 'lobby', 'p1', 0)
        returning id into v_new_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_new_id, auth.uid(), v_caller_seat)
    on conflict (room_id, participant_id) do nothing;
  update public.fixed_five_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.fixed_five_rematch(uuid) from public;
grant execute on function public.fixed_five_rematch(uuid) to authenticated;

-- 17. Cron: resolve committed overdue drafting rooms server-side, then the
--     usual code expiry and retention work. service_role only.
create or replace function public.fixed_five_cron_tick()
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
    from public.fixed_five_rooms r
    where r.phase = 'drafting'
      and r.deadline_at is not null
      and r.deadline_at <= now()
      and exists (
        select 1
        from public.fixed_five_deadline_commitments c
        where c.room_id = r.id
          and c.cursor = r.deadline_cursor
          and c.participant_id = r.deadline_participant
          and c.pick_ordinal = r.deadline_pick_ordinal
      )
  loop
    perform public.fixed_five_timeout_apply(v_room_id);
  end loop;
  delete from public.fixed_five_join_attempts where created_at < now() - interval '24 hours';
  update public.fixed_five_rooms set code = null, code_active = false, code_expires_at = null
    where code_active and code_expires_at is not null and code_expires_at < now();
  update public.fixed_five_rooms set phase = 'expired', updated_at = now()
    where phase not in ('completed', 'expired') and expires_at < now();
  delete from public.fixed_five_rooms where expires_at < now() - interval '24 hours';
end;
$$;
revoke all on function public.fixed_five_cron_tick() from public;
revoke all on function public.fixed_five_cron_tick() from authenticated;
revoke all on function public.fixed_five_cron_tick() from anon;
grant execute on function public.fixed_five_cron_tick() to service_role;

notify pgrst, 'reload schema';
