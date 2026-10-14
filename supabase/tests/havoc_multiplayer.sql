-- pgTAP tests for Havoc live multiplayer.
-- Run with: supabase test db
--
-- Behavioral RPC calls run as the authenticated role with request.jwt.claims
-- set (the havoc RPCs read auth.uid()). Assertions run as the session
-- role (postgres in supabase test db) and read captured receipts from a
-- scratch table, so pgTAP state is never role-switched.

begin;
select plan(199);

create function public.hm_pgtap_has_policy(p_schema text, p_table text, p_policy text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from pg_policies
    where schemaname = p_schema and tablename = p_table and policyname = p_policy
  );
$$;

-- 1. Schema.
select has_table('public', 'havoc_multiplayer_rooms', 'havoc_multiplayer_rooms exists');
select has_table('public', 'havoc_multiplayer_room_members', 'members exists');
select has_table('public', 'havoc_multiplayer_room_commands', 'commands exists');
select has_table('public', 'havoc_multiplayer_join_attempts', 'join attempts exists');
select has_table('public', 'havoc_multiplayer_deadline_commitments', 'deadline commitments exists');
select has_table('public', 'havoc_multiplayer_verification_receipts', 'verification receipts exists');
select has_table('public', 'havoc_multiplayer_server_versions', 'server versions exists');

select col_type_is('public', 'havoc_multiplayer_rooms', 'code', 'text', 'code is text preserving leading zeroes');
select col_type_is('public', 'havoc_multiplayer_rooms', 'variant', 'text', 'variant is text');
select col_type_is('public', 'havoc_multiplayer_rooms', 'draft_state', 'jsonb', 'draft_state is jsonb');
select col_type_is('public', 'havoc_multiplayer_room_members', 'next_game_ready', 'smallint', 'next_game_ready is smallint');
select col_type_is('public', 'havoc_multiplayer_server_versions', 'value', 'text', 'server version values are text');

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'havoc_multiplayer_rooms'
      and c.conname = 'havoc_multiplayer_rooms_code_check' and c.contype = 'c'
  ),
  'code check enforces four digits');
select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'havoc_multiplayer_rooms'
      and c.conname = 'havoc_multiplayer_rooms_phase_check' and c.contype = 'c'
  ),
  'phase check');
select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'havoc_multiplayer_rooms'
      and c.conname = 'havoc_multiplayer_rooms_variant_check' and c.contype = 'c'
  ),
  'variant check');

select has_index('public', 'havoc_multiplayer_rooms', 'havoc_multiplayer_rooms_active_code_uidx', 'partial unique active code index exists');
select has_index('public', 'havoc_multiplayer_room_commands', 'havoc_multiplayer_room_commands_room_ordinal_idx', 'command ordinal index exists');
select has_pk('public', 'havoc_multiplayer_deadline_commitments', 'deadline commitments primary key exists');
select has_pk('public', 'havoc_multiplayer_verification_receipts', 'verification receipts primary key exists');
select col_is_pk('public', 'havoc_multiplayer_server_versions', 'key', 'server versions key is the primary key');

select ok(public.hm_pgtap_has_policy('public', 'havoc_multiplayer_rooms', 'hm members read their room'), 'hm members read their room');
select ok(public.hm_pgtap_has_policy('public', 'havoc_multiplayer_room_members', 'hm members read room membership'), 'hm members read room membership');
select ok(public.hm_pgtap_has_policy('public', 'havoc_multiplayer_room_commands', 'hm members read their commands'), 'hm members read their commands');
select ok(public.hm_pgtap_has_policy('public', 'havoc_multiplayer_deadline_commitments', 'hm members read deadline commitments'), 'hm members read deadline commitments');
select ok(public.hm_pgtap_has_policy('public', 'havoc_multiplayer_verification_receipts', 'hm members read verification receipts'), 'hm members read verification receipts');
select ok(public.hm_pgtap_has_policy('realtime', 'messages', 'hm members read room transient channel'), 'hm members read room transient channel');
select ok(public.hm_pgtap_has_policy('realtime', 'messages', 'hm members send room transient channel'), 'hm members send room transient channel');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'havoc_multiplayer_rooms' and cmd <> 'SELECT'),
  0, 'no direct client writes to rooms');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'havoc_multiplayer_room_members' and cmd <> 'SELECT'),
  0, 'no direct client writes to members');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'havoc_multiplayer_room_commands' and cmd <> 'SELECT'),
  0, 'no direct client writes to commands');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'havoc_multiplayer_deadline_commitments' and cmd <> 'SELECT'),
  0, 'no direct client writes to deadline commitments');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'havoc_multiplayer_verification_receipts' and cmd <> 'SELECT'),
  0, 'no direct client writes to verification receipts');

select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_rooms'::regclass),
  true, 'rooms have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_room_members'::regclass),
  true, 'memberships have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_room_commands'::regclass),
  true, 'commands have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_join_attempts'::regclass),
  true, 'join attempts have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_deadline_commitments'::regclass),
  true, 'deadline commitments have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_verification_receipts'::regclass),
  true, 'verification receipts have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.havoc_multiplayer_server_versions'::regclass),
  true, 'server versions have RLS enabled');

select has_function('public', 'havoc_multiplayer_room_create', array['jsonb','text'], 'create exists');
select has_function('public', 'havoc_multiplayer_room_preview', array['text'], 'preview exists');
select has_function('public', 'havoc_multiplayer_room_join', array['text'], 'join exists');
select has_function('public', 'havoc_multiplayer_command_submit', array['uuid','text','integer','jsonb'], 'command submit exists');
select has_function('public', 'havoc_multiplayer_commit_fallback', array['uuid','text','jsonb','integer'], 'commit fallback exists');
select has_function('public', 'havoc_multiplayer_timeout_resolve', array['uuid'], 'timeout resolve exists');
select has_function('public', 'havoc_multiplayer_timeout_apply', array['uuid'], 'timeout apply exists');
select has_function('public', 'havoc_multiplayer_verification_challenge', array['uuid'], 'verification challenge exists');
select has_function('public', 'havoc_multiplayer_verification_submit', array['uuid','text','jsonb','integer'], 'verification submit exists');
select has_function('public', 'havoc_multiplayer_complete', array['uuid','text'], 'complete takes a receipt id');
select has_function('public', 'havoc_multiplayer_fail', array['uuid'], 'fail exists');
select has_function('public', 'havoc_multiplayer_leave', array['uuid'], 'leave exists');
select has_function('public', 'havoc_multiplayer_rematch', array['uuid'], 'rematch exists');
select has_function('public', 'havoc_multiplayer_is_member', array['uuid'], 'membership helper exists');
select has_function('public', 'havoc_multiplayer_versions_valid', array['jsonb'], 'version lock helper exists');
select has_function('public', 'havoc_multiplayer_cron_tick', array[]::text[], 'cron exists');
select has_function('public', 'havoc_multiplayer_random_code', array[]::text[], 'cryptographic room-code generator exists');

