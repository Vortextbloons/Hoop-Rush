create table public.multiplayer_lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}$'),
  host_uid uuid not null,
  guest_uid uuid,
  game_kind text check (game_kind in ('fixed-five', 'draft-duel')),
  game_room_id uuid,
  revision integer not null default 0,
  expires_at timestamptz not null default now() + interval '24 hours',
  check (guest_uid is null or guest_uid <> host_uid),
  check ((game_kind is null) = (game_room_id is null))
);
alter table public.multiplayer_lobbies enable row level security;
revoke all on public.multiplayer_lobbies from anon, authenticated;
grant select on public.multiplayer_lobbies to authenticated;
create policy "lobby members read their lobby" on public.multiplayer_lobbies
  for select to authenticated
  using ((select auth.uid()) in (host_uid, guest_uid));

create or replace function public.fixed_five_random_code()
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text; v_i integer; v_bytes bytea; v_value integer;
begin
  perform pg_advisory_xact_lock(731904);
  for v_i in 1..10000 loop
    v_bytes := extensions.gen_random_bytes(2);
    v_value := get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1);
    if v_value >= 60000 then continue; end if;
    v_code := lpad((v_value % 10000)::text, 4, '0');
    if not exists (select 1 from public.fixed_five_rooms where code = v_code and code_active)
      and not exists (select 1 from public.draft_duel_rooms where code = v_code and code_active)
      and not exists (select 1 from public.multiplayer_lobbies where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'code capacity exhausted';
end $$;
create or replace function public.draft_duel_random_code()
returns text language sql security definer set search_path = '' as $$
  select public.fixed_five_random_code();
$$;
revoke all on function public.fixed_five_random_code() from public, anon, authenticated;
revoke all on function public.draft_duel_random_code() from public, anon, authenticated;

create function public.multiplayer_lobby_snapshot(p_lobby_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lobby public.multiplayer_lobbies%rowtype; v_phase text; v_expiry timestamptz;
begin
  select * into v_lobby from public.multiplayer_lobbies where id = p_lobby_id;
  if auth.uid() is null or not found or
    (auth.uid() <> v_lobby.host_uid and auth.uid() is distinct from v_lobby.guest_uid) then
    raise exception 'membership';
  end if;
  if v_lobby.expires_at <= now() then raise exception 'code-expired'; end if;
  if v_lobby.game_kind = 'fixed-five' then
    select phase, expires_at into v_phase, v_expiry from public.fixed_five_rooms where id = v_lobby.game_room_id;
  elsif v_lobby.game_kind = 'draft-duel' then
    select phase, expires_at into v_phase, v_expiry from public.draft_duel_rooms where id = v_lobby.game_room_id;
  end if;
  return jsonb_build_object(
    'id', v_lobby.id, 'code', v_lobby.code, 'revision', v_lobby.revision,
    'participantId', case when auth.uid() = v_lobby.host_uid then 'p1' else 'p2' end,
    'guestJoined', v_lobby.guest_uid is not null,
    'gameKind', v_lobby.game_kind, 'gameRoomId', v_lobby.game_room_id,
    'canStart', v_phase is null or v_phase in ('completed', 'championship', 'integrity-failed', 'expired') or v_expiry <= now()
  );
end $$;
revoke all on function public.multiplayer_lobby_snapshot(uuid) from public, anon, authenticated;

create function public.multiplayer_lobby_command(p_command jsonb)
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
    if v_count >= 30 then raise exception 'rate-limit'; end if;
    insert into public.fixed_five_join_attempts(uid, code) values (auth.uid(), coalesce(v_code, v_kind));
  end if;
  if v_kind = 'create' then
    delete from public.multiplayer_lobbies where expires_at <= now();
    select count(*) into v_count from public.multiplayer_lobbies where host_uid = auth.uid();
    if v_count >= 5 then raise exception 'rate-limit'; end if;
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
      ) rooms;
      if v_count <> 1 then raise exception 'invalid-code'; end if;
      if exists(select 1 from public.fixed_five_rooms where code = v_code and code_active and code_expires_at > now()) then
        v_game_kind := 'fixed-five';
        if v_kind = 'join' then v_created := public.fixed_five_room_join(v_code);
        else v_created := public.fixed_five_room_preview(v_code); end if;
      else
        v_game_kind := 'draft-duel';
        if v_kind = 'join' then v_created := public.draft_duel_room_join(v_code);
        else v_created := public.draft_duel_room_preview(v_code); end if;
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
      update public.multiplayer_lobbies set guest_uid = auth.uid(), revision = revision + 1 where id = v_lobby.id;
      if v_lobby.game_kind = 'fixed-five' and exists(select 1 from public.fixed_five_rooms where id = v_lobby.game_room_id and phase = 'lobby') then
        insert into public.fixed_five_room_members(room_id, uid, participant_id) values(v_lobby.game_room_id, auth.uid(), 'p2');
      elsif v_lobby.game_kind = 'draft-duel' and exists(select 1 from public.draft_duel_rooms where id = v_lobby.game_room_id and phase = 'lobby') then
        insert into public.draft_duel_room_members(room_id, uid, participant_id) values(v_lobby.game_room_id, auth.uid(), 'p2');
      end if;
      if v_lobby.game_kind = 'fixed-five' then
        update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_lobby.game_room_id;
      elsif v_lobby.game_kind = 'draft-duel' then
        update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = v_lobby.game_room_id;
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
  else raise exception 'invalid-mode'; end if;
  v_room_id := (v_created->>'room_id')::uuid;
  update public.fixed_five_rooms set code_active = false where id = v_lobby.game_room_id;
  update public.draft_duel_rooms set code_active = false where id = v_lobby.game_room_id;
  if v_game_kind = 'fixed-five' then
    update public.fixed_five_rooms set code = v_lobby.code, code_expires_at = v_lobby.expires_at where id = v_room_id;
    if v_lobby.guest_uid is not null then
      insert into public.fixed_five_room_members(room_id, uid, participant_id) values(v_room_id, v_lobby.guest_uid, 'p2');
    end if;
  else
    update public.draft_duel_rooms set code = v_lobby.code, code_expires_at = v_lobby.expires_at where id = v_room_id;
    if v_lobby.guest_uid is not null then
      insert into public.draft_duel_room_members(room_id, uid, participant_id) values(v_room_id, v_lobby.guest_uid, 'p2');
    end if;
  end if;
  update public.multiplayer_lobbies set game_kind = v_game_kind, game_room_id = v_room_id,
    revision = revision + 1 where id = v_lobby.id;
  return public.multiplayer_lobby_snapshot(v_lobby.id);
end $$;
revoke all on function public.multiplayer_lobby_command(jsonb) from public, anon;
grant execute on function public.multiplayer_lobby_command(jsonb) to authenticated;
