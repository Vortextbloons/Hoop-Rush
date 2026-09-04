-- M2.8 fix: pgcrypto lives in the extensions schema on Supabase, not public.
-- The fixed-five functions run with an empty search_path, so the
-- unqualified/public call failed with "function public.gen_random_bytes does
-- not exist" at room creation (and rematch) time.
-- Also reloads the PostgREST schema cache so the RPCs resolve over REST.
-- (Already applied to the live project via migration
-- fixed_five_gen_random_bytes_schema.)

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
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select count(*) into v_recent from public.fixed_five_join_attempts
    where uid = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent > 10 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), 'create');
  select count(*) into v_recent from public.fixed_five_rooms
    where created_at > now() - interval '1 minute'
    and id in (select room_id from public.fixed_five_room_members where uid = auth.uid());
  if v_recent >= 3 then
    raise exception 'rate-limit' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  if p_mode = 'sandbox-shared-82' then
    v_deadline := now() + interval '5 minutes';
  else
    v_deadline := now() + interval '90 seconds';
  end if;
  loop
    v_code := lpad((floor(random() * 10000))::text, 4, '0');
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
revoke all on function public.fixed_five_room_create(text, text, text, jsonb) from public;
grant execute on function public.fixed_five_room_create(text, text, text, jsonb) to authenticated;

create or replace function public.fixed_five_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_new_id uuid;
  v_code text;
  v_seed text;
  v_tries integer := 0;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then raise exception 'authorization' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.fixed_five_room_members where room_id = p_room_id and uid = auth.uid()) then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_room.phase <> 'completed' then
    raise exception 'phase' using errcode = 'P0001';
  end if;
  v_seed := encode(extensions.gen_random_bytes(16), 'hex');
  loop
    v_code := lpad((floor(random() * 10000))::text, 4, '0');
    begin
      insert into public.fixed_five_rooms (mode, source_mode, variant, versions, root_seed, code, code_active, code_expires_at, phase)
        values (v_room.mode, v_room.source_mode, v_room.variant, v_room.versions, v_seed, v_code, true, now() + interval '15 minutes', 'lobby')
        returning id into v_new_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
    end;
  end loop;
  update public.fixed_five_rooms set successor_room_id = v_new_id, updated_at = now() where id = p_room_id;
  return jsonb_build_object('room_id', v_new_id, 'code', v_code);
end;
$$;
revoke all on function public.fixed_five_rematch(uuid) from public;
grant execute on function public.fixed_five_rematch(uuid) to authenticated;

notify pgrst, 'reload schema';