select is(
  has_function_privilege('authenticated', 'public.havoc_multiplayer_room_create(jsonb, text)', 'EXECUTE'),
  true, 'authenticated can create havoc rooms');
select is(
  has_function_privilege('anon', 'public.havoc_multiplayer_room_create(jsonb, text)', 'EXECUTE'),
  false, 'anon cannot create havoc rooms');
select is(
  (select count(*)::int
   from pg_proc p
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
   where p.oid = 'public.havoc_multiplayer_room_create(jsonb, text)'::regprocedure
     and acl.grantee = 0
     and acl.privilege_type = 'EXECUTE'),
  0, 'room creation is not executable by PUBLIC');
select is(
  has_function_privilege('authenticated', 'public.havoc_multiplayer_random_code()', 'EXECUTE'),
  false, 'authenticated cannot call the internal room-code generator');
select is(
  has_function_privilege('anon', 'public.havoc_multiplayer_random_code()', 'EXECUTE'),
  false, 'anon cannot call the internal room-code generator');
select is(
  has_function_privilege('authenticated', 'public.havoc_multiplayer_timeout_apply(uuid)', 'EXECUTE'),
  false, 'authenticated cannot call the internal timeout applier');
select is(
  has_function_privilege('authenticated', 'public.havoc_multiplayer_cron_tick()', 'EXECUTE'),
  false, 'authenticated cannot call the cron tick');
select is(
  has_function_privilege('service_role', 'public.havoc_multiplayer_cron_tick()', 'EXECUTE'),
  true, 'service_role can call the cron tick');
select matches(public.havoc_multiplayer_random_code(), '^[0-9]{4}$', 'generated room codes preserve four digits');
select is(
  (select count(distinct public.havoc_multiplayer_random_code()) > 100 from generate_series(1, 128)),
  true, 'generated room codes have broad sample diversity');
select ok(
  position('fixed_five_random_code' in pg_get_functiondef('public.havoc_multiplayer_random_code()'::regprocedure)) > 0
  and position('extensions.gen_random_bytes' in pg_get_functiondef('public.fixed_five_random_code()'::regprocedure)) > 0
  and position('havoc_multiplayer_rooms' in pg_get_functiondef('public.fixed_five_random_code()'::regprocedure)) > 0,
  'room-code entropy comes from pgcrypto and the namespace includes havoc');
select is(
  position('random()' in pg_get_functiondef('public.havoc_multiplayer_random_code()'::regprocedure)),
  0, 'room-code generator does not use PostgreSQL random()');
select is(
  public.havoc_multiplayer_first_picker('0123456789abcdef0123456789abcdef'),
  'p2', 'first picker derivation matches the frozen root seed byte parity');
select is(
  public.havoc_multiplayer_home_court('aabbccddeeff00112233445566778899'),
  'p2', 'home court derivation matches the frozen root seed byte parity');
select is(
  (select value from public.havoc_multiplayer_server_versions where key = 'multiplayerVersion'),
  'havoc-multiplayer-v2', 'server pins havoc-multiplayer-v2');

-- 2. Behavioral harness.
create table public.hm_pgtap_ctx (name text primary key, value text);
grant select, insert, update, delete on public.hm_pgtap_ctx to authenticated;

create function public.hm_pgtap_claim(p_uid text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

create function public.hm_pgtap_clear_claim() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function public.hm_pgtap_uid(p_participant text, p_uid1 text, p_uid2 text)
returns text
language sql
stable
as $$
  select value from public.hm_pgtap_ctx
  where name = case when p_participant = 'p1' then p_uid1 else p_uid2 end;
$$;

create function public.hm_pgtap_receipt(
  p_room_id uuid, p_challenge text, p_result_digest text, p_receipt_digest text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'challenge', p_challenge,
    'resultDigest', p_result_digest,
    'receiptDigest', p_receipt_digest,
    'commandIds', (
      select coalesce(jsonb_agg(c.command_id order by c.ordinal), '[]'::jsonb)
      from public.havoc_multiplayer_room_commands c
      where c.room_id = p_room_id
    ),
    'gameSeeds', jsonb_build_array('aaaaaaaaaaaaaaaa')
  );
$$;

insert into public.hm_pgtap_ctx (name, value) values
  ('versions', '{"schemaVersion":1,"engineVersion":"engine-v1","rulesVersion":"havoc-rules-v6","mutationCatalogVersion":"havoc-mutations-v5","profileVersion":"profile-v1","dataVersion":"data-v1","catalogVersion":"catalog-v1","catalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","profileHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","multiplayerVersion":"havoc-multiplayer-v2"}'),
  ('uid_a1', '00000000-0000-4000-8000-000000000001'),
  ('uid_a2', '00000000-0000-4000-8000-000000000002'),
  ('uid_b1', '00000000-0000-4000-8000-000000000003'),
  ('uid_b2', '00000000-0000-4000-8000-000000000004'),
  ('uid_c1', '00000000-0000-4000-8000-000000000005'),
  ('uid_c2', '00000000-0000-4000-8000-000000000006'),
  ('uid_e1', '00000000-0000-4000-8000-000000000007'),
  ('uid_e2', '00000000-0000-4000-8000-000000000008'),
  ('uid_stranger', '00000000-0000-4000-8000-000000000099');

-- 3. Server version locks reject unsupported values at create.
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_a1'));
do $$
begin
  perform public.havoc_multiplayer_room_create(
    jsonb_set(
      (select value::jsonb from public.hm_pgtap_ctx where name = 'versions'),
      '{multiplayerVersion}', '"havoc-multiplayer-v9"'
    ),
    'standard'
  );
  insert into public.hm_pgtap_ctx (name, value) values ('create_lock_error', 'none');
exception when others then
  insert into public.hm_pgtap_ctx (name, value) values ('create_lock_error', sqlstate);
end $$;
reset role;
select is(
  (select value from public.hm_pgtap_ctx where name = 'create_lock_error'),
  '22023',
  'unsupported multiplayerVersion lock is rejected at create');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_a1'));
do $$
begin
  perform public.havoc_multiplayer_room_create(
    (select value::jsonb from public.hm_pgtap_ctx where name = 'versions'),
    'bogus'
  );
  insert into public.hm_pgtap_ctx (name, value) values ('create_variant_error', 'none');
exception when others then
  insert into public.hm_pgtap_ctx (name, value) values ('create_variant_error', sqlstate);
end $$;
reset role;
select is(
  (select value from public.hm_pgtap_ctx where name = 'create_variant_error'),
  '22023',
  'an unknown draft variant is rejected at create');

-- 4. Valid create -> preview -> join -> rejoin -> seat limit.
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_a1'));
with created as (
  select public.havoc_multiplayer_room_create(
    (select value::jsonb from public.hm_pgtap_ctx where name = 'versions'),
    'curated'
  ) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'room_a', r->>'room_id' from created
union all
select 'code_a', r->>'code' from created;
reset role;
select ok(
  (select value from public.hm_pgtap_ctx where name = 'room_a') is not null,
  'room A is created with server-locked versions');
select is(
  (select variant from public.havoc_multiplayer_rooms
    where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'curated', 'room A keeps the curated draft variant');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'preview_a', public.havoc_multiplayer_room_preview(
  (select value from public.hm_pgtap_ctx where name = 'code_a'))::text;
reset role;
select is(
  (select value::jsonb->>'room_id' from public.hm_pgtap_ctx where name = 'preview_a'),
  (select value from public.hm_pgtap_ctx where name = 'room_a'),
  'preview returns the room without granting access');
select is(
  (select value::jsonb->>'variant' from public.hm_pgtap_ctx where name = 'preview_a'),
  'curated', 'preview reports the draft variant');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
select throws_ok(
  format('select public.havoc_multiplayer_room_preview(%L)', '9999'),
  'P0001', 'invalid-code', 'preview with an unknown code is rejected');
reset role;

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'join_a', public.havoc_multiplayer_room_join(
  (select value from public.hm_pgtap_ctx where name = 'code_a'))->>'participant_id';
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'join_a'), 'p2', 'guest joins as p2');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'rejoin_a', public.havoc_multiplayer_room_join(
  (select value from public.hm_pgtap_ctx where name = 'code_a'))->>'participant_id';
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'rejoin_a'), 'p2', 'rejoining keeps the same seat');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
select throws_ok(
  format('select public.havoc_multiplayer_room_join(%L)', (select value from public.hm_pgtap_ctx where name = 'code_a')),
  'P0001', 'room-full', 'a third seat is rejected');
