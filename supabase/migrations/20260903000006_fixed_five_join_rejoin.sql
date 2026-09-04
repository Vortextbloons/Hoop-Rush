-- M2.8 fix: rejoining your own room via code must hand back your existing
-- seat instead of crashing on unique(room_id, uid).
-- Without this, anyone who leaves and re-joins (cleared storage, new tab,
-- invite link) gets a 500 instead of their room back.
-- (Already applied to the live project via migration fixed_five_join_rejoin.)

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
begin
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms
    where code = p_code and code_active and code_expires_at > now() limit 1 for update;
  if not found then
    raise exception 'invalid-code' using errcode = 'P0001';
  end if;
  if v_room.phase = 'expired' then
    raise exception 'code-expired' using errcode = 'P0001';
  end if;
  -- Idempotent rejoin: a seated member gets their existing seat back.
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
    on conflict (room_id, participant_id) do update set online = true, last_seen_at = now()
    where public.fixed_five_room_members.uid = excluded.uid;
  update public.fixed_five_rooms set revision = revision + 1, updated_at = now() where id = v_room.id;
  insert into public.fixed_five_join_attempts (uid, code) values (auth.uid(), p_code);
  return jsonb_build_object('room_id', v_room.id, 'participant_id', 'p2');
end;
$$;
revoke all on function public.fixed_five_room_join(text) from public;
grant execute on function public.fixed_five_room_join(text) to authenticated;
