create or replace function public.multiplayer_lobby_command(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := p_command->>'kind';
  v_lobby public.multiplayer_lobbies%rowtype;
  v_id uuid;
  v_created jsonb;
  v_settings jsonb := p_command->'settings';
  v_game_kind text;
  v_room_id uuid;
  v_code text := p_command->>'code';
  v_count integer;
  v_candidate text;
  v_status jsonb;
begin
  perform multiplayer_private.require_actor('P0001');
  if p_command is null or jsonb_typeof(p_command) <> 'object' then raise exception 'invalid-command'; end if;
  if octet_length(p_command::text) > 32768 then raise exception 'payload-too-large'; end if;
  if v_kind in ('create', 'join', 'preview') then
    perform multiplayer_private.record_attempt('fixed-five', coalesce(v_code, v_kind), 90, true);
  end if;
  if v_kind = 'create' then
    delete from public.multiplayer_lobbies where expires_at <= now();
    select count(*) into v_count from public.multiplayer_lobbies where host_uid = auth.uid();
    if v_count >= 20 then raise exception 'rate-limit'; end if;
    insert into public.multiplayer_lobbies(code, host_uid)
      values(public.fixed_five_random_code(), auth.uid()) returning id into v_id;
    return public.multiplayer_lobby_snapshot(v_id);
  elsif v_kind in ('join', 'preview') then
    perform multiplayer_private.validate_code(v_code);
    select * into v_lobby from public.multiplayer_lobbies where code = v_code for update;
    if not found then
      v_count := 0;
      foreach v_candidate in array array['fixed-five', 'draft-duel', 'havoc', 'cap-rush'] loop
        v_created := multiplayer_private.dispatch(v_candidate, 'lookup', null, jsonb_build_object('code', v_code));
        if v_created is not null then v_count := v_count + 1; v_game_kind := v_candidate; end if;
      end loop;
      if v_count <> 1 then raise exception 'invalid-code'; end if;
      v_created := multiplayer_private.dispatch(v_game_kind, v_kind, null, jsonb_build_object('code', v_code));
      return jsonb_build_object('legacy', true, 'gameKind', v_game_kind, 'gameRoomId', v_created->>'room_id');
    end if;
    if v_lobby.expires_at <= now() then raise exception 'code-expired'; end if;
    if v_kind = 'preview' then
      return jsonb_build_object('legacy', false, 'code', v_lobby.code, 'guestJoined', v_lobby.guest_uid is not null);
    end if;
    if auth.uid() <> v_lobby.host_uid and auth.uid() is distinct from v_lobby.guest_uid then
      if v_lobby.guest_uid is not null then raise exception 'room-full'; end if;
      v_status := multiplayer_private.dispatch(v_lobby.game_kind, 'status', v_lobby.game_room_id);
      if v_status->>'phase' not in ('lobby', 'completed', 'championship', 'integrity-failed', 'expired') then raise exception 'room-full'; end if;
      update public.multiplayer_lobbies set guest_uid = auth.uid(), revision = revision + 1 where id = v_lobby.id;
      perform multiplayer_private.dispatch(v_lobby.game_kind, 'seat-guest', v_lobby.game_room_id, jsonb_build_object('uid', auth.uid()));
    end if;
    return public.multiplayer_lobby_snapshot(v_lobby.id);
  end if;
  select * into v_lobby from public.multiplayer_lobbies where id = (p_command->>'lobbyId')::uuid for update;
  if not found then raise exception 'membership'; end if;
  v_created := public.multiplayer_lobby_snapshot(v_lobby.id);
  if v_kind = 'get' then return v_created; end if;
  if v_kind = 'leave' then
    if auth.uid() = v_lobby.host_uid then
      delete from public.multiplayer_lobbies where id = v_lobby.id;
    else
      update public.multiplayer_lobbies set guest_uid = null, revision = revision + 1 where id = v_lobby.id;
    end if;
    return jsonb_build_object('left', true);
  end if;
  if v_kind = 'remove-guest' then
    if auth.uid() <> v_lobby.host_uid then raise exception 'authorization'; end if;
    if v_lobby.game_kind is null then v_code := public.fixed_five_random_code();
    else
      v_created := multiplayer_private.dispatch(v_lobby.game_kind, 'remove-guest', v_lobby.game_room_id);
      v_code := v_created->>'code';
    end if;
    update public.multiplayer_lobbies set guest_uid = null, code = v_code, revision = revision + 1 where id = v_lobby.id;
    return public.multiplayer_lobby_snapshot(v_lobby.id);
  end if;
  if v_kind <> 'start' then raise exception 'invalid-command'; end if;
  if auth.uid() <> v_lobby.host_uid then raise exception 'authorization'; end if;
  if (p_command->>'expectedRevision')::integer is distinct from v_lobby.revision then raise exception 'stale-revision'; end if;
  if not (v_created->>'canStart')::boolean then raise exception 'game-in-progress'; end if;
  v_game_kind := v_settings->>'gameKind';
  v_created := multiplayer_private.dispatch(v_game_kind, 'create', null, v_settings);
  v_room_id := (v_created->>'room_id')::uuid;
  perform multiplayer_private.dispatch('fixed-five', 'deactivate', v_lobby.game_room_id);
  perform multiplayer_private.dispatch('draft-duel', 'deactivate', v_lobby.game_room_id);
  perform multiplayer_private.dispatch('havoc', 'deactivate', v_lobby.game_room_id);
  perform multiplayer_private.dispatch('cap-rush', 'deactivate', v_lobby.game_room_id);
  perform multiplayer_private.dispatch(v_game_kind, 'set-invitation', v_room_id, jsonb_build_object('code', v_lobby.code, 'expiresAt', v_lobby.expires_at));
  perform multiplayer_private.dispatch(v_game_kind, 'transfer-guest', v_room_id, jsonb_build_object('uid', v_lobby.guest_uid));
  update public.multiplayer_lobbies set game_kind = v_game_kind, game_room_id = v_room_id,
    revision = revision + 1 where id = v_lobby.id;
  return public.multiplayer_lobby_snapshot(v_lobby.id);
end $$;

notify pgrst, 'reload schema';
