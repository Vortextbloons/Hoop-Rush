begin;
select plan(12);

select has_schema('multiplayer_private', 'coordination helpers have a private schema');
select ok(not has_schema_privilege('anon', 'multiplayer_private', 'USAGE'), 'anonymous clients cannot access helpers');
select ok(not has_schema_privilege('authenticated', 'multiplayer_private', 'USAGE'), 'authenticated clients cannot access helpers');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'multiplayer_private' and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0, 'internal functions are not executable by clients');
select ok(has_function_privilege('authenticated', 'public.multiplayer_lobby_command(jsonb)', 'EXECUTE'), 'existing lobby RPC stays accessible');
select ok(not has_function_privilege('anon', 'public.multiplayer_lobby_command(jsonb)', 'EXECUTE'), 'anonymous role cannot invoke lobby RPC');
select throws_ok($$select multiplayer_private.dispatch('fixed-five', 'arbitrary-sql', null)$$, 'P0001', 'invalid-operation', 'dispatcher allowlists operations');
select throws_ok($$select multiplayer_private.dispatch('unknown', 'create', null)$$, 'P0001', 'invalid-mode', 'dispatcher allowlists protocols');
select throws_ok($$select multiplayer_private.validate_code('12ab')$$, 'P0001', 'invalid-code', 'code validation remains four digits');

do $$
declare v_uid uuid := gen_random_uuid(); v_before integer;
begin
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  insert into public.fixed_five_join_attempts(uid, code) select v_uid, '1234' from generate_series(1, 60);
  perform multiplayer_private.record_attempt('fixed-five', '1234', 60, false);
  select count(*) into v_before from public.fixed_five_join_attempts where uid = v_uid;
  assert v_before = 61, 'strict legacy threshold allows attempt number 61';
  begin
    perform multiplayer_private.record_attempt('fixed-five', '1234', 60, false);
    raise exception 'strict threshold unexpectedly passed';
  exception when raise_exception then assert sqlerrm = 'rate-limit'; end;
  assert (select count(*) from public.fixed_five_join_attempts where uid = v_uid) = v_before, 'rejected attempt does not add a row';
  insert into public.draft_duel_join_attempts(uid, code) select v_uid, '1234' from generate_series(1, 90);
  begin
    perform multiplayer_private.record_attempt('draft-duel', '1234', 90, true);
    raise exception 'inclusive threshold unexpectedly passed';
  exception when raise_exception then assert sqlerrm = 'rate-limit'; end;
end $$;
select pass('strict and inclusive rate thresholds and attempt counting are preserved');

do $$
declare v_uid uuid := gen_random_uuid(); v_lobby jsonb; v_code text;
begin
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  v_lobby := public.multiplayer_lobby_command('{"kind":"create"}');
  for i in 1..200 loop
    v_code := multiplayer_private.allocate_code();
    assert v_code <> v_lobby->>'code', 'allocator excludes existing lobby codes';
    assert not exists(select 1 from public.fixed_five_rooms where code = v_code and code_active);
    assert not exists(select 1 from public.draft_duel_rooms where code = v_code and code_active);
    assert not exists(select 1 from public.havoc_multiplayer_rooms where code = v_code and code_active);
  end loop;
  update public.multiplayer_lobbies set expires_at = now() - interval '1 second' where id = (v_lobby->>'id')::uuid;
  begin
    perform public.multiplayer_lobby_command(jsonb_build_object('kind', 'get', 'lobbyId', v_lobby->>'id'));
    raise exception 'expired lobby unexpectedly accessible';
  exception when raise_exception then assert sqlerrm = 'code-expired'; end;
end $$;
select pass('shared allocator excludes every active namespace and lobby expiry remains authoritative');
select ok(position('multiplayer_private.allocate_code' in pg_get_functiondef('public.fixed_five_random_code()'::regprocedure)) > 0, 'legacy code entrypoint delegates to the shared allocator');

select * from finish();
rollback;
