-- M2.8: cross-client timeout autopicks + terminal phase RPCs.
-- Clients derive drafting/simulating/awaiting phases purely from the accepted
-- command log; the server only gates terminal transitions, verified from the log.
-- (Already applied to the live project via migration fixed_five_phase_completion.)

-- 1. Allow either member to submit a timeout-autopick for the timed-out seat.
--    All other kinds still require actor == caller seat.
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
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'payload-too-large');
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
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_kind <> 'timeout-autopick' and v_member.participant_id <> p_actor then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  if v_kind = 'timeout-autopick' and p_actor not in ('p1', 'p2') then
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

-- 2. Complete a room once the log holds a matching propose + verified confirm.
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
  if not exists (select 1 from public.fixed_five_room_commands
    where room_id = p_room_id and payload->>'kind' = 'propose-result'
      and payload->>'resultDigest' = p_result_digest) then
    return jsonb_build_object('completed', false, 'rejection_code', 'not-ready');
  end if;
  if not exists (select 1 from public.fixed_five_room_commands
    where room_id = p_room_id and payload->>'kind' = 'confirm-result'
      and payload->>'verified' = 'true'
      and payload->>'resultDigest' = p_result_digest) then
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

-- 3. Mark integrity failure once the log proves disagreement after rerun:
--    two distinct proposed digests plus a non-verifying confirmation.
create or replace function public.fixed_five_fail(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_digests integer;
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
  select count(distinct payload->>'resultDigest') into v_digests from public.fixed_five_room_commands
    where room_id = p_room_id and payload->>'kind' = 'propose-result';
  if v_digests < 2 then
    return jsonb_build_object('failed', false, 'rejection_code', 'not-ready');
  end if;
  if not exists (select 1 from public.fixed_five_room_commands
    where room_id = p_room_id and payload->>'kind' = 'confirm-result'
      and payload->>'verified' = 'false') then
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
