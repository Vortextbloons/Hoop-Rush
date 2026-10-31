-- Normalize room snapshot timestamps to UTC ISO-8601 with a Z suffix.
-- PostgREST serializes timestamptz values with an offset; the client snapshot
-- schema requires the Z form.

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
        'ready', coalesce((r.state->'ready'->>'p2')::boolean, false),
        'lastSeenAt', to_char((select m.last_seen_at from public.cap_rush_multiplayer_room_members m
          where m.room_id = r.id and m.participant_id = 'p2') at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ),
    'rootSeed', r.root_seed,
    'state', r.state,
    'deadline', r.deadline,
    'resultDigest', r.result_digest,
    'confirmedDigest', r.confirmed_digest,
    'successorRoomId', r.successor_room_id,
    'expiresAt', to_char(r.expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  from public.cap_rush_multiplayer_rooms r
  where r.id = p_room_id;
$$;

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