reset role;

-- 5. Lobby validation: host-only start, online gating, oversized payloads.
set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'start_guest', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'start-guest', null, '{"kind":"start"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'start_guest'),
  'membership', 'only the host may start the draft');

update public.havoc_multiplayer_room_members set online = false
where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a') and participant_id = 'p2';
set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'start_early', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'start-early', null, '{"kind":"start"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'start_early'),
  'not-ready', 'start while the opponent is offline is rejected');
update public.havoc_multiplayer_room_members set online = true
where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a') and participant_id = 'p2';

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'payload_big', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'payload-big', null,
  jsonb_build_object('kind', 'ready', 'pad', repeat('x', 40000)))::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'payload_big'),
  'payload-too-large', 'oversized payloads are rejected before parsing');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'ready_a1', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'ready-a1', null, '{"kind":"ready"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'ready_a1'),
  'true', 'host ready accepted');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'start_a1', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'start-a1', null, '{"kind":"start"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'start_a1'),
  'true', 'start accepted with two online seats');
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'drafting', 'start moves the room to drafting');
select is(
  (select deadline_cursor from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  't0', 'start opens the t0 pick deadline');
select ok(
  (select draft_state->>'first_picker' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')) in ('p1', 'p2'),
  'draft_state stores the derived first picker');
select is(
  (select deadline_participant from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  (select draft_state->>'first_picker' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'the first deadline participant is the first picker');
select is(
  (select series->>'homeParticipantId' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')) in ('p1', 'p2'),
  true, 'start initializes the series home court side');

-- 6. Turn validation, reroll budget, idempotency, and claim exclusivity.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_a');
  v_first text := (select draft_state->>'first_picker' from public.havoc_multiplayer_rooms where id = v_room);
  v_wrong text := case when v_first = 'p1' then 'p2' else 'p1' end;
  v_receipt jsonb;
begin
  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_wrong, 'uid_a1', 'uid_a2'));
  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'pick-a-wrong-turn', null,
    jsonb_build_object('kind', 'pick', 'turnOrdinal', 0,
      'offerId', 'hvo-' || repeat('1', 32), 'cardId', 'hvc-' || repeat('1', 32),
      'claimKey', jsonb_build_object('playerId', 'pick-a-0', 'seasonKey', '2010-11')));
  insert into public.hm_pgtap_ctx (name, value) values ('pick_a_wrong_turn', v_receipt::text);

  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_first, 'uid_a1', 'uid_a2'));
  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'pick-a-wrong-ordinal', null,
    jsonb_build_object('kind', 'pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('1', 32), 'cardId', 'hvc-' || repeat('1', 32),
      'claimKey', jsonb_build_object('playerId', 'pick-a-0', 'seasonKey', '2010-11')));
  insert into public.hm_pgtap_ctx (name, value) values ('pick_a_wrong_ordinal', v_receipt::text);

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'reroll-a-0', null,
    jsonb_build_object('kind', 'reroll', 'turnOrdinal', 0, 'offerId', 'hvo-' || repeat('1', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('reroll_a_first', v_receipt::text);

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'reroll-a-1', null,
    jsonb_build_object('kind', 'reroll', 'turnOrdinal', 0, 'offerId', 'hvo-' || repeat('2', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('reroll_a_second', v_receipt::text);

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'pick-a-0', null,
    jsonb_build_object('kind', 'pick', 'turnOrdinal', 0,
      'offerId', 'hvo-' || repeat('2', 32), 'cardId', 'hvc-' || repeat('2', 32),
      'claimKey', jsonb_build_object('playerId', 'pick-a-0', 'seasonKey', '2010-11')));
  insert into public.hm_pgtap_ctx (name, value) values ('pick_a_first', v_receipt::text);

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'pick-a-0', null,
    jsonb_build_object('kind', 'pick', 'turnOrdinal', 0,
      'offerId', 'hvo-' || repeat('2', 32), 'cardId', 'hvc-' || repeat('2', 32),
      'claimKey', jsonb_build_object('playerId', 'pick-a-0', 'seasonKey', '2010-11')));
  insert into public.hm_pgtap_ctx (name, value) values ('pick_a_duplicate', v_receipt::text)
  on conflict (name) do update set value = excluded.value;

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'pick-a-0', null,
    jsonb_build_object('kind', 'pick', 'turnOrdinal', 0,
      'offerId', 'hvo-' || repeat('2', 32), 'cardId', 'hvc-' || repeat('2', 32),
      'claimKey', jsonb_build_object('playerId', 'pick-a-other', 'seasonKey', '2010-11')));
  insert into public.hm_pgtap_ctx (name, value) values ('pick_a_duplicate_changed', v_receipt::text)
  on conflict (name) do update set value = excluded.value;

  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_wrong, 'uid_a1', 'uid_a2'));
  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'pick-a-claim-taken', null,
    jsonb_build_object('kind', 'pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('3', 32), 'cardId', 'hvc-' || repeat('3', 32),
      'claimKey', jsonb_build_object('playerId', 'pick-a-0', 'seasonKey', '2010-11')));
  insert into public.hm_pgtap_ctx (name, value) values ('pick_a_claim_taken', v_receipt::text);
