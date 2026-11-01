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
    'deadline', r.deadline,
    'resultDigest', r.result_digest,
    'confirmedDigest', r.confirmed_digest,
    'successorRoomId', r.successor_room_id,
    'expiresAt', to_char(r.expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(r.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end $$;

