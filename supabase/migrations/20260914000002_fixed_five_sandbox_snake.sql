insert into public.fixed_five_server_versions (key, value)
values ('multiplayerVersion', 'fixed-five-multiplayer-v3')
on conflict (key) do update set value = excluded.value;

create or replace function public.fixed_five_sandbox_picker(
  p_root_seed text,
  p_pick_ordinal integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first text;
  v_other text;
  v_round_first text;
begin
  if p_root_seed is null or p_pick_ordinal is null or p_pick_ordinal < 0 then
    raise exception 'invalid sandbox draft picker input' using errcode = '22023';
  end if;
  v_first := case
    when get_byte(decode(p_root_seed, 'hex'), 0) % 2 = 0 then 'p1'
    else 'p2'
  end;
  v_other := case when v_first = 'p1' then 'p2' else 'p1' end;
  v_round_first := case
    when (p_pick_ordinal / 2) % 2 = 0 then v_first
    else v_other
  end;
  return case
    when p_pick_ordinal % 2 = 0 then v_round_first
    else case when v_round_first = 'p1' then 'p2' else 'p1' end
  end;
end;
$$;

revoke all on function public.fixed_five_sandbox_picker(text, integer) from public, anon, authenticated;

create or replace function public.fixed_five_command_submit(
  p_room_id uuid,
  p_command_id text,
  p_expected_revision integer,
  p_actor text,
  p_payload jsonb
)
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
  v_next_ordinal integer;
  v_commitment public.fixed_five_deadline_commitments%rowtype;
  v_is_sandbox_snake boolean;
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
    'reroll', 'classic-pick', 'classic-reposition', 'duel-claim',
    'sandbox-place', 'sandbox-reposition', 'sandbox-remove', 'sandbox-lock',
    'timeout-autopick',
    'propose-result', 'confirm-result',
    'rematch-request', 'rematch-confirm',
    'leave', 'remove-guest'
  ) then
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
    when 'classic-pick', 'classic-reposition' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'duel-claim' then
      if p_payload->>'playerId' is null
        or p_payload->>'franchiseId' is null
        or p_payload->>'eraId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'sandbox-place', 'sandbox-reposition' then
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
  v_is_sandbox_snake :=
    v_room.versions->>'multiplayerVersion' = 'fixed-five-multiplayer-v3'
    and (
      v_room.mode = 'sandbox-shared-82'
      or (v_room.mode = 'duel' and v_room.source_mode = 'sandbox')
    );
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
  if v_is_sandbox_snake and v_kind = 'sandbox-place' then
    if v_room.phase <> 'drafting'
      or v_room.deadline_participant is null
      or v_room.deadline_pick_ordinal is null
      or v_room.deadline_pick_ordinal >= 10
      or p_actor <> v_room.deadline_participant then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
  end if;
  if v_is_sandbox_snake and v_kind in ('sandbox-place', 'timeout-autopick') then
    if exists (
      select 1
      from public.fixed_five_room_commands prior
      where prior.room_id = p_room_id
        and prior.payload->>'kind' in ('sandbox-place', 'timeout-autopick')
        and prior.payload->>'playerId' = p_payload->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if exists (
      select 1
      from public.fixed_five_room_commands prior
      where prior.room_id = p_room_id
        and prior.actor_participant_id = p_actor
        and prior.payload->>'kind' in ('sandbox-place', 'timeout-autopick')
        and prior.payload->>'slotIndex' = p_payload->>'slotIndex'
    ) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
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
  if v_kind = 'timeout-autopick'
    or (v_is_sandbox_snake and v_kind = 'sandbox-place') then
    v_next_ordinal := v_room.deadline_pick_ordinal + 1;
    if v_is_sandbox_snake then
      v_next_cursor := 't' || v_next_ordinal::text;
      if v_next_ordinal >= 10 then
        update public.fixed_five_rooms
          set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
              deadline_cursor = v_next_cursor,
              deadline_participant = null,
              deadline_pick_ordinal = v_next_ordinal,
              deadline_at = null,
              deadline_fallback = null
          where id = p_room_id;
      else
        update public.fixed_five_rooms
          set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
              deadline_cursor = v_next_cursor,
              deadline_participant = public.fixed_five_sandbox_picker(v_room.root_seed, v_next_ordinal),
              deadline_pick_ordinal = v_next_ordinal,
              deadline_at = now() + v_step,
              deadline_fallback = null
          where id = p_room_id;
      end if;
    else
      v_next_cursor := 't' || v_next_ordinal::text;
      update public.fixed_five_rooms
        set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
            deadline_cursor = v_next_cursor,
            deadline_participant = case when v_room.deadline_participant = 'p1' then 'p2' else 'p1' end,
            deadline_pick_ordinal = v_next_ordinal,
            deadline_at = now() + v_step,
            deadline_fallback = null
        where id = p_room_id;
    end if;
  elsif v_kind = 'start' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'drafting',
          deadline_cursor = 't0',
          deadline_participant = case
            when v_is_sandbox_snake then public.fixed_five_sandbox_picker(v_room.root_seed, 0)
            else 'p1'
          end,
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
  v_next_ordinal integer;
  v_step interval;
  v_is_sandbox_snake boolean;
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
  v_is_sandbox_snake :=
    v_room.versions->>'multiplayerVersion' = 'fixed-five-multiplayer-v3'
    and (
      v_room.mode = 'sandbox-shared-82'
      or (v_room.mode = 'duel' and v_room.source_mode = 'sandbox')
    );
  v_next_ordinal := v_room.deadline_pick_ordinal + 1;
  v_next_cursor := 't' || v_next_ordinal::text;
  v_ordinal := v_room.command_count;
  insert into public.fixed_five_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
    values (p_room_id, v_command_id, v_ordinal, v_room.deadline_participant, v_commitment.payload);
  if v_is_sandbox_snake and v_next_ordinal >= 10 then
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = null,
          deadline_pick_ordinal = v_next_ordinal,
          deadline_at = null,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_is_sandbox_snake then
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = public.fixed_five_sandbox_picker(v_room.root_seed, v_next_ordinal),
          deadline_pick_ordinal = v_next_ordinal,
          deadline_at = now() + v_step,
          deadline_fallback = null
      where id = p_room_id;
  else
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = case when v_room.deadline_participant = 'p1' then 'p2' else 'p1' end,
          deadline_pick_ordinal = v_next_ordinal,
          deadline_at = now() + v_step,
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

revoke all on function public.fixed_five_timeout_apply(uuid) from public;
revoke all on function public.fixed_five_timeout_apply(uuid) from anon;
revoke all on function public.fixed_five_timeout_apply(uuid) from authenticated;
grant execute on function public.fixed_five_timeout_apply(uuid) to service_role;
