begin;
select plan(2);

do $test$
declare
  v_uid uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_ff uuid := gen_random_uuid();
  v_dd uuid := gen_random_uuid();
  v_hm uuid := gen_random_uuid();
  v_lobby uuid := gen_random_uuid();
  v_policy record;
  v_topic record;
  v_allowed boolean;
  v_actor uuid;
begin
  insert into public.fixed_five_rooms(id, mode, source_mode, variant, versions, root_seed)
    values (v_ff, 'duel', 'classic', 'ratings', '{}'::jsonb, repeat('a', 32));
  insert into public.draft_duel_rooms(id, fairness, presentation, versions, root_seed)
    values (v_dd, 'fair', 'ratings', '{}'::jsonb, repeat('b', 32));
  insert into public.havoc_multiplayer_rooms(id, versions, root_seed)
    values (v_hm, '{}'::jsonb, repeat('c', 32));
  insert into public.fixed_five_room_members(room_id, uid, participant_id) values (v_ff, v_uid, 'p1');
  insert into public.draft_duel_room_members(room_id, uid, participant_id) values (v_dd, v_uid, 'p1');
  insert into public.havoc_multiplayer_room_members(room_id, uid, participant_id) values (v_hm, v_uid, 'p1');
  insert into public.multiplayer_lobbies(id, code, host_uid)
    values (v_lobby, multiplayer_private.allocate_code(), v_uid);

  foreach v_actor in array array[v_uid, v_outsider] loop
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    for v_topic in select * from (values
      ('draft-duel', v_dd, 'dd members read room transient channel', 'dd members send room transient channel'),
      ('havoc-multiplayer', v_hm, 'hm members read room transient channel', 'hm members send room transient channel'),
      ('profile-fixed-five', v_ff, 'fixed five members read profile presence', 'fixed five members send profile presence'),
      ('profile-draft-duel', v_dd, 'draft duel members read profile presence', 'draft duel members send profile presence'),
      ('profile-havoc-multiplayer', v_hm, 'havoc members read profile presence', 'havoc members send profile presence'),
      ('profile-lobby', v_lobby, 'lobby members read profile presence', 'lobby members send profile presence')
    ) as topics(prefix, room_id, read_policy, send_policy) loop
      perform set_config('realtime.topic', v_topic.prefix || ':' || v_topic.room_id::text, true);
      for v_policy in select policyname, coalesce(qual, with_check) as expression
        from pg_policies where schemaname = 'realtime' and tablename = 'messages' loop
        execute 'select coalesce((' || v_policy.expression || '), false)' into v_allowed;
        assert v_allowed = (v_actor = v_uid and v_policy.policyname in (v_topic.read_policy, v_topic.send_policy)),
          format('unexpected authorization: %s on %s', v_policy.policyname, v_topic.prefix);
      end loop;
    end loop;
  end loop;

  for v_topic in select unnest(array[
    'profile-lobby:------------------------------------',
    'profile-fixed-five:invalid',
    'havoc-multiplayer:00000000-0000-0000-0000-00000000000z',
    'unrelated',
    ''
  ]) as topic loop
    perform set_config('realtime.topic', v_topic.topic, true);
    for v_policy in select policyname, coalesce(qual, with_check) as expression
      from pg_policies where schemaname = 'realtime' and tablename = 'messages' loop
      execute 'select coalesce((' || v_policy.expression || '), false)' into v_allowed;
      assert not v_allowed, format('malformed topic allowed by %s', v_policy.policyname);
    end loop;
  end loop;
end;
$test$;
select pass('private topic policies allow only matching members and safely reject other topics');
select is((select count(*)::integer from pg_policies where schemaname = 'realtime' and tablename = 'messages'), 12, 'all twelve private topic policies are exercised');
select * from finish();
rollback;
