create or replace function public.cap_rush_multiplayer_room_json(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.cap_rush_multiplayer_rooms%rowtype;
  v_state jsonb;
begin
  select * into r from public.cap_rush_multiplayer_rooms where id = p_room_id;
  if not found then return null; end if;
  v_state := case when r.settings->'versionLocks'->>'multiplayerVersion' is not null and r.settings->'versionLocks'->>'multiplayerVersion' <> 'cap-rush-multiplayer-v2' then null else r.state end;
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
  if exists(select 1 from public.cap_rush_multiplayer_rooms where id = p_room_id
    and settings->'versionLocks'->>'multiplayerVersion' is not null
    and settings->'versionLocks'->>'multiplayerVersion' <> 'cap-rush-multiplayer-v2') then
    return jsonb_build_object('room', public.cap_rush_multiplayer_room_json(p_room_id), 'members', '[]'::jsonb, 'commands', '[]'::jsonb);
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
