-- Fixed-five multiplayer RPC hardening.
--
-- Closes, with minimal behavior change to honest clients:
--  1. timeout-autopick forgery: any member could submit any seat's pick at any
--     time. Now requires the room deadline to be overdue, the actor to equal
--     the timed-out seat, and the payload pickOrdinal to equal the server
--     cursor (plus exact fallback equality once deadline_fallback is set).
--     Accepted timeouts advance the deadline so later timeouts keep working
--     (previously single-shot: deadline_* never advanced).
--  2. complete/fail single-actor forge: one member could propose+confirm+complete
--     alone (or grief via fail alone). Now both require two DISTINCT seated
--     actors.
--  3. rematch orphan room: successor was created with zero members (creator
--     then failed RLS fetchSnapshot) and repeat calls forked successor_room_id
--     with no deadline/rate-limit. Now idempotent (returns the existing
--     successor), seats the caller in their own seat, sets a deadline, and is
--     rate-limited.
--  4. join conflict lie: ON CONFLICT ... DO UPDATE WHERE uid=excluded.uid could
--     update 0 rows (lost race) yet still bump revision and return {p2}.
--     Now verifies the caller actually holds a seat and only bumps revision on
--     a real state change.
-- Also: leave no longer bumps revision for non-members; start/remove-guest are
-- gated to lobby (+host for removal on the command path); command payloads get
-- shape checks beyond the kind whitelist so junk cannot consume ordinals;
-- preview is rate-limited like create (4-digit code space is enumerable);
-- p_versions is validated against the version-lock shape; timeout_resolve gets
-- a terminal-phase guard and advances the deadline; cron is service_role only.

-- 0. Version-lock shape check shared by create/rematch paths.
create or replace function public.fixed_five_versions_valid(p_versions jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_versions is not null
    and jsonb_typeof(p_versions) = 'object'
    and p_versions ?& array[
      'dataVersion', 'ratingVersion', 'positionNormalizationVersion',
      'engineVersion', 'bracketVersion', 'scheduleVersion',
      'seedDerivationVersion', 'classicRollVersion', 'profileVersion',
      'multiplayerVersion', 'autopickVersion'];
$$;
revoke all on function public.fixed_five_versions_valid(jsonb) from public;
grant execute on function public.fixed_five_versions_valid(jsonb) to authenticated;

-- 1. Create: validate versions.
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

-- 2. Preview: rate-limit enumeration of the 10k code space.
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

-- 3. Join: idempotent rejoin keeps its seat; fresh joins must actually land p2.
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
  -- Idempotent rejoin: a seated member gets their existing seat back.
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
  -- A lost race leaves the caller unseated: report room-full instead of
  -- returning a seat the caller does not hold.
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

-- 4. Command submit: payload shape checks + lobby gates + timeout binding.
--    Timeout-autopicks require an overdue deadline, the timed-out seat as
--    actor, and a pickOrdinal matching the server cursor. When the server
--    holds a fallback payload it must match exactly; while no fallback is
--    stored (current rooms), any well-formed pick for the right seat/ordinal
--    is accepted — authorship forgery before the deadline is still closed,
--    and digest agreement at propose/confirm remains the integrity backstop.
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
  v_kind text;
  v_step interval;
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
  if p_actor not in ('p1', 'p2') then
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
  -- Shape checks so junk payloads cannot consume ordinals. Slot/ordinal
  -- fields are guarded by a digit regex before casting so malformed text
  -- rejects as illegal-move instead of raising into a 500.
  case v_kind
    when 'ready' then
      if jsonb_typeof(p_payload->'ready') <> 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'reroll' then
      if not (p_payload->>'axis' in ('franchise', 'era')) then
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
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4)
        or (p_payload->>'pickOrdinal' is null or p_payload->>'pickOrdinal' !~ '^[0-9]+$')
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
        or jsonb_typeof(p_payload->'verified') <> 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'remove-guest' then
      if p_payload->>'targetParticipantId' <> 'p2' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    else
      -- 'start', 'sandbox-lock', 'rematch-*', 'leave' carry no extra fields.
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
  if v_kind = 'start' and v_room.phase <> 'lobby' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_kind = 'remove-guest'
    and (v_room.phase <> 'lobby' or v_member.participant_id <> 'p1') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_kind <> 'timeout-autopick' and v_member.participant_id <> p_actor then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  if v_kind = 'timeout-autopick' then
    if p_actor not in ('p1', 'p2') then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    -- The timed-out seat is server-determined; the deadline must be overdue.
    if v_room.deadline_at is null or v_room.deadline_at > now() then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_participant is not null and p_actor <> v_room.deadline_participant then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_pick_ordinal is not null
      and (p_payload->>'pickOrdinal')::integer <> v_room.deadline_pick_ordinal then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_fallback is not null and p_payload <> v_room.deadline_fallback then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if p_command_id <>
      ('timeout-' || coalesce(v_room.deadline_cursor, 'lobby') || '-' || coalesce(v_room.deadline_pick_ordinal, 0)::text)
      and p_command_id <>
      ('timeout-' || v_room.mode || '-' || p_actor || '-' || (p_payload->>'pickOrdinal')) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
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
  if v_room.mode = 'sandbox-shared-82' then
    v_step := interval '5 minutes';
  else
    v_step := interval '90 seconds';
  end if;
  if v_kind = 'timeout-autopick' then
    -- Advance the timeout window so subsequent timeouts keep resolving.
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          deadline_at = now() + v_step,
          deadline_pick_ordinal = coalesce(deadline_pick_ordinal, 0) + 1
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

