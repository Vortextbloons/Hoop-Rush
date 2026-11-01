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
  if octet_length(coalesce(p_payload::text, '')) > 1048576 then raise exception 'payload-too-large'; end if;
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
    set state = case
          when p_payload->>'kind' in ('accept-slot', 'ack-slot', 'choose-block-plan', 'ack-broadcast')
            then coalesce(state, '{}'::jsonb) || coalesce(p_state, '{}'::jsonb)
          else coalesce(p_state, state)
        end,
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