end $$;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'pick_a_wrong_turn'),
  'turn', 'a pick by the non-picker is rejected with turn');
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'pick_a_wrong_ordinal'),
  'turn', 'a pick with the wrong ordinal is rejected with turn');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'reroll_a_first'),
  'true', 'the current picker rerolls the active offer');
select is(
  (select draft_state->'rerolls_used'->>(select draft_state->>'first_picker' from public.havoc_multiplayer_rooms
    where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'))
   from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '1', 'the accepted reroll spends that participant''s reroll budget');
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'reroll_a_second'),
  'illegal-move', 'a second reroll by the same participant is rejected');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'pick_a_first'),
  'true', 'the current picker lands the first pick');
select is(
  (select jsonb_array_length(draft_state->'claimed_player_ids') from public.havoc_multiplayer_rooms
    where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  1, 'the claimed player lands in draft_state');
select is(
  (select draft_state->>'turn_ordinal' from public.havoc_multiplayer_rooms
    where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '1', 'the turn ordinal advances monotonically');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'pick_a_duplicate'),
  'true', 'a duplicate command id with an identical payload is accepted idempotently');
select is(
  (select value::jsonb->>'ordinal' from public.hm_pgtap_ctx where name = 'pick_a_duplicate'),
  (select value::jsonb->>'ordinal' from public.hm_pgtap_ctx where name = 'pick_a_first'),
  'the idempotent duplicate keeps the original ordinal');
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'pick_a_duplicate_changed'),
  'duplicate-command', 'a duplicate command id with a changed payload is rejected');
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'pick_a_claim_taken'),
  'claim-taken', 're-claiming a claimed person is rejected');

-- 7. Deadline fallback commit, reroll invalidation, and timeout application.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_a');
  v_first text := (select draft_state->>'first_picker' from public.havoc_multiplayer_rooms where id = v_room);
  v_other text := case when v_first = 'p1' then 'p2' else 'p1' end;
  v_receipt jsonb;
begin
  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_first, 'uid_a1', 'uid_a2'));
  v_receipt := public.havoc_multiplayer_commit_fallback(
    v_room,
    (select deadline_cursor from public.havoc_multiplayer_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('3', 32), 'cardId', 'hvc-' || repeat('3', 32)),
    null);
  insert into public.hm_pgtap_ctx (name, value) values ('commit_a_wrong_seat', v_receipt::text);

  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_other, 'uid_a1', 'uid_a2'));
  v_receipt := public.havoc_multiplayer_commit_fallback(
    v_room,
    (select deadline_cursor from public.havoc_multiplayer_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('3', 32), 'cardId', 'hvc-' || repeat('3', 32)),
    null);
  insert into public.hm_pgtap_ctx (name, value) values ('commit_a_ok', v_receipt::text);

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'reroll-a-turn1', null,
    jsonb_build_object('kind', 'reroll', 'turnOrdinal', 1, 'offerId', 'hvo-' || repeat('3', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('reroll_a_turn1', v_receipt::text);

  insert into public.hm_pgtap_ctx (name, value)
  select 'fallback_after_reroll', coalesce(deadline_fallback::text, 'null') from public.havoc_multiplayer_rooms where id = v_room;
  insert into public.hm_pgtap_ctx (name, value)
  select 'commitments_after_reroll', count(*)::text from public.havoc_multiplayer_deadline_commitments
    where room_id = v_room and cursor = 't1';

  v_receipt := public.havoc_multiplayer_commit_fallback(
    v_room,
    (select deadline_cursor from public.havoc_multiplayer_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('4', 32), 'cardId', 'hvc-' || repeat('4', 32)),
    null);
  insert into public.hm_pgtap_ctx (name, value) values ('commit_a_second', v_receipt::text);

  insert into public.hm_pgtap_ctx (name, value)
  select 'rerolls_used_other', draft_state->'rerolls_used'->>v_other from public.havoc_multiplayer_rooms where id = v_room;
end $$;
reset role;
update public.havoc_multiplayer_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a');

set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_a');
  v_first text := (select draft_state->>'first_picker' from public.havoc_multiplayer_rooms where id = v_room);
  v_other text := case when v_first = 'p1' then 'p2' else 'p1' end;
  v_receipt jsonb;
begin
  insert into public.hm_pgtap_ctx (name, value) values ('timeout_actor_expected', v_other);
  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_other, 'uid_a1', 'uid_a2'));
  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'timeout-t1-1', null,
    jsonb_build_object('kind', 'timeout-pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('4', 32), 'cardId', 'hvc-' || repeat('5', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('submit_a_forged', v_receipt::text);

  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'timeout-t1-1', null,
    jsonb_build_object('kind', 'timeout-pick', 'turnOrdinal', 1,
      'offerId', 'hvo-' || repeat('4', 32), 'cardId', 'hvc-' || repeat('4', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('submit_a_canonical', v_receipt::text);
end $$;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'commit_a_wrong_seat'),
  'turn', 'only the deadline participant can commit a fallback');
select is(
  (select value::jsonb->>'stored' from public.hm_pgtap_ctx where name = 'commit_a_ok'),
  'true', 'the deadline participant commits the fallback');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'reroll_a_turn1'),
  'true', 'a fallback holder may still reroll before the deadline');
select is(
  (select value from public.hm_pgtap_ctx where name = 'fallback_after_reroll'),
  'null', 'an accepted reroll invalidates the committed fallback');
select is(
  (select value from public.hm_pgtap_ctx where name = 'commitments_after_reroll'),
  '0', 'an accepted reroll deletes the stale commitment');
select is(
  (select value::jsonb->>'stored' from public.hm_pgtap_ctx where name = 'commit_a_second'),
  'true', 'the seat commits a replacement fallback');
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'submit_a_forged'),
  'illegal-move', 'a timeout payload that is not the stored fallback is rejected');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'submit_a_canonical'),
  'true', 'the stored commitment applies through command submit');