-- 5. Timeout resolve: terminal-phase guard + advance the window on success.
create or replace function public.fixed_five_timeout_resolve(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_command_id text;
  v_step interval;
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
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('resolved', false);
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
  if v_room.mode = 'sandbox-shared-82' then
    v_step := interval '5 minutes';
  else
    v_step := interval '90 seconds';
  end if;
  update public.fixed_five_rooms
    set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
        deadline_at = now() + v_step,
        deadline_pick_ordinal = coalesce(deadline_pick_ordinal, 0) + 1
    where id = p_room_id;
  return jsonb_build_object('resolved', true, 'command_id', v_command_id);
end;
$$;
revoke all on function public.fixed_five_timeout_resolve(uuid) from public;
grant execute on function public.fixed_five_timeout_resolve(uuid) to authenticated;

-- 6. Complete: propose + verified confirm must come from DISTINCT seated members.
create or replace function public.fixed_five_complete(p_room_id uuid, p_result_digest text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
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
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('completed', v_room.phase = 'completed', 'phase', v_room.phase);
  end if;
  if not exists (
    select 1
    from public.fixed_five_room_commands p
    join public.fixed_five_room_commands c
      on c.room_id = p.room_id
      and c.payload->>'kind' = 'confirm-result'
      and (c.payload->>'verified') = 'true'
      and c.payload->>'resultDigest' = p_result_digest
      and c.actor_participant_id <> p.actor_participant_id
    where p.room_id = p_room_id
      and p.payload->>'kind' = 'propose-result'
      and p.payload->>'resultDigest' = p_result_digest
      and exists (select 1 from public.fixed_five_room_members m1
        where m1.room_id = p_room_id and m1.participant_id = p.actor_participant_id)
      and exists (select 1 from public.fixed_five_room_members m2
        where m2.room_id = p_room_id and m2.participant_id = c.actor_participant_id)
  ) then
    return jsonb_build_object('completed', false, 'rejection_code', 'not-ready');
  end if;
  update public.fixed_five_rooms
    set phase = 'completed', result_digest = p_result_digest, confirmed_digest = p_result_digest,
        code_active = false, code = null, code_expires_at = null, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('completed', true, 'phase', 'completed');
end;
$$;
revoke all on function public.fixed_five_complete(uuid, text) from public;
grant execute on function public.fixed_five_complete(uuid, text) to authenticated;

-- 7. Fail: distinct seated proposers with distinct digests + a seated
--    non-verifying confirmation. A lone actor can no longer grief a room.
create or replace function public.fixed_five_fail(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
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
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('failed', v_room.phase = 'integrity-failed', 'phase', v_room.phase);
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
    return jsonb_build_object('failed', false, 'rejection_code', 'not-ready');
  end if;
  if not exists (select 1 from public.fixed_five_room_commands c
    where c.room_id = p_room_id and c.payload->>'kind' = 'confirm-result'
      and c.payload->>'verified' = 'false'
      and exists (select 1 from public.fixed_five_room_members m
        where m.room_id = p_room_id and m.participant_id = c.actor_participant_id)) then
    return jsonb_build_object('failed', false, 'rejection_code', 'not-ready');
  end if;
  update public.fixed_five_rooms
    set phase = 'integrity-failed', code_active = false, code = null, code_expires_at = null, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('failed', true, 'phase', 'integrity-failed');
end;
$$;
revoke all on function public.fixed_five_fail(uuid) from public;
grant execute on function public.fixed_five_fail(uuid) to authenticated;

-- 8. Leave: only members leave; strangers no longer churn the revision (OCC guard).
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

-- 9. Rematch: idempotent, seats the caller, carries a deadline, rate-limited.
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
  -- Idempotent: repeat calls return the existing successor instead of forking.
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
    v_code := lpad((floor(random() * 10000))::text, 4, '0');
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
  -- Seat the caller in their own seat so the new room is never orphaned and
  -- the host is never stolen; the opponent joins via the fresh code.
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_new_id, auth.uid(), v_caller_seat)
    on conflict (room_id, participant_id) do nothing;
  update public.fixed_five_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.fixed_five_rematch(uuid) from public;
grant execute on function public.fixed_five_rematch(uuid) to authenticated;

-- 10. Cron/GC: service_role only.
revoke all on function public.fixed_five_cron_tick() from public;
revoke all on function public.fixed_five_cron_tick() from authenticated;
revoke all on function public.fixed_five_cron_tick() from anon;
grant execute on function public.fixed_five_cron_tick() to service_role;
