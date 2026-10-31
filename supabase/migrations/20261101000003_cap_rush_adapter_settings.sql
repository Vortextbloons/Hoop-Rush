-- The lobby passes the match-settings shape ({ gameKind, variant, versions }).
-- The room snapshot expects the room-settings shape ({ schemaVersion, variant, versionLocks }).
-- Wrap the lobby settings before creating the room so clients can parse the snapshot.

create or replace function multiplayer_private.cap_rush_adapter(
  p_operation text,
  p_room_id uuid,
  p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_code text; v_created jsonb;
begin
  case p_operation
    when 'status' then
      select jsonb_build_object('phase', phase, 'expires_at', expires_at, 'code', code)
        into v_result from public.cap_rush_multiplayer_rooms where id = p_room_id;
    when 'lookup' then
      select jsonb_build_object('room_id', id) into v_result
        from public.cap_rush_multiplayer_rooms
        where code = p_payload->>'code' and code_active and code_expires_at > now() limit 1;
    when 'join' then
      v_result := public.cap_rush_multiplayer_room_join(p_payload->>'code');
      v_result := v_result || jsonb_build_object('room_id', v_result->>'roomId');
    when 'preview' then
      select jsonb_build_object('room_id', id) into v_result
        from public.cap_rush_multiplayer_rooms
        where code = p_payload->>'code' and code_active and code_expires_at > now() limit 1;
    when 'create' then
      v_created := public.cap_rush_multiplayer_room_create(
        coalesce(p_payload->>'variant', 'clash'),
        jsonb_build_object(
          'schemaVersion', 1,
          'variant', coalesce(p_payload->>'variant', 'clash'),
          'versionLocks', coalesce(p_payload->'versions', '{}'::jsonb)
        ));
      v_result := jsonb_build_object('room_id', v_created->>'roomId', 'code', v_created->>'code');
    when 'seat-guest' then
      if p_payload->>'uid' is not null then
        insert into public.cap_rush_multiplayer_room_members(room_id, uid, participant_id, display_name)
          values(p_room_id, (p_payload->>'uid')::uuid, 'p2', 'Guest')
          on conflict (room_id, participant_id) do nothing;
      end if;
      update public.cap_rush_multiplayer_rooms set revision = revision + 1, updated_at = now()
        where id = p_room_id;
    when 'transfer-guest' then
      if p_payload->>'uid' is not null then
        insert into public.cap_rush_multiplayer_room_members(room_id, uid, participant_id, display_name)
          values(p_room_id, (p_payload->>'uid')::uuid, 'p2', 'Guest')
          on conflict (room_id, participant_id) do update set uid = excluded.uid;
      end if;
    when 'set-invitation' then
      update public.cap_rush_multiplayer_rooms
        set code = p_payload->>'code', code_expires_at = (p_payload->>'expiresAt')::timestamptz
        where id = p_room_id;
    when 'deactivate' then
      update public.cap_rush_multiplayer_rooms set code_active = false where id = p_room_id;
    when 'remove-guest' then
      delete from public.cap_rush_multiplayer_room_members
        where room_id = p_room_id and participant_id = 'p2';
      select code into v_code from public.cap_rush_multiplayer_rooms where id = p_room_id;
      update public.cap_rush_multiplayer_rooms set revision = revision + 1, updated_at = now()
        where id = p_room_id;
      v_result := jsonb_build_object('code', v_code);
    else raise exception 'invalid-operation';
  end case;
  return v_result;
end $$;

notify pgrst, 'reload schema';