select is(
  (select deadline_cursor from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  't2', 'applying a timeout advances the deadline cursor');
select is(
  (select draft_state->>'turn_ordinal' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '2', 'applying a timeout advances the turn ordinal');
select is(
  (select actor_participant_id from public.havoc_multiplayer_room_commands
    where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')
      and command_id = 'timeout-t1-1'),
  (select value from public.hm_pgtap_ctx where name = 'timeout_actor_expected'),
  'the applied timeout command is attributed to the timed-out seat');

-- 8. Complete the draft through normal picks.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_a');
  v_first text := (select draft_state->>'first_picker' from public.havoc_multiplayer_rooms where id = v_room);
  v_start integer := (select (draft_state->>'turn_ordinal')::integer from public.havoc_multiplayer_rooms where id = v_room);
  v_actor text;
  v_ord integer;
begin
  for v_ord in v_start..9 loop
    v_actor := case when v_ord % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end;
    perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_actor, 'uid_a1', 'uid_a2'));
    perform public.havoc_multiplayer_command_submit(
      v_room,
      'pick-a-' || v_ord::text,
      null,
      jsonb_build_object('kind', 'pick', 'turnOrdinal', v_ord,
        'offerId', 'hvo-' || repeat('a', 30) || lpad(v_ord::text, 2, '0'),
        'cardId', 'hvc-' || repeat('b', 30) || lpad(v_ord::text, 2, '0'),
        'claimKey', jsonb_build_object('playerId', 'pick-a-' || v_ord::text, 'seasonKey', '2010-11')));
  end loop;
