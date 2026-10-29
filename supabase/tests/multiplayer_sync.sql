begin;
select plan(3);
do $test$
declare
  v_uid uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_room uuid;
  v_case record;
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  for v_case in select * from (values ('fixed-five', 'fixed_five'), ('draft-duel', 'draft_duel'), ('havoc', 'havoc_multiplayer')) as modes(mode, prefix) loop
    v_room := gen_random_uuid();
    if v_case.mode = 'fixed-five' then
      insert into public.fixed_five_rooms(id, mode, source_mode, variant, versions, root_seed, command_count)
        values(v_room, 'duel', 'classic', 'ratings', '{}'::jsonb, repeat('a',32), 2);
    elsif v_case.mode = 'draft-duel' then
      insert into public.draft_duel_rooms(id, fairness, presentation, versions, root_seed, command_count)
        values(v_room, 'fair', 'ratings', '{}'::jsonb, repeat('b',32), 2);
    else
      insert into public.havoc_multiplayer_rooms(id, versions, root_seed, command_count)
        values(v_room, '{}'::jsonb, repeat('c',32), 2);
    end if;
    execute format('insert into public.%I(room_id, uid, participant_id) values ($1,$2,''p1'')', v_case.prefix || '_room_members') using v_room, v_uid;
    execute format('insert into public.%I(room_id, command_id, ordinal, actor_participant_id, payload) values ($1,''sync-0'',0,''p1'',''{"kind":"ready"}''), ($1,''sync-1'',1,''p1'',''{"kind":"ready"}'')', v_case.prefix || '_room_commands') using v_room;
    v_result := public.multiplayer_room_sync(v_case.mode, v_room, -1);
    assert v_result->'room'->>'id' = v_room::text;
    assert (v_result->'room'->>'command_count')::integer = 2;
    assert jsonb_array_length(v_result->'members') = 1;
    assert jsonb_array_length(v_result->'commands') = 2;
    assert (v_result->'commands'->0->>'ordinal')::integer = 0;
    assert (v_result->'commands'->1->>'ordinal')::integer = 1;
    v_result := public.multiplayer_room_sync(v_case.mode, v_room, 0);
    assert jsonb_array_length(v_result->'commands') = 1;
    assert (v_result->'commands'->0->>'ordinal')::integer = 1;
    v_result := public.multiplayer_room_sync(v_case.mode, v_room, 1);
    assert v_result->'commands' = '[]'::jsonb;

    perform set_config('request.jwt.claim.sub', v_outsider::text, true);
    begin
      perform public.multiplayer_room_sync(v_case.mode, v_room, -1);
      raise exception 'nonmember unexpectedly authorized';
    exception when raise_exception then assert sqlerrm = 'authorization'; end;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    execute format('delete from public.%I where room_id = $1', v_case.prefix || '_room_members') using v_room;
    begin
      perform public.multiplayer_room_sync(v_case.mode, v_room, -1);
      raise exception 'removed member unexpectedly authorized';
    exception when raise_exception then assert sqlerrm = 'authorization'; end;
  end loop;
  begin
    perform public.multiplayer_room_sync('unknown', gen_random_uuid(), -1);
    raise exception 'unknown mode unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'invalid-mode'; end;
  begin
    perform public.multiplayer_room_sync('fixed-five', gen_random_uuid(), -2);
    raise exception 'invalid ordinal unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'invalid-ordinal'; end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.multiplayer_room_sync('fixed-five', gen_random_uuid(), -1);
    raise exception 'missing auth unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'authorization'; end;
end;
$test$;

select pass('coherent room sync returns ordered deltas and enforces current membership for all modes');
select ok(has_function_privilege('authenticated', 'public.multiplayer_room_sync(text, uuid, integer)', 'execute'), 'authenticated callers can sync');
select ok(not has_function_privilege('anon', 'public.multiplayer_room_sync(text, uuid, integer)', 'execute'), 'anonymous role cannot sync');
select * from finish();
rollback;
