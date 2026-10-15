create schema if not exists multiplayer_private;
revoke all on schema multiplayer_private from public, anon, authenticated;
alter default privileges in schema multiplayer_private revoke execute on functions from public;

create function multiplayer_private.require_actor(p_sqlstate text default '28000')
returns void language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'anonymous session required' using errcode = p_sqlstate; end if;
end $$;

create function multiplayer_private.validate_code(p_code text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then raise exception 'invalid-code' using errcode = 'P0001'; end if;
end $$;

create function multiplayer_private.record_attempt(p_kind text, p_code text, p_limit integer, p_inclusive boolean)
returns void language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  case p_kind
    when 'fixed-five' then select count(*) into v_count from public.fixed_five_join_attempts where uid = auth.uid() and created_at > now() - interval '1 minute';
    when 'draft-duel' then select count(*) into v_count from public.draft_duel_join_attempts where uid = auth.uid() and created_at > now() - interval '1 minute';
    when 'havoc' then select count(*) into v_count from public.havoc_multiplayer_join_attempts where uid = auth.uid() and created_at > now() - interval '1 minute';
    else raise exception 'invalid-mode';
  end case;
  if v_count > p_limit or (p_inclusive and v_count = p_limit) then raise exception 'rate-limit'; end if;
  case p_kind
    when 'fixed-five' then insert into public.fixed_five_join_attempts(uid, code) values(auth.uid(), p_code);
    when 'draft-duel' then insert into public.draft_duel_join_attempts(uid, code) values(auth.uid(), p_code);
    when 'havoc' then insert into public.havoc_multiplayer_join_attempts(uid, code) values(auth.uid(), p_code);
  end case;
end $$;


create function multiplayer_private.allocate_code()
returns text language plpgsql security invoker set search_path = '' as $$
declare v_code text; v_bytes bytea; v_value integer;
begin
  perform pg_advisory_xact_lock(731904);
  for v_i in 1..10000 loop
    v_bytes := extensions.gen_random_bytes(2);
    v_value := get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1);
    if v_value >= 60000 then continue; end if;
    v_code := lpad((v_value % 10000)::text, 4, '0');
    if not exists (select 1 from public.fixed_five_rooms where code = v_code and code_active)
      and not exists (select 1 from public.draft_duel_rooms where code = v_code and code_active)
      and not exists (select 1 from public.havoc_multiplayer_rooms where code = v_code and code_active)
      and not exists (select 1 from public.multiplayer_lobbies where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'code capacity exhausted';
end $$;

create or replace function public.fixed_five_random_code() returns text language sql security definer set search_path = '' as $$ select multiplayer_private.allocate_code(); $$;

create function multiplayer_private.fixed_five_adapter(p_operation text, p_room_id uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare v_result jsonb; v_code text;
begin
  case p_operation
    when 'status' then
      select jsonb_build_object('phase', phase, 'expires_at', expires_at, 'code', code) into v_result from public.fixed_five_rooms where id = p_room_id;
    when 'lookup' then
      select jsonb_build_object('room_id', id) into v_result from public.fixed_five_rooms where code = p_payload->>'code' and code_active and code_expires_at > now() limit 1;
    when 'join' then v_result := public.fixed_five_room_join(p_payload->>'code');
    when 'preview' then v_result := public.fixed_five_room_preview(p_payload->>'code');
    when 'create' then v_result := public.fixed_five_room_create(p_payload->>'mode', p_payload->>'sourceMode', p_payload->>'variant', p_payload->'versions');
    when 'seat-guest' then
      if exists(select 1 from public.fixed_five_rooms where id = p_room_id and phase = 'lobby') then
        insert into public.fixed_five_room_members(room_id, uid, participant_id) values(p_room_id, (p_payload->>'uid')::uuid, 'p2');
      end if;
      update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
    when 'transfer-guest' then
      if p_payload->>'uid' is not null then
        insert into public.fixed_five_room_members(room_id, uid, participant_id) values(p_room_id, (p_payload->>'uid')::uuid, 'p2');
      end if;
    when 'set-invitation' then
      update public.fixed_five_rooms set code = p_payload->>'code', code_expires_at = (p_payload->>'expiresAt')::timestamptz where id = p_room_id;
    when 'deactivate' then update public.fixed_five_rooms set code_active = false where id = p_room_id;
    when 'remove-guest' then
      v_result := public.fixed_five_guest_remove(p_room_id, 'p2');
      if v_result->>'accepted' is distinct from 'true' then raise exception 'game-in-progress'; end if;
      select code into v_code from public.fixed_five_rooms where id = p_room_id;
      v_result := jsonb_build_object('code', v_code);
    else raise exception 'invalid-operation';
  end case;
  return v_result;
end $$;


create function multiplayer_private.draft_duel_adapter(p_operation text, p_room_id uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare v_result jsonb; v_code text;
begin
  case p_operation
    when 'status' then
      select jsonb_build_object('phase', phase, 'expires_at', expires_at, 'code', code) into v_result from public.draft_duel_rooms where id = p_room_id;
    when 'lookup' then
      select jsonb_build_object('room_id', id) into v_result from public.draft_duel_rooms where code = p_payload->>'code' and code_active and code_expires_at > now() limit 1;
    when 'join' then v_result := public.draft_duel_room_join(p_payload->>'code');
    when 'preview' then v_result := public.draft_duel_room_preview(p_payload->>'code');
    when 'create' then v_result := public.draft_duel_room_create(p_payload->>'fairness', p_payload->>'variant', p_payload->'versions');
    when 'seat-guest' then
      if exists(select 1 from public.draft_duel_rooms where id = p_room_id and phase = 'lobby') then
        insert into public.draft_duel_room_members(room_id, uid, participant_id) values(p_room_id, (p_payload->>'uid')::uuid, 'p2');
      end if;
      update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
    when 'transfer-guest' then
      if p_payload->>'uid' is not null then
        insert into public.draft_duel_room_members(room_id, uid, participant_id) values(p_room_id, (p_payload->>'uid')::uuid, 'p2');
      end if;
    when 'set-invitation' then
      update public.draft_duel_rooms set code = p_payload->>'code', code_expires_at = (p_payload->>'expiresAt')::timestamptz where id = p_room_id;
    when 'deactivate' then update public.draft_duel_rooms set code_active = false where id = p_room_id;
    when 'remove-guest' then
      v_result := public.draft_duel_command_submit(p_room_id, gen_random_uuid()::text, null, jsonb_build_object('kind', 'remove-guest', 'targetParticipantId', 'p2'));
      if v_result->>'accepted' is distinct from 'true' then raise exception 'game-in-progress'; end if;
      select code into v_code from public.draft_duel_rooms where id = p_room_id;
      v_result := jsonb_build_object('code', v_code);
    else raise exception 'invalid-operation';
  end case;
  return v_result;
end $$;


create function multiplayer_private.havoc_multiplayer_adapter(p_operation text, p_room_id uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare v_result jsonb; v_code text;
begin
  case p_operation
    when 'status' then
      select jsonb_build_object('phase', phase, 'expires_at', expires_at, 'code', code) into v_result from public.havoc_multiplayer_rooms where id = p_room_id;
    when 'lookup' then
      select jsonb_build_object('room_id', id) into v_result from public.havoc_multiplayer_rooms where code = p_payload->>'code' and code_active and code_expires_at > now() limit 1;
    when 'join' then v_result := public.havoc_multiplayer_room_join(p_payload->>'code');
    when 'preview' then v_result := public.havoc_multiplayer_room_preview(p_payload->>'code');
    when 'create' then v_result := public.havoc_multiplayer_room_create(p_payload->'versions', coalesce(p_payload->>'variant', 'standard'));
    when 'seat-guest' then
      if exists(select 1 from public.havoc_multiplayer_rooms where id = p_room_id and phase = 'lobby') then
        insert into public.havoc_multiplayer_room_members(room_id, uid, participant_id) values(p_room_id, (p_payload->>'uid')::uuid, 'p2');
      end if;
      update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = p_room_id;
    when 'transfer-guest' then
      if p_payload->>'uid' is not null then
        insert into public.havoc_multiplayer_room_members(room_id, uid, participant_id) values(p_room_id, (p_payload->>'uid')::uuid, 'p2');
      end if;
    when 'set-invitation' then
      update public.havoc_multiplayer_rooms set code = p_payload->>'code', code_expires_at = (p_payload->>'expiresAt')::timestamptz where id = p_room_id;
    when 'deactivate' then update public.havoc_multiplayer_rooms set code_active = false where id = p_room_id;
    when 'remove-guest' then
      v_result := public.havoc_multiplayer_command_submit(p_room_id, gen_random_uuid()::text, null, jsonb_build_object('kind', 'remove-guest', 'targetParticipantId', 'p2'));
      if v_result->>'accepted' is distinct from 'true' then raise exception 'game-in-progress'; end if;
      select code into v_code from public.havoc_multiplayer_rooms where id = p_room_id;
      v_result := jsonb_build_object('code', v_code);
    else raise exception 'invalid-operation';
  end case;
  return v_result;
end $$;


create function multiplayer_private.dispatch(p_kind text, p_operation text, p_room_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if p_operation is null or p_operation not in ('status', 'lookup', 'join', 'preview', 'create', 'seat-guest', 'transfer-guest', 'set-invitation', 'deactivate', 'remove-guest') then raise exception 'invalid-operation'; end if;
  if p_kind is null and p_operation in ('status', 'seat-guest', 'deactivate') then return null; end if;
  case p_kind
    when 'fixed-five' then return multiplayer_private.fixed_five_adapter(p_operation, p_room_id, p_payload);
    when 'draft-duel' then return multiplayer_private.draft_duel_adapter(p_operation, p_room_id, p_payload);
    when 'havoc' then return multiplayer_private.havoc_multiplayer_adapter(p_operation, p_room_id, p_payload);
    else raise exception 'invalid-mode';
  end case;
end $$;


create or replace function public.fixed_five_room_create(p_mode text, p_source_mode text, p_variant text, p_versions jsonb)
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
  v_deadline timestamptz;
begin
  if p_mode not in ('classic-shared-82', 'sandbox-shared-82', 'duel') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_source_mode not in ('classic', 'sandbox') then
    raise exception 'invalid source mode' using errcode = '22023';
  end if;
  if p_variant not in ('ratings', 'ball-knowledge') then
    raise exception 'invalid variant' using errcode = '22023';
  end if;
  if not public.fixed_five_versions_valid(p_versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  perform multiplayer_private.require_actor();
  perform multiplayer_private.record_attempt('fixed-five', 'create', 60, false);
  select count(*) into v_recent from public.fixed_five_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.fixed_five_room_members where uid = auth.uid());
  if v_recent >= 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  if p_mode = 'sandbox-shared-82' then
    v_deadline := now() + interval '5 minutes';
  else
    v_deadline := now() + interval '90 seconds';
  end if;
  loop
    v_code := public.fixed_five_random_code();
    begin
      insert into public.fixed_five_rooms (mode, source_mode, variant, versions, root_seed, code, code_active, code_expires_at, phase, deadline_at, deadline_cursor, deadline_participant, deadline_pick_ordinal)
        values (p_mode, p_source_mode, p_variant, p_versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby', v_deadline, 'lobby', 'p1', 0)
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_room_id, auth.uid(), 'p1');
  return jsonb_build_object('room_id', v_room_id, 'code', v_code);
end;
$$;

create or replace function public.fixed_five_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
begin
  perform multiplayer_private.validate_code(p_code);
  perform multiplayer_private.require_actor();
  perform multiplayer_private.record_attempt('fixed-five', p_code, 60, false);
  select * into v_room from public.fixed_five_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'room_id', v_room.id, 'mode', v_room.mode, 'source_mode', v_room.source_mode,
    'variant', v_room.variant, 'phase', v_room.phase, 'revision', v_room.revision,
    'versions', v_room.versions);
end;
$$;

create or replace function public.fixed_five_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_count integer;
  v_seat text;
  v_inserted integer;
begin
  perform multiplayer_private.validate_code(p_code);
  perform multiplayer_private.require_actor();
  select * into v_room from public.fixed_five_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select participant_id into v_seat from public.fixed_five_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if found then
    update public.fixed_five_room_members set online = true, last_seen_at = now()
      where room_id = v_room.id and uid = auth.uid();
    update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
    return jsonb_build_object('room_id', v_room.id, 'participant_id', v_seat);
  end if;
  select count(*) into v_count from public.fixed_five_room_members where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  insert into public.fixed_five_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do nothing;
  get diagnostics v_inserted = row_count;
  select participant_id into v_seat from public.fixed_five_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if not found or v_seat <> 'p2' then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  if v_inserted > 0 then
    update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;

create or replace function public.draft_duel_room_create(
  p_fairness text, p_presentation text, p_versions jsonb)
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
  if p_fairness not in ('fair', 'unfair') then
    raise exception 'invalid fairness' using errcode = '22023';
  end if;
  if p_presentation not in ('ratings', 'ball-knowledge') then
    raise exception 'invalid presentation' using errcode = '22023';
  end if;
  if not public.draft_duel_versions_valid(p_versions) then
    raise exception 'invalid versions' using errcode = '22023';
  end if;
  perform multiplayer_private.require_actor();
  perform multiplayer_private.record_attempt('draft-duel', 'create', 60, false);
  select count(*) into v_recent from public.draft_duel_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.draft_duel_room_members where uid = auth.uid());
  if v_recent >= 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := public.draft_duel_random_code();
    begin
      insert into public.draft_duel_rooms (fairness, presentation, versions, root_seed, code, code_active, code_expires_at, phase)
        values (p_fairness, p_presentation, p_versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  insert into public.draft_duel_room_members (room_id, uid, participant_id)
    values (v_room_id, auth.uid(), 'p1');
  return jsonb_build_object('room_id', v_room_id, 'code', v_code);
end;
$$;

create or replace function public.draft_duel_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
begin
  perform multiplayer_private.validate_code(p_code);
  perform multiplayer_private.require_actor();
  perform multiplayer_private.record_attempt('draft-duel', p_code, 60, false);
  select * into v_room from public.draft_duel_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'room_id', v_room.id,
    'fairness', v_room.fairness,
    'presentation', v_room.presentation,
    'phase', v_room.phase,
    'revision', v_room.revision,
    'versions', v_room.versions,
    'expires_at', v_room.expires_at,
    'created_at', v_room.created_at);
end;
$$;

create or replace function public.draft_duel_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_count integer;
  v_seat text;
  v_inserted integer;
begin
  perform multiplayer_private.validate_code(p_code);
  perform multiplayer_private.require_actor();
  select * into v_room from public.draft_duel_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select participant_id into v_seat from public.draft_duel_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if found then
    update public.draft_duel_room_members set online = true, last_seen_at = now()
      where room_id = v_room.id and uid = auth.uid();
    update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
    return jsonb_build_object('room_id', v_room.id, 'participant_id', v_seat);
  end if;
  select count(*) into v_count from public.draft_duel_room_members where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  insert into public.draft_duel_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do nothing;
  get diagnostics v_inserted = row_count;
  select participant_id into v_seat from public.draft_duel_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if not found or v_seat <> 'p2' then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  if v_inserted > 0 then
    update public.draft_duel_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  insert into public.draft_duel_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;

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
  perform multiplayer_private.require_actor();
  perform multiplayer_private.record_attempt('havoc', 'create', 60, false);
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

create or replace function public.havoc_multiplayer_room_preview(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
begin
  perform multiplayer_private.validate_code(p_code);
  perform multiplayer_private.require_actor();
  perform multiplayer_private.record_attempt('havoc', p_code, 60, false);
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

create or replace function public.havoc_multiplayer_room_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.havoc_multiplayer_rooms%rowtype;
  v_count integer;
  v_seat text;
  v_inserted integer;
begin
  perform multiplayer_private.validate_code(p_code);
  perform multiplayer_private.require_actor();
  select * into v_room from public.havoc_multiplayer_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  select participant_id into v_seat from public.havoc_multiplayer_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if found then
    update public.havoc_multiplayer_room_members set online = true, last_seen_at = now()
      where room_id = v_room.id and uid = auth.uid();
    update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
    return jsonb_build_object('room_id', v_room.id, 'participant_id', v_seat);
  end if;
  select count(*) into v_count from public.havoc_multiplayer_room_members where room_id = v_room.id;
  if v_count >= 2 then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
    values (v_room.id, auth.uid(), 'p2')
    on conflict (room_id, participant_id) do nothing;
  get diagnostics v_inserted = row_count;
  select participant_id into v_seat from public.havoc_multiplayer_room_members
    where room_id = v_room.id and uid = auth.uid() limit 1;
  if not found or v_seat <> 'p2' then
    raise exception 'room-full' using errcode = 'P0001';
  end if;
  if v_inserted > 0 then
    update public.havoc_multiplayer_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  end if;
  insert into public.havoc_multiplayer_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;

create or replace function public.multiplayer_lobby_snapshot(p_lobby_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lobby public.multiplayer_lobbies%rowtype; v_phase text; v_expiry timestamptz; v_status jsonb;
begin
  select * into v_lobby from public.multiplayer_lobbies where id = p_lobby_id;
  if auth.uid() is null or not found or
    (auth.uid() <> v_lobby.host_uid and auth.uid() is distinct from v_lobby.guest_uid) then
    raise exception 'membership';
  end if;
  if v_lobby.expires_at <= now() then raise exception 'code-expired'; end if;
  v_status := multiplayer_private.dispatch(v_lobby.game_kind, 'status', v_lobby.game_room_id);
  v_phase := v_status->>'phase';
  v_expiry := (v_status->>'expires_at')::timestamptz;
  return jsonb_build_object(
    'id', v_lobby.id, 'code', v_lobby.code, 'revision', v_lobby.revision,
    'participantId', case when auth.uid() = v_lobby.host_uid then 'p1' else 'p2' end,
    'guestJoined', v_lobby.guest_uid is not null,
    'gameKind', v_lobby.game_kind, 'gameRoomId', v_lobby.game_room_id,
    'canStart', v_phase is null or v_phase in ('completed', 'championship', 'integrity-failed', 'expired') or v_expiry <= now()
  );
end $$;

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
      foreach v_candidate in array array['fixed-five', 'draft-duel', 'havoc'] loop
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
  perform multiplayer_private.dispatch(v_game_kind, 'set-invitation', v_room_id, jsonb_build_object('code', v_lobby.code, 'expiresAt', v_lobby.expires_at));
  perform multiplayer_private.dispatch(v_game_kind, 'transfer-guest', v_room_id, jsonb_build_object('uid', v_lobby.guest_uid));
  update public.multiplayer_lobbies set game_kind = v_game_kind, game_room_id = v_room_id,
    revision = revision + 1 where id = v_lobby.id;
  return public.multiplayer_lobby_snapshot(v_lobby.id);
end $$;

revoke all on all functions in schema multiplayer_private from public, anon, authenticated;
notify pgrst, 'reload schema';