end $$;
reset role;
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'lineup-showdown', 'ten accepted picks close the draft');
select is(
  (select deadline_at from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  null, 'closing the draft clears the pick deadline');
select is(
  (select draft_state->>'active_offer_id' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  null, 'closing the draft clears the active offer');

-- 9. Broadcast a game, then propose and confirm a result.
set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'rn1_a1', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'rn1-a1', null, '{"kind":"ready-next-game","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'preparing-game', 'first next-game ready moves the room to preparing-game');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'bs1_gate', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'bs1-gate', null, '{"kind":"broadcast-start","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'bs1_gate'),
  'not-ready', 'broadcast-start is gated on both seats being ready');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'rn1_a2', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'rn1-a2', null, '{"kind":"ready-next-game","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'rn1_a2'),
  'true', 'guest next-game ready accepted');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'bs1', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'bs1', null, '{"kind":"broadcast-start","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'bs1'),
  'true', 'broadcast-start accepted once both seats are ready');
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'broadcasting', 'broadcast-start moves the room to broadcasting');
select is(
  (select broadcast->>'gameNumber' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '1', 'broadcast state records the game number');
select is(
  (select (broadcast->>'durationMs')::integer from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  8000, 'broadcast duration is the frozen eight seconds');
select is(
  (select count(*)::int from public.havoc_multiplayer_room_members
    where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a') and next_game_ready <> 0),
  0, 'broadcast-start consumes both next-game ready flags');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'propose_a1', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'propose-a1', null,
  jsonb_build_object('kind', 'propose-result', 'gameNumber', 1, 'winner', 'p1',
    'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'propose_a1'),
  'true', 'a result proposal is accepted during broadcasting');
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'game-results', 'proposing a result moves the room to game-results');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'confirm_a2', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'confirm-a2', null,
  jsonb_build_object('kind', 'confirm-result', 'gameNumber', 1, 'verified', true,
    'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'confirm_a2'),
  'true', 'guest confirms the proposed result');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'confirm_a1', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'confirm-a1', null,
  jsonb_build_object('kind', 'confirm-result', 'gameNumber', 1, 'verified', true,
    'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'confirm_a1'),
  'true', 'host confirms the proposed result');
select is(
  (select series->>'p1Wins' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '1', 'both confirmations record the game win');
select is(
  (select series->>'currentGameNumber' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '2', 'a completed game advances the current game number');
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'preparing-game', 'a completed game returns the room to preparing-game');
select is(
  (select jsonb_array_length(series->'games') from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  1, 'the confirmed game lands in the series');
select is(
  (select series->'games'->0->>'homeParticipantId' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  (select series->>'homeParticipantId' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'game 1 home side follows the home court draw');
select is(
  (select series->'games'->0->>'status' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'verified', 'the recorded game carries the verified status');

-- 10. Play out games 2-4 to reach the championship.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_a');
  v_game integer;
begin
  for v_game in 2..4 loop
    perform public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
    perform public.havoc_multiplayer_command_submit(
      v_room, 'rn1-g' || v_game::text, null,
      jsonb_build_object('kind', 'ready-next-game', 'gameNumber', v_game));
    perform public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
    perform public.havoc_multiplayer_command_submit(
      v_room, 'rn2-g' || v_game::text, null,
      jsonb_build_object('kind', 'ready-next-game', 'gameNumber', v_game));
    perform public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
    perform public.havoc_multiplayer_command_submit(
      v_room, 'bs-g' || v_game::text, null,
      jsonb_build_object('kind', 'broadcast-start', 'gameNumber', v_game));
    perform public.havoc_multiplayer_command_submit(
      v_room, 'pr-g' || v_game::text, null,
      jsonb_build_object('kind', 'propose-result', 'gameNumber', v_game, 'winner', 'p1',
        'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)));
    perform public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
    perform public.havoc_multiplayer_command_submit(
      v_room, 'cf2-g' || v_game::text, null,
      jsonb_build_object('kind', 'confirm-result', 'gameNumber', v_game, 'verified', true,
        'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)));
    perform public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
    perform public.havoc_multiplayer_command_submit(
      v_room, 'cf1-g' || v_game::text, null,
      jsonb_build_object('kind', 'confirm-result', 'gameNumber', v_game, 'verified', true,
        'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)));
  end loop;
end $$;
reset role;
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'championship', 'four wins reach the championship phase');
select is(
  (select series->>'champion' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'p1', 'the champion is recorded in the series');
select is(
  (select series->>'p1Wins' from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  '4', 'the series score reaches four wins');
select is(
  (select jsonb_array_length(series->'games') from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  4, 'the series records every confirmed game');
select is(
  (select code from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  null, 'championship deactivates the room code');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'post_champ_propose', public.havoc_multiplayer_command_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'pr-post', null,
  jsonb_build_object('kind', 'propose-result', 'gameNumber', 5, 'winner', 'p1',
    'inputDigest', repeat('f', 32), 'resultDigest', repeat('d', 32), 'tapeDigest', repeat('e', 32)))::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'post_champ_propose'),
  'phase', 'a decided series accepts no further games');

-- 11. Verification and completion.
set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'challenge_a', public.havoc_multiplayer_verification_challenge(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'));
reset role;
select matches(
  (select value from public.hm_pgtap_ctx where name = 'challenge_a'),
  '^[0-9a-f]{64}$',
  'verification challenge is a sha256 hex nonce');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'complete_a_early', public.havoc_multiplayer_complete(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'receipt-a-missing')::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'complete_a_early'),
  'not-ready', 'completion without stored receipts is rejected');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'verify_a_bad_challenge', public.havoc_multiplayer_verification_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'receipt-a-bad',
  jsonb_set(
    public.hm_pgtap_receipt(
      (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
      (select value from public.hm_pgtap_ctx where name = 'challenge_a'),
      repeat('1', 32), repeat('2', 64)),
    '{challenge}', to_jsonb(repeat('3', 64))),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.hm_pgtap_ctx where name = 'verify_a_bad_challenge'),
  'illegal-move', 'a receipt with a forged challenge is rejected');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'verify_a_p1', public.havoc_multiplayer_verification_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'receipt-a-p1',
  public.hm_pgtap_receipt(
    (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
    (select value from public.hm_pgtap_ctx where name = 'challenge_a'),
    repeat('1', 32), repeat('2', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.hm_pgtap_ctx where name = 'verify_a_p1'),
  'receipt-a-p1', 'a valid receipt is stored for the caller seat');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'verify_a_p2', public.havoc_multiplayer_verification_submit(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'receipt-a-p2',
  public.hm_pgtap_receipt(
    (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
    (select value from public.hm_pgtap_ctx where name = 'challenge_a'),
    repeat('1', 32), repeat('4', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.hm_pgtap_ctx where name = 'verify_a_p2'),
  'receipt-a-p2', 'the second seat stores its receipt');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.hm_pgtap_ctx (name, value)
select 'complete_a', public.havoc_multiplayer_complete(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_a'),
  'receipt-a-p1')::text;
reset role;
select is(
  (select value::jsonb->>'completed' from public.hm_pgtap_ctx where name = 'complete_a'),
  'true', 'matching seat receipts complete the room');
select is(
  (select confirmed_digest from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  repeat('1', 32), 'completion stores the confirmed 32-hex digest');
select is(
  (select bool_and(locked) from public.havoc_multiplayer_room_members
    where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  true, 'completion locks both seats');

-- 12. Rematch creates a fresh successor room.
set local role authenticated;
do $$
begin
  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
  perform public.havoc_multiplayer_rematch((select value::uuid from public.hm_pgtap_ctx where name = 'room_a'));
  insert into public.hm_pgtap_ctx (name, value) values ('rematch_stranger', 'none');
exception when others then
  insert into public.hm_pgtap_ctx (name, value) values ('rematch_stranger', sqlerrm);
end $$;
reset role;
select is(
  (select value from public.hm_pgtap_ctx where name = 'rematch_stranger'),
  'membership', 'non-members cannot rematch a room');

set local role authenticated;
select public.hm_pgtap_claim(public.hm_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
with created as (
  select public.havoc_multiplayer_rematch(
    (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'room_s', r->>'room_id' from created
union all
select 'code_s', r->>'code' from created;
reset role;
select ok(
  (select value from public.hm_pgtap_ctx where name = 'room_s') is not null,
  'rematch creates a successor room');
select isnt(
  (select value from public.hm_pgtap_ctx where name = 'room_s'),
  (select value from public.hm_pgtap_ctx where name = 'room_a'),
  'the successor is a different room');
select isnt(
  (select root_seed from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_s')),
  (select root_seed from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  'the successor carries a fresh root seed');
select matches(
  (select value from public.hm_pgtap_ctx where name = 'code_s'),
  '^[0-9]{4}$', 'the successor carries a fresh active code');
select is(
  (select successor_room_id from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_a')),
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_s'),
  'the finished room links to its successor');
select is(
  (select draft_state from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_s')),
  '{}'::jsonb, 'the successor carries no draft state');
select is(
  (select count(*)::int from public.havoc_multiplayer_room_members
    where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_s')),
  1, 'only the rematching seat is carried into the successor');
select is(
  (select variant from public.havoc_multiplayer_rooms
    where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_s')),
  'curated', 'the successor keeps the draft variant');

-- 13. Mismatching proposals fail the room (room B).
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_b1'));
with created as (
  select public.havoc_multiplayer_room_create(
    (select value::jsonb from public.hm_pgtap_ctx where name = 'versions'),
    'standard'
  ) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'room_b', r->>'room_id' from created
union all
select 'code_b', r->>'code' from created;
reset role;
select ok(
  (select value from public.hm_pgtap_ctx where name = 'room_b') is not null,
  'room B is created');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_b2'));
insert into public.hm_pgtap_ctx (name, value)
select 'join_b', public.havoc_multiplayer_room_join(
  (select value from public.hm_pgtap_ctx where name = 'code_b'))->>'participant_id';
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'join_b'), 'p2', 'guest joins room B');

update public.havoc_multiplayer_rooms
set phase = 'broadcasting',
    series = jsonb_build_object(
      'homeParticipantId', 'p1', 'games', '[]'::jsonb,
      'p1Wins', 0, 'p2Wins', 0, 'currentGameNumber', 1, 'champion', null)
where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_b');

set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_b');
  v_receipt jsonb;
begin
  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_b1'));
  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'propose-b1', null,
    jsonb_build_object('kind', 'propose-result', 'gameNumber', 1, 'winner', 'p1',
      'inputDigest', repeat('a', 32), 'resultDigest', repeat('a', 32), 'tapeDigest', repeat('a', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('propose_b1', v_receipt::text);

  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_b2'));
  v_receipt := public.havoc_multiplayer_command_submit(
    v_room, 'propose-b2', null,
    jsonb_build_object('kind', 'propose-result', 'gameNumber', 1, 'winner', 'p2',
      'inputDigest', repeat('b', 32), 'resultDigest', repeat('b', 32), 'tapeDigest', repeat('b', 32)));
  insert into public.hm_pgtap_ctx (name, value) values ('propose_b2', v_receipt::text);

  v_receipt := public.havoc_multiplayer_fail(v_room);
  insert into public.hm_pgtap_ctx (name, value) values ('fail_b', v_receipt::text);
end $$;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'propose_b1'),
  'true', 'the first seat proposes a result');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'propose_b2'),
  'true', 'the second seat proposes a disagreeing result');
select is(
  (select value::jsonb->>'failed' from public.hm_pgtap_ctx where name = 'fail_b'),
  'true', 'disagreeing proposals fail the room');
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_b')),
  'integrity-failed', 'proposal disagreement sets integrity-failed');

-- 14. Disagreeing receipts fail the room (room D).
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c1'));
with created as (
  select public.havoc_multiplayer_room_create(
    (select value::jsonb from public.hm_pgtap_ctx where name = 'versions'),
    'standard'
  ) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'room_d', r->>'room_id' from created
union all
select 'code_d', r->>'code' from created;
reset role;
select ok(
  (select value from public.hm_pgtap_ctx where name = 'room_d') is not null,
  'room D is created');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c2'));
insert into public.hm_pgtap_ctx (name, value)
select 'join_d', public.havoc_multiplayer_room_join(
  (select value from public.hm_pgtap_ctx where name = 'code_d'))->>'participant_id';
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'join_d'), 'p2', 'guest joins room D');

update public.havoc_multiplayer_rooms set phase = 'championship'
  where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_d');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c1'));
insert into public.hm_pgtap_ctx (name, value)
select 'challenge_d', public.havoc_multiplayer_verification_challenge(
  (select value::uuid from public.hm_pgtap_ctx where name = 'room_d'));
reset role;
select matches(
  (select value from public.hm_pgtap_ctx where name = 'challenge_d'),
  '^[0-9a-f]{64}$',
  'room D challenge is a sha256 hex nonce');

set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_d');
  v_receipt jsonb;
begin
  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c1'));
  v_receipt := public.havoc_multiplayer_verification_submit(
    v_room, 'receipt-d1',
    public.hm_pgtap_receipt(v_room,
      (select value from public.hm_pgtap_ctx where name = 'challenge_d'),
      repeat('5', 32), repeat('1', 64)),
    null);
  insert into public.hm_pgtap_ctx (name, value) values ('receipt_d1', v_receipt::text);

  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c2'));
  v_receipt := public.havoc_multiplayer_verification_submit(
    v_room, 'receipt-d2',
    public.hm_pgtap_receipt(v_room,
      (select value from public.hm_pgtap_ctx where name = 'challenge_d'),
      repeat('5', 32), repeat('2', 64)),
    null);
  insert into public.hm_pgtap_ctx (name, value) values ('receipt_d2', v_receipt::text);

  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c1'));
  v_receipt := public.havoc_multiplayer_fail(v_room);
  insert into public.hm_pgtap_ctx (name, value) values ('fail_d', v_receipt::text);
end $$;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'receipt_d1'),
  'true', 'room D seat one stores a receipt');
select is(
  (select value::jsonb->>'accepted' from public.hm_pgtap_ctx where name = 'receipt_d2'),
  'true', 'room D seat two stores a disagreeing receipt');
select is(
  (select value::jsonb->>'failed' from public.hm_pgtap_ctx where name = 'fail_d'),
  'true', 'disagreeing receipts fail the room');
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_d')),
  'integrity-failed', 'receipt disagreement sets integrity-failed');

-- 15. Cron applies committed overdue deadlines, expires codes, and retains rooms (room C).
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c1'));
with created as (
  select public.havoc_multiplayer_room_create(
    (select value::jsonb from public.hm_pgtap_ctx where name = 'versions'),
    'standard'
  ) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'room_c', r->>'room_id' from created
union all
select 'code_c', r->>'code' from created;
reset role;
select ok(
  (select value from public.hm_pgtap_ctx where name = 'room_c') is not null,
  'room C is created');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c2'));
insert into public.hm_pgtap_ctx (name, value)
select 'join_c', public.havoc_multiplayer_room_join(
  (select value from public.hm_pgtap_ctx where name = 'code_c'))->>'participant_id';
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'join_c'), 'p2', 'guest joins room C');

-- Legacy lobby lookup: a raw havoc code resolves through multiplayer_lobby_command.
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
insert into public.hm_pgtap_ctx (name, value)
select 'legacy_c', public.multiplayer_lobby_command(
  jsonb_build_object('kind', 'preview', 'code', (select value from public.hm_pgtap_ctx where name = 'code_c')))::text;
reset role;
select is(
  (select value::jsonb->>'legacy' from public.hm_pgtap_ctx where name = 'legacy_c'),
  'true', 'a raw havoc code resolves through the lobby legacy lookup');
select is(
  (select value::jsonb->>'gameKind' from public.hm_pgtap_ctx where name = 'legacy_c'),
  'havoc', 'the legacy lookup reports the havoc game kind');
select is(
  (select value::jsonb->>'variant' from public.hm_pgtap_ctx where name = 'legacy_c'),
  (
    select variant from public.havoc_multiplayer_rooms
    where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c')
  ),
  'the legacy lookup reports the draft variant');
select is(
  (select value::jsonb->>'gameRoomId' from public.hm_pgtap_ctx where name = 'legacy_c'),
  (select value from public.hm_pgtap_ctx where name = 'room_c'),
  'the legacy lookup returns the havoc room id');

set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.hm_pgtap_ctx where name = 'room_c');
  v_first text;
begin
  perform public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c1'));
  perform public.havoc_multiplayer_command_submit(v_room, 'start-c1', null, '{"kind":"start"}'::jsonb);
  select draft_state->>'first_picker' into v_first from public.havoc_multiplayer_rooms where id = v_room;
  perform public.hm_pgtap_claim(public.hm_pgtap_uid(v_first, 'uid_c1', 'uid_c2'));
  perform public.havoc_multiplayer_commit_fallback(
    v_room,
    (select deadline_cursor from public.havoc_multiplayer_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-pick', 'turnOrdinal', 0,
      'offerId', 'hvo-' || repeat('c', 32), 'cardId', 'hvc-' || repeat('c', 32)),
    null);
end $$;
reset role;
update public.havoc_multiplayer_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c');
select public.havoc_multiplayer_cron_tick();
select is(
  (select deadline_cursor from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c')),
  't1', 'cron applies committed overdue deadlines');
select is(
  (select count(*)::int from public.havoc_multiplayer_room_commands
    where room_id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c')
      and command_id = 'timeout-t0-0'),
  1, 'cron stores exactly one canonical timeout command');

update public.havoc_multiplayer_rooms set code_expires_at = now() - interval '1 minute', code_active = true
  where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c');
select public.havoc_multiplayer_cron_tick();
select is(
  (select code_active from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c')),
  false, 'cron deactivates expired codes');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_c2'));
select throws_ok(
  format('select public.havoc_multiplayer_room_join(%L)', (select value from public.hm_pgtap_ctx where name = 'code_c')),
  'P0001', 'invalid-code', 'an expired code no longer joins');
reset role;

update public.havoc_multiplayer_rooms set expires_at = now() - interval '1 minute'
  where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c');
select public.havoc_multiplayer_cron_tick();
select is(
  (select phase from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c')),
  'expired', 'cron marks retained rooms expired');

update public.havoc_multiplayer_rooms set expires_at = now() - interval '25 hours'
  where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c');
select public.havoc_multiplayer_cron_tick();
select is(
  (select count(*)::int from public.havoc_multiplayer_rooms where id = (select value::uuid from public.hm_pgtap_ctx where name = 'room_c')),
  0, 'cron deletes rooms after the retention window');

-- 16. Lobby create/join/start for havoc (fresh seats).
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_e1'));
with created as (
  select public.multiplayer_lobby_command('{"kind":"create"}'::jsonb) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'lobby_e', r->>'id' from created
union all
select 'lobby_code_e', r->>'code' from created
union all
select 'lobby_rev_e', r->>'revision' from created;
reset role;
select matches(
  (select value from public.hm_pgtap_ctx where name = 'lobby_code_e'),
  '^[0-9]{4}$', 'a havoc lobby gets a four-digit code');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_e2'));
insert into public.hm_pgtap_ctx (name, value)
select 'lobby_join_e', public.multiplayer_lobby_command(
  jsonb_build_object('kind', 'join', 'code', (select value from public.hm_pgtap_ctx where name = 'lobby_code_e')))::text;
reset role;
select is(
  (select value::jsonb->>'participantId' from public.hm_pgtap_ctx where name = 'lobby_join_e'),
  'p2', 'guest joins the havoc lobby without a mode');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_e1'));
with started as (
  select public.multiplayer_lobby_command(jsonb_build_object(
    'kind', 'start',
    'lobbyId', (select value from public.hm_pgtap_ctx where name = 'lobby_e'),
    'expectedRevision', 1,
    'settings', jsonb_build_object(
      'gameKind', 'havoc',
      'variant', 'curated',
      'versions', (select value::jsonb from public.hm_pgtap_ctx where name = 'versions')))) as r
)
insert into public.hm_pgtap_ctx (name, value)
select 'lobby_start_e', r::text from started;
reset role;
select is(
  (select value::jsonb->>'gameKind' from public.hm_pgtap_ctx where name = 'lobby_start_e'),
  'havoc', 'the lobby switches to the havoc game kind');
select is(
  (select variant from public.havoc_multiplayer_rooms
    where id = ((select value::jsonb->>'gameRoomId' from public.hm_pgtap_ctx where name = 'lobby_start_e')::uuid)),
  'curated', 'the lobby carries the havoc draft variant');
select is(
  (select value::jsonb->>'code' from public.hm_pgtap_ctx where name = 'lobby_start_e'),
  (select value from public.hm_pgtap_ctx where name = 'lobby_code_e'),
  'the havoc room inherits the lobby code');
select is(
  (select count(*)::int from public.havoc_multiplayer_room_members
    where room_id = ((select value::jsonb->>'gameRoomId' from public.hm_pgtap_ctx where name = 'lobby_start_e')::uuid)
      and uid = (select value::uuid from public.hm_pgtap_ctx where name = 'uid_e1')
      and participant_id = 'p1'),
  1, 'the lobby host lands in the havoc room as p1');
select is(
  (select count(*)::int from public.havoc_multiplayer_room_members
    where room_id = ((select value::jsonb->>'gameRoomId' from public.hm_pgtap_ctx where name = 'lobby_start_e')::uuid)
      and uid = (select value::uuid from public.hm_pgtap_ctx where name = 'uid_e2')
      and participant_id = 'p2'),
  1, 'the lobby guest lands in the havoc room as p2');
select is(
  (select code from public.havoc_multiplayer_rooms
    where id = ((select value::jsonb->>'gameRoomId' from public.hm_pgtap_ctx where name = 'lobby_start_e')::uuid)),
  (select value from public.hm_pgtap_ctx where name = 'lobby_code_e'),
  'the havoc room copies the lobby code and expiry');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_e1'));
insert into public.hm_pgtap_ctx (name, value)
select 'lobby_remove_e', public.multiplayer_lobby_command(
  jsonb_build_object('kind', 'remove-guest', 'lobbyId', (select value from public.hm_pgtap_ctx where name = 'lobby_e')))::text;
reset role;
select is(
  (select value::jsonb->>'guestJoined' from public.hm_pgtap_ctx where name = 'lobby_remove_e'),
  'false', 'removing the havoc opponent clears the lobby seat');
select isnt(
  (select value::jsonb->>'code' from public.hm_pgtap_ctx where name = 'lobby_remove_e'),
  (select value from public.hm_pgtap_ctx where name = 'lobby_code_e'),
  'removing the havoc opponent rotates the invite code');
select is(
  (select count(*)::int from public.havoc_multiplayer_room_members
    where room_id = ((select value::jsonb->>'gameRoomId' from public.hm_pgtap_ctx where name = 'lobby_remove_e')::uuid)
      and uid = (select value::uuid from public.hm_pgtap_ctx where name = 'uid_e2')),
  0, 'the removed opponent loses the havoc seat');

-- 17. Unauthorized access.
set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
insert into public.hm_pgtap_ctx (name, value)
select 'stranger_rooms', count(*)::text from public.havoc_multiplayer_rooms;
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'stranger_rooms'), '0', 'strangers cannot read rooms');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
insert into public.hm_pgtap_ctx (name, value)
select 'stranger_members', count(*)::text from public.havoc_multiplayer_room_members;
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'stranger_members'), '0', 'strangers cannot read memberships');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
insert into public.hm_pgtap_ctx (name, value)
select 'stranger_commands', count(*)::text from public.havoc_multiplayer_room_commands;
reset role;
select is((select value from public.hm_pgtap_ctx where name = 'stranger_commands'), '0', 'strangers cannot read commands');

set local role authenticated;
select public.hm_pgtap_claim((select value from public.hm_pgtap_ctx where name = 'uid_stranger'));
select throws_ok(
  format(
    'select public.havoc_multiplayer_command_submit(%L::uuid, %L, null, %L::jsonb)',
    (select value from public.hm_pgtap_ctx where name = 'room_a'),
    'stranger-command',
    '{"kind":"ready"}'),
  'P0001', 'membership', 'strangers cannot submit commands to a room');

select public.hm_pgtap_clear_claim();
select throws_ok(
  format(
    'select public.havoc_multiplayer_commit_fallback(%L::uuid, %L, %L::jsonb, null)',
    (select value from public.hm_pgtap_ctx where name = 'room_a'),
    't0',
    '{"kind":"timeout-pick","turnOrdinal":0,"offerId":"hvo-00000000000000000000000000000000","cardId":"hvc-00000000000000000000000000000000"}'),
  '28000', 'anonymous session required', 'anonymous callers are rejected');

select * from finish();
rollback;
