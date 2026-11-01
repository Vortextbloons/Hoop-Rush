create or replace function public.cap_rush_multiplayer_room_sync(
  p_room_id uuid,
  p_after_ordinal integer default -1
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room jsonb;
  v_incremental boolean := p_after_ordinal < -1;
begin
  if not public.cap_rush_multiplayer_is_member(p_room_id) then raise exception 'membership'; end if;
  if not exists(select 1 from public.cap_rush_multiplayer_rooms where id = p_room_id) then
    raise exception 'invalid-room';
  end if;
  v_room := public.cap_rush_multiplayer_room_json(p_room_id);
  if v_incremental then
    p_after_ordinal := -p_after_ordinal - 2;
    v_room := jsonb_set(v_room, '{state}', (v_room->'state') - 'locked' - 'recruitment');
    if jsonb_typeof(v_room->'state'->'season') = 'object' then
      v_room := v_room #- '{state,season,games}';
    end if;
  end if;
  return jsonb_build_object(
    'incremental', v_incremental,
    'room', v_room,
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
