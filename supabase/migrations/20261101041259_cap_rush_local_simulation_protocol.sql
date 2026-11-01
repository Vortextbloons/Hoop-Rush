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
  v_state jsonb;
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
  if p_payload->>'kind' in ('simulate-range', 'simulate-playoff-step') and v_member.participant_id <> 'p1' then raise exception 'not-host'; end if;
  v_state := case
    when p_state->>'_localSimulation' = 'true' then p_state
    when p_payload->>'kind' in ('accept-slot', 'ack-slot', 'choose-block-plan', 'ack-broadcast')
      then coalesce(v_room.state, '{}'::jsonb) || coalesce(p_state, '{}'::jsonb)
    else coalesce(p_state, v_room.state)
  end;
  if coalesce(p_state->>'_localSimulation', 'false') <> 'true' and p_payload->>'kind' in ('accept-slot', 'ack-slot', 'choose-block-plan', 'ack-broadcast')
    and jsonb_typeof(p_state->'season') = 'object'
    and not (p_state->'season' ? 'games') then
    v_state := jsonb_set(v_state, '{season}',
      coalesce(v_room.state->'season', '{}'::jsonb) || (p_state->'season') ||
      jsonb_build_object('games', coalesce(v_room.state->'season'->'games', '[]'::jsonb) ||
        case when p_payload->>'kind' = 'accept-slot' then coalesce(p_payload->'games', '[]'::jsonb) else '[]'::jsonb end));
  end if;
  update public.cap_rush_multiplayer_rooms
    set state = v_state,
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

create or replace function public.cap_rush_multiplayer_room_json(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.cap_rush_multiplayer_rooms%rowtype;
  v_state jsonb;
begin
  select * into r from public.cap_rush_multiplayer_rooms where id = p_room_id;
  if not found then return null; end if;
  v_state := r.state;
  return jsonb_build_object(
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
        'ready', coalesce((v_state->'ready'->>'p1')::boolean, false),
        'lastSeenAt', to_char((select m.last_seen_at from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p1') at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      jsonb_build_object(
        'participantId', 'p2',
        'displayName', coalesce((select m.display_name from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2'), 'Guest'),
        'online', coalesce((select m.online from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2'), false),
        'ready', coalesce((v_state->'ready'->>'p2')::boolean, false),
        'lastSeenAt', to_char((select m.last_seen_at from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2') at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ),
    'rootSeed', r.root_seed,
    'state', v_state,
    'stateDigest', r.state_digest,
    'deadline', r.deadline,
    'resultDigest', r.result_digest,
    'confirmedDigest', r.confirmed_digest,
    'successorRoomId', r.successor_room_id,
    'expiresAt', to_char(r.expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end $$;


create or replace function public.cap_rush_multiplayer_room_sync(
  p_room_id uuid,
  p_after_ordinal integer default -1
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  if not exists(select 1 from public.cap_rush_multiplayer_rooms where id = p_room_id) then
    raise exception 'invalid-room';
  end if;
  return jsonb_build_object(
    'room', public.cap_rush_multiplayer_room_json(p_room_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', m.participant_id,
        'display_name', m.display_name,
        'online', m.online,
        'ready', false,
        'last_seen_at', to_char(m.last_seen_at at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by m.participant_id)
      from public.cap_rush_multiplayer_room_members m where m.room_id = p_room_id
    ), '[]'::jsonb),
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'command_id', c.command_id,
        'ordinal', c.ordinal,
        'actor_participant_id', c.actor_participant_id,
        'accepted_at', to_char(c.accepted_at at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'payload', c.payload
      ) order by c.ordinal)
      from public.cap_rush_multiplayer_room_commands c
      where c.room_id = p_room_id and c.ordinal > p_after_ordinal
    ), '[]'::jsonb)
  );
end $$;

notify pgrst, 'reload schema';
