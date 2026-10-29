create or replace function public.multiplayer_room_sync(p_mode text, p_room_id uuid, p_after_ordinal integer default -1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authorization'; end if;
  if p_after_ordinal is null or p_after_ordinal < -1 then raise exception 'invalid-ordinal'; end if;
  case p_mode
    when 'fixed-five' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.fixed_five_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.fixed_five_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.fixed_five_rooms r
      where r.id = p_room_id and public.fixed_five_is_member(r.id);
    when 'draft-duel' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.draft_duel_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.draft_duel_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.draft_duel_rooms r
      where r.id = p_room_id and public.draft_duel_is_member(r.id);
    when 'havoc' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.havoc_multiplayer_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.havoc_multiplayer_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.havoc_multiplayer_rooms r
      where r.id = p_room_id and public.havoc_multiplayer_is_member(r.id);
    else raise exception 'invalid-mode';
  end case;
  if v_result is null then raise exception 'authorization'; end if;
  return v_result;
end;
$$;

revoke all on function public.multiplayer_room_sync(text, uuid, integer) from public, anon;
grant execute on function public.multiplayer_room_sync(text, uuid, integer) to authenticated;
