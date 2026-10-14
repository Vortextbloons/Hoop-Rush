-- Curated Havoc variant.
--
-- New Havoc rooms choose a typed variant ('standard' | 'curated'). The variant
-- is retained across previews and rematches, and old rooms keep their stored
-- 'standard' default while replaying under their locked legacy rules version.
-- The client negotiates draft behavior; the database only stores and returns
-- the setting.

alter table public.havoc_multiplayer_rooms
  add column if not exists variant text not null default 'standard';
alter table public.havoc_multiplayer_rooms
  drop constraint if exists havoc_multiplayer_rooms_variant_check;
alter table public.havoc_multiplayer_rooms
  add constraint havoc_multiplayer_rooms_variant_check check (variant in ('standard', 'curated'));

insert into public.havoc_multiplayer_server_versions (key, value) values
  ('multiplayerVersion', 'havoc-multiplayer-v2')
on conflict (key) do update set value = excluded.value;

-- 1. Create room with the chosen variant. The two-argument signature replaces
--    the one-argument one; its default keeps single-argument calls working.
drop function if exists public.havoc_multiplayer_room_create(jsonb);
create or replace function public.havoc_multiplayer_room_create(
  p_versions jsonb,
  p_variant text default 'standard'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
  v_recent integer;
begin
  if p_variant is null or p_variant not in ('standard', 'curated') then
    raise exception 'invalid-variant' using errcode = '22023';
  end if;
  if not public.havoc_multiplayer_versions_valid(p_versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.havoc_multiplayer_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 60 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.havoc_multiplayer_join_attempts (uid, code) values (auth.uid(), 'create');
  select count(*) into v_recent from public.havoc_multiplayer_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.havoc_multiplayer_room_members where uid = auth.uid());
  if v_recent >= 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.havoc_multiplayer_random_code();
    begin
      insert into public.havoc_multiplayer_rooms (versions, variant, root_seed, code, code_active, code_expires_at, phase)
        values (p_versions, p_variant, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
    values (v_room_id, auth.uid(), 'p1');
  return jsonb_build_object('room_id', v_room_id, 'code', v_code);
end;
$$;
revoke all on function public.havoc_multiplayer_room_create(jsonb, text) from public, anon;
grant execute on function public.havoc_multiplayer_room_create(jsonb, text) to authenticated;

-- 2. Preview returns the variant so join previews can name the mode.
create or replace function public.havoc_multiplayer_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_recent integer;
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.havoc_multiplayer_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 60 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.havoc_multiplayer_join_attempts (uid, code) values (auth.uid(), p_code);
  select * into v_room from public.havoc_multiplayer_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'room_id', v_room.id,
    'phase', v_room.phase,
    'revision', v_room.revision,
    'versions', v_room.versions,
    'variant', v_room.variant,
    'expires_at', v_room.expires_at,
    'created_at', v_room.created_at);
end;
$$;
revoke all on function public.havoc_multiplayer_room_preview(text) from public, anon;
grant execute on function public.havoc_multiplayer_room_preview(text) to authenticated;

-- 3. Rematch copies the variant into the successor room.
create or replace function public.havoc_multiplayer_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_caller_seat text;
  v_new_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
  v_recent integer;
  v_existing_code text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.havoc_multiplayer_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  select participant_id into v_caller_seat from public.havoc_multiplayer_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase <> 'championship' then
    raise exception 'phase' using errcode = 'P0001';
  end if;
  if v_room.successor_room_id is not null then
    select code into v_existing_code from public.havoc_multiplayer_rooms
      where id = v_room.successor_room_id limit 1;
    if found then
      return jsonb_build_object('room_id', v_room.successor_room_id, 'code', v_existing_code);
    end if;
  end if;
  select count(*) into v_recent from public.havoc_multiplayer_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.havoc_multiplayer_room_members where uid = auth.uid());
  if v_recent >= 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  if not public.havoc_multiplayer_versions_valid(v_room.versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.havoc_multiplayer_random_code();
    begin
      insert into public.havoc_multiplayer_rooms (versions, variant, root_seed, code, code_active, code_expires_at, phase)
        values (v_room.versions, v_room.variant, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_new_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
    values (v_new_id, auth.uid(), v_caller_seat)
    on conflict (room_id, participant_id) do nothing;
  update public.havoc_multiplayer_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.havoc_multiplayer_rematch(uuid) from public, anon;
grant execute on function public.havoc_multiplayer_rematch(uuid) to authenticated;

-- 4. Lobby start passes the requested variant through to room creation.
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
begin
  if auth.uid() is null then raise exception 'anonymous session required'; end if;
  if p_command is null or jsonb_typeof(p_command) <> 'object' then raise exception 'invalid-command'; end if;
  if octet_length(p_command::text) > 32768 then raise exception 'payload-too-large'; end if;
  if v_kind in ('create', 'join', 'preview') then
    select count(*) into v_count from public.fixed_five_join_attempts
      where uid = auth.uid() and created_at > now() - interval '1 minute';
    if v_count >= 90 then raise exception 'rate-limit'; end if;
    insert into public.fixed_five_join_attempts(uid, code) values (auth.uid(), coalesce(v_code, v_kind));
  end if;
  if v_kind = 'create' then
    delete from public.multiplayer_lobbies where expires_at <= now();
    select count(*) into v_count from public.multiplayer_lobbies where host_uid = auth.uid();
    if v_count >= 20 then raise exception 'rate-limit'; end if;
    insert into public.multiplayer_lobbies(code, host_uid)
      values(public.fixed_five_random_code(), auth.uid()) returning id into v_id;
    return public.multiplayer_lobby_snapshot(v_id);
  elsif v_kind in ('join', 'preview') then
    if v_code is null or v_code !~ '^[0-9]{4}$' then raise exception 'invalid-code'; end if;
    select * into v_lobby from public.multiplayer_lobbies where code = v_code for update;
    if not found then
      select count(*) into v_count from (
        select id from public.fixed_five_rooms where code = v_code and code_active and code_expires_at > now()
        union all select id from public.draft_duel_rooms where code = v_code and code_active and code_expires_at > now()
        union all select id from public.havoc_multiplayer_rooms where code = v_code and code_active and code_expires_at > now()
      ) rooms;
      if v_count <> 1 then raise exception 'invalid-code'; end if;
      if exists(select 1 from public.fixed_five_rooms where code = v_code and code_active and code_expires_at > now()) then
        v_game_kind := 'fixed-five';
        if v_kind = 'join' then v_created := public.fixed_five_room_join(v_code);
        else v_created := public.fixed_five_room_preview(v_code); end if;
      elsif exists(select 1 from public.draft_duel_rooms where code = v_code and code_active and code_expires_at > now()) then
        v_game_kind := 'draft-duel';
        if v_kind = 'join' then v_created := public.draft_duel_room_join(v_code);
        else v_created := public.draft_duel_room_preview(v_code); end if;
      else
        v_game_kind := 'havoc';
        if v_kind = 'join' then v_created := public.havoc_multiplayer_room_join(v_code);
        else v_created := public.havoc_multiplayer_room_preview(v_code); end if;
      end if;
      return jsonb_build_object('legacy', true, 'gameKind', v_game_kind, 'gameRoomId', v_created->>'room_id');
    end if;
    if v_lobby.expires_at <= now() then raise exception 'code-expired'; end if;
    if v_kind = 'preview' then
      return jsonb_build_object('legacy', false, 'code', v_lobby.code, 'guestJoined', v_lobby.guest_uid is not null);
    end if;
    if auth.uid() <> v_lobby.host_uid and auth.uid() is distinct from v_lobby.guest_uid then
      if v_lobby.guest_uid is not null then raise exception 'room-full'; end if;
      if v_lobby.game_kind = 'fixed-five' and exists(select 1 from public.fixed_five_rooms where id = v_lobby.game_room_id and phase not in ('lobby', 'completed', 'championship', 'integrity-failed', 'expired')) then raise exception 'room-full'; end if;
      if v_lobby.game_kind = 'draft-duel' and exists(select 1 from public.draft_duel_rooms where id = v_lobby.game_room_id and phase not in ('lobby', 'completed', 'championship', 'integrity-failed', 'expired')) then raise exception 'room-full'; end if;
      if v_lobby.game_kind = 'havoc' and exists(select 1 from public.havoc_multiplayer_rooms where id = v_lobby.game_room_id and phase not in ('lobby', 'completed', 'championship', 'integrity-failed', 'expired')) then raise exception 'room-full'; end if;
      update public.multiplayer_lobbies set guest_uid = auth.uid(), revision = revision + 1 where id = v_lobby.id;
      if v_lobby.game_kind = 'fixed-five' and exists(select 1 from public.fixed_five_rooms where id = v_lobby.game_room_id and phase = 'lobby') then
        insert into public.fixed_five_room_members(room_id, uid, participant_id) values(v_lobby.game_room_id, auth.uid(), 'p2');
      elsif v_lobby.game_kind = 'draft-duel' and exists(select 1 from public.draft_duel_rooms where id = v_lobby.game_room_id and phase = 'lobby') then
        insert into public.draft_duel_room_members(room_id, uid, participant_id) values(v_lobby.game_room_id, auth.uid(), 'p2');
      elsif v_lobby.game_kind = 'havoc' and exists(select 1 from public.havoc_multiplayer_rooms where id = v_lobby.game_room_id and phase = 'lobby') then
        insert into public.havoc_multiplayer_room_members(room_id, uid, participant_id) values(v_lobby.game_room_id, auth.uid(), 'p2');
      end if;
      if v_lobby.game_kind = 'fixed-five' then
        update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_lobby.game_room_id;
      elsif v_lobby.game_kind = 'draft-duel' then
        update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = v_lobby.game_room_id;
      elsif v_lobby.game_kind = 'havoc' then
        update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = v_lobby.game_room_id;
      end if;
    end if;
    return public.multiplayer_lobby_snapshot(v_lobby.id);
  end if;
  select * into v_lobby from public.multiplayer_lobbies where id = (p_command->>'lobbyId')::uuid for update;
  if not found then raise exception 'membership'; end if;
  v_created := public.multiplayer_lobby_snapshot(v_lobby.id);
  if v_kind = 'get' then return v_created; end if;
  if v_kind = 'leave' then
    if not (v_created->>'canStart')::boolean then raise exception 'game-in-progress'; end if;
    if auth.uid() = v_lobby.host_uid then
      delete from public.multiplayer_lobbies where id = v_lobby.id;
    else
      update public.multiplayer_lobbies set guest_uid = null, revision = revision + 1 where id = v_lobby.id;
    end if;
    return jsonb_build_object('left', true);
  end if;
  if v_kind = 'remove-guest' then
    if auth.uid() <> v_lobby.host_uid then raise exception 'authorization'; end if;
    if v_lobby.game_kind = 'fixed-five' then
      v_created := public.fixed_five_guest_remove(v_lobby.game_room_id, 'p2');
      if v_created->>'accepted' is distinct from 'true' then raise exception 'game-in-progress'; end if;
      select code into v_code from public.fixed_five_rooms where id = v_lobby.game_room_id;
    elsif v_lobby.game_kind = 'draft-duel' then
      v_created := public.draft_duel_command_submit(v_lobby.game_room_id, gen_random_uuid()::text, null, jsonb_build_object('kind', 'remove-guest', 'targetParticipantId', 'p2'));
      if v_created->>'accepted' is distinct from 'true' then raise exception 'game-in-progress'; end if;
      select code into v_code from public.draft_duel_rooms where id = v_lobby.game_room_id;
    elsif v_lobby.game_kind = 'havoc' then
      v_created := public.havoc_multiplayer_command_submit(v_lobby.game_room_id, gen_random_uuid()::text, null, jsonb_build_object('kind', 'remove-guest', 'targetParticipantId', 'p2'));
      if v_created->>'accepted' is distinct from 'true' then raise exception 'game-in-progress'; end if;
      select code into v_code from public.havoc_multiplayer_rooms where id = v_lobby.game_room_id;
    else v_code := public.fixed_five_random_code(); end if;
    update public.multiplayer_lobbies set guest_uid = null, code = v_code, revision = revision + 1 where id = v_lobby.id;
    return public.multiplayer_lobby_snapshot(v_lobby.id);
  end if;
  if v_kind <> 'start' then raise exception 'invalid-command'; end if;
  if auth.uid() <> v_lobby.host_uid then raise exception 'authorization'; end if;
  if (p_command->>'expectedRevision')::integer is distinct from v_lobby.revision then raise exception 'stale-revision'; end if;
  if not (v_created->>'canStart')::boolean then raise exception 'game-in-progress'; end if;
  v_game_kind := v_settings->>'gameKind';
  if v_game_kind = 'fixed-five' then
    v_created := public.fixed_five_room_create(v_settings->>'mode', v_settings->>'sourceMode', v_settings->>'variant', v_settings->'versions');
  elsif v_game_kind = 'draft-duel' then
    v_created := public.draft_duel_room_create(v_settings->>'fairness', v_settings->>'variant', v_settings->'versions');
  elsif v_game_kind = 'havoc' then
    v_created := public.havoc_multiplayer_room_create(v_settings->'versions', coalesce(v_settings->>'variant', 'standard'));
  else raise exception 'invalid-mode'; end if;
  v_room_id := (v_created->>'room_id')::uuid;
  update public.fixed_five_rooms set code_active = false where id = v_lobby.game_room_id;
  update public.draft_duel_rooms set code_active = false where id = v_lobby.game_room_id;
  update public.havoc_multiplayer_rooms set code_active = false where id = v_lobby.game_room_id;
  if v_game_kind = 'fixed-five' then
    update public.fixed_five_rooms set code = v_lobby.code, code_expires_at = v_lobby.expires_at where id = v_room_id;
    if v_lobby.guest_uid is not null then
      insert into public.fixed_five_room_members(room_id, uid, participant_id) values(v_room_id, v_lobby.guest_uid, 'p2');
    end if;
  elsif v_game_kind = 'draft-duel' then
    update public.draft_duel_rooms set code = v_lobby.code, code_expires_at = v_lobby.expires_at where id = v_room_id;
    if v_lobby.guest_uid is not null then
      insert into public.draft_duel_room_members(room_id, uid, participant_id) values(v_room_id, v_lobby.guest_uid, 'p2');
    end if;
  else
    update public.havoc_multiplayer_rooms set code = v_lobby.code, code_expires_at = v_lobby.expires_at where id = v_room_id;
    if v_lobby.guest_uid is not null then
      insert into public.havoc_multiplayer_room_members(room_id, uid, participant_id) values(v_room_id, v_lobby.guest_uid, 'p2');
    end if;
  end if;
  update public.multiplayer_lobbies set game_kind = v_game_kind, game_room_id = v_room_id,
    revision = revision + 1 where id = v_lobby.id;
  return public.multiplayer_lobby_snapshot(v_lobby.id);
end $$;
revoke all on function public.multiplayer_lobby_command(jsonb) from public, anon;
grant execute on function public.multiplayer_lobby_command(jsonb) to authenticated;


notify pgrst, 'reload schema';
