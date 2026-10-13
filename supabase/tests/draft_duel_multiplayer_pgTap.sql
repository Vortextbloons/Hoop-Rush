-- pgTAP tests for Draft Duel live multiplayer.
-- Run with: supabase test db
--
-- Behavioral RPC calls run as the authenticated role with request.jwt.claims
-- set (the draft-duel RPCs read auth.uid()). Assertions run as the session
-- role (postgres in supabase test db) and read captured receipts from a
-- scratch table, so pgTAP state is never role-switched.

begin;
select plan(174);

-- 1. Schema.
select has_table('public', 'draft_duel_rooms', 'draft_duel_rooms exists');
select has_table('public', 'draft_duel_room_members', 'members exists');
select has_table('public', 'draft_duel_room_commands', 'commands exists');
select has_table('public', 'draft_duel_join_attempts', 'join attempts exists');
select has_table('public', 'draft_duel_deadline_commitments', 'deadline commitments exists');
select has_table('public', 'draft_duel_verification_receipts', 'verification receipts exists');
select has_table('public', 'draft_duel_server_versions', 'server versions exists');

select col_type_is('public', 'draft_duel_rooms', 'code', 'text', 'code is text preserving leading zeroes');
select has_check('public', 'draft_duel_rooms', 'draft_duel_rooms_code_check', 'code check enforces four digits');
select has_check('public', 'draft_duel_rooms', 'draft_duel_rooms_fairness_check', 'fairness check');
select has_check('public', 'draft_duel_rooms', 'draft_duel_rooms_phase_check', 'phase check');
select has_column('public', 'draft_duel_rooms', 'draft_state', 'draft_state column exists');
select has_column('public', 'draft_duel_rooms', 'series', 'series column exists');
select has_column('public', 'draft_duel_rooms', 'broadcast', 'broadcast column exists');
select col_type_is('public', 'draft_duel_rooms', 'draft_state', 'jsonb', 'draft_state is jsonb');
select col_type_is('public', 'draft_duel_room_members', 'next_game_ready', 'smallint', 'next_game_ready is smallint');
select col_type_is('public', 'draft_duel_server_versions', 'value', 'text', 'server version values are text');

select has_index('public', 'draft_duel_rooms', 'draft_duel_rooms_active_code_uidx', 'partial unique active code index exists');
select has_index('public', 'draft_duel_room_commands', 'draft_duel_room_commands_room_ordinal_idx', 'command ordinal index exists');
select has_pk('public', 'draft_duel_deadline_commitments', 'deadline commitments primary key exists');
select has_pk('public', 'draft_duel_verification_receipts', 'verification receipts primary key exists');
select col_is_pk('public', 'draft_duel_server_versions', 'key', 'server versions key is the primary key');

select has_policy('public', 'draft_duel_rooms', 'dd members read their room');
select has_policy('public', 'draft_duel_room_members', 'dd members read room membership');
select has_policy('public', 'draft_duel_room_commands', 'dd members read their commands');
select has_policy('public', 'draft_duel_deadline_commitments', 'dd members read deadline commitments');
select has_policy('public', 'draft_duel_verification_receipts', 'dd members read verification receipts');
select has_policy('realtime', 'messages', 'dd members read room transient channel');
select has_policy('realtime', 'messages', 'dd members send room transient channel');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'draft_duel_rooms' and cmd <> 'SELECT'),
  0, 'no direct client writes to rooms');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'draft_duel_room_members' and cmd <> 'SELECT'),
  0, 'no direct client writes to members');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'draft_duel_room_commands' and cmd <> 'SELECT'),
  0, 'no direct client writes to commands');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'draft_duel_deadline_commitments' and cmd <> 'SELECT'),
  0, 'no direct client writes to deadline commitments');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'draft_duel_verification_receipts' and cmd <> 'SELECT'),
  0, 'no direct client writes to verification receipts');

select is(
  (select relrowsecurity from pg_class where oid = 'public.draft_duel_rooms'::regclass),
  true, 'rooms have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.draft_duel_room_members'::regclass),
  true, 'memberships have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.draft_duel_room_commands'::regclass),
  true, 'commands have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.draft_duel_deadline_commitments'::regclass),
  true, 'deadline commitments have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.draft_duel_verification_receipts'::regclass),
  true, 'verification receipts have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.draft_duel_server_versions'::regclass),
  true, 'server versions have RLS enabled');

select has_function('public', 'draft_duel_room_create', array['text','text','jsonb'], 'create exists');
select has_function('public', 'draft_duel_room_preview', array['text'], 'preview exists');
select has_function('public', 'draft_duel_room_join', array['text'], 'join exists');
select has_function('public', 'draft_duel_command_submit', array['uuid','text','integer','jsonb'], 'command submit exists');
select has_function('public', 'draft_duel_commit_fallback', array['uuid','text','jsonb','integer'], 'commit fallback exists');
select has_function('public', 'draft_duel_timeout_resolve', array['uuid'], 'timeout resolve exists');
select has_function('public', 'draft_duel_timeout_apply', array['uuid'], 'timeout apply exists');
select has_function('public', 'draft_duel_verification_challenge', array['uuid'], 'verification challenge exists');
select has_function('public', 'draft_duel_verification_submit', array['uuid','text','jsonb','integer'], 'verification submit exists');
select has_function('public', 'draft_duel_complete', array['uuid','text'], 'complete takes a receipt id');
select has_function('public', 'draft_duel_fail', array['uuid'], 'fail exists');
select has_function('public', 'draft_duel_leave', array['uuid'], 'leave exists');
select has_function('public', 'draft_duel_rematch', array['uuid'], 'rematch exists');
select has_function('public', 'draft_duel_is_member', array['uuid'], 'membership helper exists');
select has_function('public', 'draft_duel_versions_valid', array['jsonb'], 'version lock helper exists');
select has_function('public', 'draft_duel_cron_tick', array[]::text[], 'cron exists');
select has_function('public', 'draft_duel_random_code', array[]::text[], 'cryptographic room-code generator exists');

select is(
  has_function_privilege('authenticated', 'public.draft_duel_room_create(text,text,jsonb)', 'EXECUTE'),
  true, 'authenticated can create draft-duel rooms');
select is(
  has_function_privilege('anon', 'public.draft_duel_room_create(text,text,jsonb)', 'EXECUTE'),
  false, 'anon cannot create draft-duel rooms');
select is(
  (select count(*)::int
   from pg_proc p
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
   where p.oid = 'public.draft_duel_room_create(text,text,jsonb)'::regprocedure
     and acl.grantee = 0
     and acl.privilege_type = 'EXECUTE'),
  0, 'room creation is not executable by PUBLIC');
select is(
  has_function_privilege('authenticated', 'public.draft_duel_random_code()', 'EXECUTE'),
  false, 'authenticated cannot call the internal room-code generator');
select is(
  has_function_privilege('anon', 'public.draft_duel_random_code()', 'EXECUTE'),
  false, 'anon cannot call the internal room-code generator');
select is(
  has_function_privilege('authenticated', 'public.draft_duel_timeout_apply(uuid)', 'EXECUTE'),
  false, 'authenticated cannot call the internal timeout applier');
select is(
  has_function_privilege('authenticated', 'public.draft_duel_cron_tick()', 'EXECUTE'),
  false, 'authenticated cannot call the cron tick');
select is(
  has_function_privilege('service_role', 'public.draft_duel_cron_tick()', 'EXECUTE'),
  true, 'service_role can call the cron tick');
select matches(public.draft_duel_random_code(), '^[0-9]{4}$', 'generated room codes preserve four digits');
select is(
  (select count(distinct public.draft_duel_random_code()) > 100 from generate_series(1, 128)),
  true, 'generated room codes have broad sample diversity');
select ok(
  position('extensions.gen_random_bytes' in pg_get_functiondef('public.draft_duel_random_code()'::regprocedure)) > 0,
  'room-code entropy comes from pgcrypto');
select is(
  position('random()' in pg_get_functiondef('public.draft_duel_random_code()'::regprocedure)),
  0, 'room-code generator does not use PostgreSQL random()');
select is(
  public.draft_duel_first_picker('0123456789abcdef0123456789abcdef'),
  'p2', 'first picker derivation matches the engine seed bytes');
select is(
  public.draft_duel_home_winner('aabbccddeeff00112233445566778899'),
  'p2', 'home winner derivation matches the engine seed bytes');

-- 2. Behavioral harness.
create table public.dd_pgtap_ctx (name text primary key, value text);
grant select, insert, update, delete on public.dd_pgtap_ctx to authenticated;

create function public.dd_pgtap_claim(p_uid text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

create function public.dd_pgtap_clear_claim() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function public.dd_pgtap_uid(p_participant text, p_uid1 text, p_uid2 text)
returns text
language sql
stable
as $$
  select value from public.dd_pgtap_ctx
  where name = case when p_participant = 'p1' then p_uid1 else p_uid2 end;
$$;

create function public.dd_pgtap_receipt(
  p_room_id uuid, p_challenge text, p_result_digest text, p_receipt_digest text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'roomId', p_room_id::text,
    'rootSeed', r.root_seed,
    'versions', r.versions,
    'challenge', p_challenge,
    'participantIds', jsonb_build_array('p1', 'p2'),
    'commandIds', (
      select coalesce(jsonb_agg(c.command_id order by c.ordinal), '[]'::jsonb)
      from public.draft_duel_room_commands c
      where c.room_id = p_room_id
    ),
    'gameSeeds', jsonb_build_array(
      jsonb_build_object('gameNumber', 1, 'seed', 'dd-seed-pgtap-1')
    ),
    'resultDigest', p_result_digest,
    'receiptDigest', p_receipt_digest
  )
  from public.draft_duel_rooms r
  where r.id = p_room_id;
$$;

insert into public.dd_pgtap_ctx (name, value) values
  ('versions', '{"dataVersion":"data-v1","ratingsVersion":"ratings-v1","catalogVersion":"catalog-v1","catalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","playerVersionIdVersion":"pv-v1","positionNormalizationVersion":"position-v3","engineVersion":"engine-v1","profileVersion":"profile-v1","seedDerivationVersion":"draft-duel-seed-v1","multiplayerVersion":"draft-duel-multiplayer-v1","autopickVersion":"draft-duel-autopick-v1"}'),
  ('uid_a1', '00000000-0000-4000-8000-000000000001'),
  ('uid_a2', '00000000-0000-4000-8000-000000000002'),
  ('uid_b1', '00000000-0000-4000-8000-000000000003'),
  ('uid_b2', '00000000-0000-4000-8000-000000000004'),
  ('uid_c1', '00000000-0000-4000-8000-000000000005'),
  ('uid_c2', '00000000-0000-4000-8000-000000000006'),
  ('uid_stranger', '00000000-0000-4000-8000-000000000099');

-- 3. Server version locks reject unsupported values at create.
set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_a1'));
do $$
begin
  perform public.draft_duel_room_create(
    'fair', 'ratings',
    jsonb_set(
      (select value::jsonb from public.dd_pgtap_ctx where name = 'versions'),
      '{multiplayerVersion}', '"draft-duel-multiplayer-v9"'
    )
  );
  insert into public.dd_pgtap_ctx (name, value) values ('create_lock_error', 'none');
exception when others then
  insert into public.dd_pgtap_ctx (name, value) values ('create_lock_error', sqlstate);
end $$;
reset role;
select is(
  (select value from public.dd_pgtap_ctx where name = 'create_lock_error'),
  '22023',
  'unsupported multiplayerVersion lock is rejected at create');

-- 4. Valid create -> preview -> join -> rejoin.
set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_a1'));
with created as (
  select public.draft_duel_room_create(
    'fair', 'ratings',
    (select value::jsonb from public.dd_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.dd_pgtap_ctx (name, value)
select 'room_a', r->>'room_id' from created
union all
select 'code_a', r->>'code' from created;
reset role;
select ok(
  (select value from public.dd_pgtap_ctx where name = 'room_a') is not null,
  'room A is created with server-locked versions');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'preview_a', public.draft_duel_room_preview(
  (select value from public.dd_pgtap_ctx where name = 'code_a'))->>'room_id';
reset role;
select is(
  (select value from public.dd_pgtap_ctx where name = 'preview_a'),
  (select value from public.dd_pgtap_ctx where name = 'room_a'),
  'preview returns the room without granting access');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_stranger'));
select throws_ok(
  format('select public.draft_duel_room_preview(%L)', '9999'),
  'P0001', 'invalid-code', 'preview with an unknown code is rejected');
reset role;

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'join_a', public.draft_duel_room_join(
  (select value from public.dd_pgtap_ctx where name = 'code_a'))->>'participant_id';
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'join_a'), 'p2', 'guest joins as p2');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'rejoin_a', public.draft_duel_room_join(
  (select value from public.dd_pgtap_ctx where name = 'code_a'))->>'participant_id';
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'rejoin_a'), 'p2', 'rejoining keeps the same seat');

-- 5. Lobby validation: host-only settings, ready gating, oversized payloads.
set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'settings_guest', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'settings-guest', null,
  '{"kind":"settings","fairness":"fair","presentation":"ratings"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'settings_guest'),
  'membership', 'only the host may change settings');

update public.draft_duel_room_members set online = false
where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a') and participant_id = 'p2';
set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'start_early', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'start-early', null, '{"kind":"start"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'start_early'),
  'not-ready', 'start while the opponent is offline is rejected');
update public.draft_duel_room_members set online = true
where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a') and participant_id = 'p2';

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'start_guest', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'start-guest', null, '{"kind":"start"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'start_guest'),
  'membership', 'only the host may start the draft');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'payload_big', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'payload-big', null,
  jsonb_build_object('kind', 'ready', 'ready', true, 'pad', repeat('x', 40000)))::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'payload_big'),
  'payload-too-large', 'oversized payloads are rejected before parsing');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'ready_a1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'ready-a1', null, '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'ready_a1'),
  'true', 'host ready accepted');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'settings_a1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'settings-a1', null,
  '{"kind":"settings","fairness":"unfair","presentation":"ball-knowledge"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'settings_a1'),
  'true', 'host settings change accepted');
select is(
  (select bool_and(not ready) from public.draft_duel_room_members
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  true, 'settings changes clear both ready flags');
select is(
  (select fairness from public.draft_duel_rooms
    where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'unfair', 'settings change updates the room fairness');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'ready_a1b', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'ready-a1b', null, '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'ready_a1b'),
  'true', 'host ready after settings accepted');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'ready_a2', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'ready-a2', null, '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'ready_a2'),
  'true', 'guest ready accepted');

update public.draft_duel_room_members set ready = false
where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');
set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'start_a1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'start-a1', null, '{"kind":"start"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'start_a1'),
  'true', 'start accepted with two online seats and neither ready');
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'drafting', 'start moves the room to drafting');
select is(
  (select deadline_cursor from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  't0', 'start opens the t0 pick deadline');
select ok(
  (select draft_state->>'first_picker' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')) in ('p1', 'p2'),
  'draft_state stores the derived first picker');
select is(
  (select deadline_participant from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  (select draft_state->>'first_picker' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'the first deadline participant is the first picker');
select is(
  (select series->>'homeWinner' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')) in ('p1', 'p2'),
  true, 'start initializes the series home winner');

-- 6. Turn validation, idempotency, and claim exclusivity.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');
  v_first text := (select draft_state->>'first_picker' from public.draft_duel_rooms where id = v_room);
  v_wrong text := case when v_first = 'p1' then 'p2' else 'p1' end;
  v_receipt jsonb;
begin
  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_wrong, 'uid_a1', 'uid_a2'));
  v_receipt := public.draft_duel_command_submit(
    v_room, 'pick-a-wrong-turn', null,
    jsonb_build_object('kind', 'pick', 'pickOrdinal', 0,
      'playerId', 'pick-a-0', 'playerVersionId', 'pv-' || repeat('a', 32)));
  insert into public.dd_pgtap_ctx (name, value) values ('pick_a_wrong_turn', v_receipt::text);

  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_first, 'uid_a1', 'uid_a2'));
  v_receipt := public.draft_duel_command_submit(
    v_room, 'pick-a-wrong-ordinal', null,
    jsonb_build_object('kind', 'pick', 'pickOrdinal', 1,
      'playerId', 'pick-a-0', 'playerVersionId', 'pv-' || repeat('a', 32)));
  insert into public.dd_pgtap_ctx (name, value) values ('pick_a_wrong_ordinal', v_receipt::text);

  v_receipt := public.draft_duel_command_submit(
    v_room, 'pick-a-0', null,
    jsonb_build_object('kind', 'pick', 'pickOrdinal', 0,
      'playerId', 'pick-a-0', 'playerVersionId', 'pv-' || repeat('a', 32)));
  insert into public.dd_pgtap_ctx (name, value) values ('pick_a_first', v_receipt::text);

  v_receipt := public.draft_duel_command_submit(
    v_room, 'pick-a-0', null,
    jsonb_build_object('kind', 'pick', 'pickOrdinal', 0,
      'playerId', 'pick-a-0', 'playerVersionId', 'pv-' || repeat('a', 32)));
  insert into public.dd_pgtap_ctx (name, value) values ('pick_a_duplicate', v_receipt::text)
  on conflict (name) do update set value = excluded.value;

  v_receipt := public.draft_duel_command_submit(
    v_room, 'pick-a-0', null,
    jsonb_build_object('kind', 'pick', 'pickOrdinal', 0,
      'playerId', 'pick-a-other', 'playerVersionId', 'pv-' || repeat('b', 32)));
  insert into public.dd_pgtap_ctx (name, value) values ('pick_a_duplicate_changed', v_receipt::text)
  on conflict (name) do update set value = excluded.value;

  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_wrong, 'uid_a1', 'uid_a2'));
  v_receipt := public.draft_duel_command_submit(
    v_room, 'pick-a-claim-taken', null,
    jsonb_build_object('kind', 'pick', 'pickOrdinal', 1,
      'playerId', 'pick-a-0', 'playerVersionId', 'pv-' || repeat('a', 32)));
  insert into public.dd_pgtap_ctx (name, value) values ('pick_a_claim_taken', v_receipt::text);
end $$;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'pick_a_wrong_turn'),
  'turn', 'a pick by the non-picker is rejected with turn');
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'pick_a_wrong_ordinal'),
  'turn', 'a pick with the wrong ordinal is rejected with turn');
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'pick_a_first'),
  'true', 'the current picker lands the first pick');
select is(
  (select jsonb_array_length(draft_state->'claimed_players') from public.draft_duel_rooms
    where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  1, 'the claimed player lands in draft_state');
select is(
  (select draft_state->>'pick_ordinal' from public.draft_duel_rooms
    where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  '1', 'the pick ordinal advances monotonically');
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'pick_a_duplicate'),
  'true', 'a duplicate command id with an identical payload is accepted idempotently');
select is(
  (select value::jsonb->>'ordinal' from public.dd_pgtap_ctx where name = 'pick_a_duplicate'),
  (select value::jsonb->>'ordinal' from public.dd_pgtap_ctx where name = 'pick_a_first'),
  'the idempotent duplicate keeps the original ordinal');
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'pick_a_duplicate_changed'),
  'duplicate-command', 'a duplicate command id with a changed payload is rejected');
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'pick_a_claim_taken'),
  'claim-taken', 're-claiming a claimed player is rejected');

-- 7. Deadline fallback commit and timeout application.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');
  v_first text;
  v_other text;
  v_receipt jsonb;
begin
  select draft_state->>'first_picker' into v_first from public.draft_duel_rooms where id = v_room;
  v_other := case when v_first = 'p1' then 'p2' else 'p1' end;
  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_first, 'uid_a1', 'uid_a2'));
  v_receipt := public.draft_duel_commit_fallback(
    v_room,
    (select deadline_cursor from public.draft_duel_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-autopick', 'pickOrdinal', 1,
      'playerId', 'pick-a-1', 'playerVersionId', 'pv-' || repeat('b', 32),
      'seedPath', 'rootSeed/timeout/' || v_first || '/1'),
    null);
  insert into public.dd_pgtap_ctx (name, value) values ('commit_a_wrong_seat', v_receipt::text);

  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_other, 'uid_a1', 'uid_a2'));
  v_receipt := public.draft_duel_commit_fallback(
    v_room,
    (select deadline_cursor from public.draft_duel_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-autopick', 'pickOrdinal', 1,
      'playerId', 'pick-a-1', 'playerVersionId', 'pv-' || repeat('b', 32),
      'seedPath', 'rootSeed/timeout/' || v_other || '/1'),
    null);
  insert into public.dd_pgtap_ctx (name, value) values ('commit_a_ok', v_receipt::text);
end $$;
reset role;

update public.draft_duel_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');

set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');
  v_first text;
  v_other text;
  v_receipt jsonb;
begin
  select draft_state->>'first_picker' into v_first from public.draft_duel_rooms where id = v_room;
  v_other := case when v_first = 'p1' then 'p2' else 'p1' end;
  insert into public.dd_pgtap_ctx (name, value) values ('timeout_actor_expected', v_other);
  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_other, 'uid_a1', 'uid_a2'));
  v_receipt := public.draft_duel_command_submit(
    v_room, 'timeout-t1-1', null,
    jsonb_build_object('kind', 'timeout-autopick', 'pickOrdinal', 1,
      'playerId', 'pick-a-forged', 'playerVersionId', 'pv-' || repeat('c', 32),
      'seedPath', 'rootSeed/timeout/' || v_other || '/1'));
  insert into public.dd_pgtap_ctx (name, value) values ('submit_a_forged', v_receipt::text);

  v_receipt := public.draft_duel_command_submit(
    v_room, 'timeout-t1-1', null,
    jsonb_build_object('kind', 'timeout-autopick', 'pickOrdinal', 1,
      'playerId', 'pick-a-1', 'playerVersionId', 'pv-' || repeat('b', 32),
      'seedPath', 'rootSeed/timeout/' || v_other || '/1'));
  insert into public.dd_pgtap_ctx (name, value) values ('submit_a_canonical', v_receipt::text);
end $$;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'commit_a_wrong_seat'),
  'turn', 'only the deadline participant can commit a fallback');
select is(
  (select value::jsonb->>'stored' from public.dd_pgtap_ctx where name = 'commit_a_ok'),
  'true', 'the deadline participant commits the fallback');
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'submit_a_forged'),
  'illegal-move', 'a timeout payload that is not the stored fallback is rejected');
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'submit_a_canonical'),
  'true', 'the stored commitment applies through command submit');
select is(
  (select deadline_cursor from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  't2', 'applying a timeout advances the deadline cursor');
select is(
  (select draft_state->>'pick_ordinal' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  '2', 'applying a timeout advances the pick ordinal');
select is(
  (select actor_participant_id from public.draft_duel_room_commands
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')
      and command_id = 'timeout-t1-1'),
  (select value from public.dd_pgtap_ctx where name = 'timeout_actor_expected'),
  'the applied timeout command is attributed to the timed-out seat');

-- 8. Complete the draft through normal picks, then run a broadcast + confirmed game.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');
  v_first text := (select draft_state->>'first_picker' from public.draft_duel_rooms where id = v_room);
  v_start integer := (select (draft_state->>'pick_ordinal')::integer from public.draft_duel_rooms where id = v_room);
  v_actor text;
  v_ord integer;
begin
  for v_ord in v_start..9 loop
    v_actor := case when v_ord % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end;
    perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_actor, 'uid_a1', 'uid_a2'));
    perform public.draft_duel_command_submit(
      v_room,
      'pick-a-' || v_ord::text,
      null,
      jsonb_build_object('kind', 'pick', 'pickOrdinal', v_ord,
        'playerId', 'pick-a-' || v_ord::text, 'playerVersionId', 'pv-' || repeat('a', 32)));
  end loop;
end $$;
reset role;
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'lineup-showdown', 'ten accepted picks close the draft');
select is(
  (select deadline_at from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  null, 'closing the draft clears the pick deadline');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'rn1_a1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'rn1-a1', null, '{"kind":"ready-next-game","gameNumber":1,"ready":true}'::jsonb)::text;
reset role;
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'preparing-game', 'first next-game ready moves the room to preparing-game');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'bs1_gate', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'bs1-gate', null, '{"kind":"broadcast-start","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'bs1_gate'),
  'not-ready', 'broadcast-start is gated on both seats being ready');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'rn1_a2', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'rn1-a2', null, '{"kind":"ready-next-game","gameNumber":1,"ready":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'rn1_a2'),
  'true', 'guest next-game ready accepted');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'bs1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'bs1', null, '{"kind":"broadcast-start","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'bs1'),
  'true', 'broadcast-start accepted once both seats are ready');
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'broadcasting', 'broadcast-start moves the room to broadcasting');
select is(
  (select broadcast->>'gameNumber' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  '1', 'broadcast state records the game number');
select is(
  (select count(*)::int from public.draft_duel_room_members
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a') and next_game_ready <> 0),
  0, 'broadcast-start consumes both next-game ready flags');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'propose_a1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'propose-a1', null,
  jsonb_build_object('kind', 'propose-result', 'gameNumber', 1,
    'resultDigest', repeat('d', 64), 'tapeDigest', repeat('e', 64), 'inputDigest', repeat('f', 64),
    'winner', 'p1'))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'propose_a1'),
  'true', 'a result proposal is accepted during broadcasting');
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'game-results', 'proposing a result moves the room to game-results');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'confirm_a2', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'confirm-a2', null,
  jsonb_build_object('kind', 'confirm-result', 'gameNumber', 1,
    'resultDigest', repeat('d', 64), 'verified', true))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'confirm_a2'),
  'true', 'guest confirms the proposed result');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'confirm_a1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'confirm-a1', null,
  jsonb_build_object('kind', 'confirm-result', 'gameNumber', 1,
    'resultDigest', repeat('d', 64), 'verified', true))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'confirm_a1'),
  'true', 'host confirms the proposed result');
select is(
  (select series->>'p1Wins' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  '1', 'both confirmations record the game win');
select is(
  (select series->>'currentGameNumber' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  '2', 'a completed game advances the current game number');
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'preparing-game', 'a completed game returns the room to preparing-game');
select is(
  (select jsonb_array_length(series->'games') from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  1, 'the confirmed game lands in the series');

-- 9. Play out games 2-4 to reach the championship.
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_a');
  v_game integer;
begin
  for v_game in 2..4 loop
    perform public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
    perform public.draft_duel_command_submit(
      v_room, 'rn1-g' || v_game::text, null,
      jsonb_build_object('kind', 'ready-next-game', 'gameNumber', v_game, 'ready', true));
    perform public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
    perform public.draft_duel_command_submit(
      v_room, 'rn2-g' || v_game::text, null,
      jsonb_build_object('kind', 'ready-next-game', 'gameNumber', v_game, 'ready', true));
    perform public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
    perform public.draft_duel_command_submit(
      v_room, 'bs-g' || v_game::text, null,
      jsonb_build_object('kind', 'broadcast-start', 'gameNumber', v_game));
    perform public.draft_duel_command_submit(
      v_room, 'pr-g' || v_game::text, null,
      jsonb_build_object('kind', 'propose-result', 'gameNumber', v_game,
        'resultDigest', repeat('d', 64), 'tapeDigest', repeat('e', 64), 'inputDigest', repeat('f', 64),
        'winner', 'p1'));
    perform public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
    perform public.draft_duel_command_submit(
      v_room, 'cf2-g' || v_game::text, null,
      jsonb_build_object('kind', 'confirm-result', 'gameNumber', v_game,
        'resultDigest', repeat('d', 64), 'verified', true));
    perform public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
    perform public.draft_duel_command_submit(
      v_room, 'cf1-g' || v_game::text, null,
      jsonb_build_object('kind', 'confirm-result', 'gameNumber', v_game,
        'resultDigest', repeat('d', 64), 'verified', true));
  end loop;
end $$;
reset role;
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'championship', 'four wins reach the championship phase');
select is(
  (select series->>'champion' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'p1', 'the champion is recorded in the series');
select is(
  (select series->>'p1Wins' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  '4', 'the series score reaches four wins');
select is(
  (select jsonb_array_length(series->'games') from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  4, 'the series records every confirmed game');
select is(
  (select code from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  null, 'championship deactivates the room code');

-- 10. Verification and completion.
set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'challenge_a', public.draft_duel_verification_challenge(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'));
reset role;
select matches(
  (select value from public.dd_pgtap_ctx where name = 'challenge_a'),
  '^[0-9a-f]{64}$',
  'verification challenge is a sha256 hex nonce');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'complete_a_early', public.draft_duel_complete(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'receipt-a-missing')::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'complete_a_early'),
  'not-ready', 'completion without stored receipts is rejected');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'verify_a_bad_challenge', public.draft_duel_verification_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'receipt-a-bad',
  jsonb_set(
    public.dd_pgtap_receipt(
      (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
      (select value from public.dd_pgtap_ctx where name = 'challenge_a'),
      repeat('1', 64), repeat('2', 64)),
    '{challenge}', to_jsonb(repeat('3', 64))),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'verify_a_bad_challenge'),
  'invalid-receipt', 'a receipt with a forged challenge is rejected');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'verify_a_p1', public.draft_duel_verification_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'receipt-a-p1',
  public.dd_pgtap_receipt(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
    (select value from public.dd_pgtap_ctx where name = 'challenge_a'),
    repeat('1', 64), repeat('2', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.dd_pgtap_ctx where name = 'verify_a_p1'),
  'receipt-a-p1', 'a valid receipt is stored for the caller seat');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'verify_a_p2', public.draft_duel_verification_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'receipt-a-p2',
  public.dd_pgtap_receipt(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
    (select value from public.dd_pgtap_ctx where name = 'challenge_a'),
    repeat('1', 64), repeat('4', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.dd_pgtap_ctx where name = 'verify_a_p2'),
  'receipt-a-p2', 'the second seat stores its receipt');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p2', 'uid_a1', 'uid_a2'));
insert into public.dd_pgtap_ctx (name, value)
select 'complete_a', public.draft_duel_complete(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_a'),
  'receipt-a-p1')::text;
reset role;
select is(
  (select value::jsonb->>'completed' from public.dd_pgtap_ctx where name = 'complete_a'),
  'true', 'matching seat receipts complete the room');
select is(
  (select confirmed_digest from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  repeat('1', 64), 'completion stores the confirmed digest');
select is(
  (select bool_and(locked) from public.draft_duel_room_members
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  true, 'completion locks both seats');

-- 11. Rematch creates a fresh successor room.
set local role authenticated;
do $$
begin
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
  perform public.draft_duel_rematch((select value::uuid from public.dd_pgtap_ctx where name = 'room_a'));
  insert into public.dd_pgtap_ctx (name, value) values ('rematch_stranger', 'none');
exception when others then
  insert into public.dd_pgtap_ctx (name, value) values ('rematch_stranger', sqlerrm);
end $$;
reset role;
select is(
  (select value from public.dd_pgtap_ctx where name = 'rematch_stranger'),
  'membership', 'non-members cannot rematch a room');

set local role authenticated;
select public.dd_pgtap_claim(public.dd_pgtap_uid('p1', 'uid_a1', 'uid_a2'));
with created as (
  select public.draft_duel_rematch(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')) as r
)
insert into public.dd_pgtap_ctx (name, value)
select 'room_s', r->>'room_id' from created
union all
select 'code_s', r->>'code' from created;
reset role;
select ok(
  (select value from public.dd_pgtap_ctx where name = 'room_s') is not null,
  'rematch creates a successor room');
select isnt(
  (select value from public.dd_pgtap_ctx where name = 'room_s'),
  (select value from public.dd_pgtap_ctx where name = 'room_a'),
  'the successor is a different room');
select isnt(
  (select root_seed from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_s')),
  (select root_seed from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  'the successor carries a fresh root seed');
select matches(
  (select value from public.dd_pgtap_ctx where name = 'code_s'),
  '^[0-9]{4}$', 'the successor carries a fresh active code');
select is(
  (select successor_room_id from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_a')),
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_s'),
  'the finished room links to its successor');
select is(
  (select draft_state from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_s')),
  '{}'::jsonb, 'the successor carries no draft state');
select is(
  (select count(*)::int from public.draft_duel_room_members
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_s')),
  1, 'only the rematching seat is carried into the successor');

-- 12. Integrity failure and cron fallback in separate rooms.
set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
with created as (
  select public.draft_duel_room_create(
    'fair', 'ratings',
    (select value::jsonb from public.dd_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.dd_pgtap_ctx (name, value)
select 'room_c', r->>'room_id' from created
union all
select 'code_c', r->>'code' from created;
reset role;
select ok(
  (select value from public.dd_pgtap_ctx where name = 'room_c') is not null,
  'room C is created');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
insert into public.dd_pgtap_ctx (name, value)
select 'join_c', public.draft_duel_room_join(
  (select value from public.dd_pgtap_ctx where name = 'code_c'))->>'participant_id';
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'join_c'), 'p2', 'guest joins room C');

set local role authenticated;
do $$
begin
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_c'),
    'ready-c1', null, '{"kind":"ready","ready":true}'::jsonb);
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_c'),
    'ready-c2', null, '{"kind":"ready","ready":true}'::jsonb);
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_c'),
    'start-c1', null, '{"kind":"start"}'::jsonb);
end $$;
reset role;

set local role authenticated;
do $$
begin
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
  perform public.draft_duel_rematch((select value::uuid from public.dd_pgtap_ctx where name = 'room_c'));
  insert into public.dd_pgtap_ctx (name, value) values ('rematch_early', 'none');
exception when others then
  insert into public.dd_pgtap_ctx (name, value) values ('rematch_early', sqlerrm);
end $$;
reset role;
select is(
  (select value from public.dd_pgtap_ctx where name = 'rematch_early'),
  'phase', 'rematch before championship is rejected');

update public.draft_duel_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_c');
set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_c');
  v_first text := (select draft_state->>'first_picker' from public.draft_duel_rooms where id = v_room);
begin
  perform public.dd_pgtap_claim(public.dd_pgtap_uid(v_first, 'uid_c1', 'uid_c2'));
  perform public.draft_duel_commit_fallback(
    v_room,
    (select deadline_cursor from public.draft_duel_rooms where id = v_room),
    jsonb_build_object('kind', 'timeout-autopick', 'pickOrdinal', 0,
      'playerId', 'pick-c-0', 'playerVersionId', 'pv-' || repeat('a', 32),
      'seedPath', 'rootSeed/timeout/' || v_first || '/0'),
    null);
end $$;
reset role;
select public.draft_duel_cron_tick();
select is(
  (select deadline_cursor from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_c')),
  't1', 'cron applies committed overdue deadlines');
select is(
  (select count(*)::int from public.draft_duel_room_commands
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_c')
      and command_id = 'timeout-t0-0'),
  1, 'cron stores exactly one canonical timeout command');

-- 13. Code expiry and RLS denial.
update public.draft_duel_rooms set code_expires_at = now() - interval '1 minute', code_active = true
  where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_c');
select public.draft_duel_cron_tick();
select is(
  (select code_active from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_c')),
  false, 'cron deactivates expired codes');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
select throws_ok(
  format('select public.draft_duel_room_join(%L)', (select value from public.dd_pgtap_ctx where name = 'code_c')),
  'P0001', 'invalid-code', 'an expired code no longer joins');
reset role;

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_stranger'));
insert into public.dd_pgtap_ctx (name, value)
select 'stranger_rooms', count(*)::text from public.draft_duel_rooms;
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'stranger_rooms'), '0', 'strangers cannot read rooms');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_stranger'));
insert into public.dd_pgtap_ctx (name, value)
select 'stranger_members', count(*)::text from public.draft_duel_room_members;
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'stranger_members'), '0', 'strangers cannot read memberships');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_stranger'));
insert into public.dd_pgtap_ctx (name, value)
select 'stranger_commands', count(*)::text from public.draft_duel_room_commands;
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'stranger_commands'), '0', 'strangers cannot read commands');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_stranger'));
select throws_ok(
  format(
    'select public.draft_duel_command_submit(%L::uuid, %L, null, %L::jsonb)',
    (select value from public.dd_pgtap_ctx where name = 'room_a'),
    'stranger-command',
    '{"kind":"ready","ready":true}'),
  'P0001', 'membership', 'strangers cannot submit commands to a room');

select public.dd_pgtap_clear_claim();
select throws_ok(
  format(
    'select public.draft_duel_commit_fallback(%L::uuid, %L, %L::jsonb, null)',
    (select value from public.dd_pgtap_ctx where name = 'room_a'),
    't0',
    '{"kind":"timeout-autopick","pickOrdinal":0,"playerId":"x","playerVersionId":"pv-00000000000000000000000000000000","seedPath":"x"}'),
  '28000', 'anonymous session required', 'anonymous callers are rejected');

-- 14. Fail path: disagreeing receipts.
set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_b1'));
with created as (
  select public.draft_duel_room_create(
    'fair', 'ratings',
    (select value::jsonb from public.dd_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.dd_pgtap_ctx (name, value)
select 'room_b', r->>'room_id' from created
union all
select 'code_b', r->>'code' from created;
reset role;
select ok(
  (select value from public.dd_pgtap_ctx where name = 'room_b') is not null,
  'room B is created');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_b2'));
insert into public.dd_pgtap_ctx (name, value)
select 'join_b', public.draft_duel_room_join(
  (select value from public.dd_pgtap_ctx where name = 'code_b'))->>'participant_id';
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'join_b'), 'p2', 'guest joins room B');

update public.draft_duel_rooms set phase = 'championship' where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_b');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_b1'));
insert into public.dd_pgtap_ctx (name, value)
select 'challenge_b', public.draft_duel_verification_challenge(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_b'));
reset role;
select matches(
  (select value from public.dd_pgtap_ctx where name = 'challenge_b'),
  '^[0-9a-f]{64}$',
  'room B challenge is a sha256 hex nonce');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_b1'));
insert into public.dd_pgtap_ctx (name, value)
select 'receipt_b1', public.draft_duel_verification_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_b'),
  'receipt-b1',
  public.dd_pgtap_receipt(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_b'),
    (select value from public.dd_pgtap_ctx where name = 'challenge_b'),
    repeat('5', 64), repeat('1', 64)),
  null)::text;
reset role;

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_b2'));
insert into public.dd_pgtap_ctx (name, value)
select 'receipt_b2', public.draft_duel_verification_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_b'),
  'receipt-b2',
  public.dd_pgtap_receipt(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_b'),
    (select value from public.dd_pgtap_ctx where name = 'challenge_b'),
    repeat('5', 64), repeat('2', 64)),
  null)::text;
reset role;

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_b1'));
insert into public.dd_pgtap_ctx (name, value)
select 'fail_b', public.draft_duel_fail(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_b'))::text;
reset role;
select is(
  (select value::jsonb->>'failed' from public.dd_pgtap_ctx where name = 'fail_b'),
  'true', 'disagreeing receipts fail the room');
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_b')),
  'integrity-failed', 'receipt disagreement sets integrity-failed');

-- 15. Auto-start after a 60-second idle window (room D).
set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
with created as (
  select public.draft_duel_room_create(
    'fair', 'ratings',
    (select value::jsonb from public.dd_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.dd_pgtap_ctx (name, value)
select 'room_d', r->>'room_id' from created
union all
select 'code_d', r->>'code' from created;
reset role;
select ok(
  (select value from public.dd_pgtap_ctx where name = 'room_d') is not null,
  'room D is created');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
insert into public.dd_pgtap_ctx (name, value)
select 'join_d', public.draft_duel_room_join(
  (select value from public.dd_pgtap_ctx where name = 'code_d'))->>'participant_id';
reset role;
select is((select value from public.dd_pgtap_ctx where name = 'join_d'), 'p2', 'guest joins room D');

set local role authenticated;
do $$
begin
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
    'ready-d1', null, '{"kind":"ready","ready":true}'::jsonb);
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
    'ready-d2', null, '{"kind":"ready","ready":true}'::jsonb);
  perform public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
    'start-d1', null, '{"kind":"start"}'::jsonb);
end $$;
reset role;

set local role authenticated;
do $$
declare
  v_room uuid := (select value::uuid from public.dd_pgtap_ctx where name = 'room_d');
  v_first text := (select draft_state->>'first_picker' from public.draft_duel_rooms where id = v_room);
  v_ord integer;
begin
  for v_ord in 0..9 loop
    perform public.dd_pgtap_claim(public.dd_pgtap_uid(
      case when v_ord % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end,
      'uid_c1', 'uid_c2'));
    perform public.draft_duel_command_submit(
      v_room,
      'pick-d-' || v_ord::text,
      null,
      jsonb_build_object('kind', 'pick', 'pickOrdinal', v_ord,
        'playerId', 'pick-d-' || v_ord::text, 'playerVersionId', 'pv-' || repeat('a', 32)));
  end loop;
end $$;
reset role;

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c1'));
insert into public.dd_pgtap_ctx (name, value)
select 'auto_rn_d1', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
  'rn1-d1', null, '{"kind":"ready-next-game","gameNumber":1,"ready":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'auto_rn_d1'),
  'true', 'one ready seat moves room D to preparing-game');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
insert into public.dd_pgtap_ctx (name, value)
select 'auto_bs_manual', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
  'bs-d-manual', null, '{"kind":"broadcast-start","gameNumber":1}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'auto_bs_manual'),
  'not-ready', 'broadcast-start without auto waits for the missing seat');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
insert into public.dd_pgtap_ctx (name, value)
select 'auto_bs_early', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
  'bs-d-early', null, '{"kind":"broadcast-start","gameNumber":1,"auto":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.dd_pgtap_ctx where name = 'auto_bs_early'),
  'not-ready', 'auto start is rejected before the idle window');

update public.draft_duel_rooms set updated_at = now() - interval '61 seconds'
  where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_d');

set local role authenticated;
select public.dd_pgtap_claim((select value from public.dd_pgtap_ctx where name = 'uid_c2'));
insert into public.dd_pgtap_ctx (name, value)
select 'auto_bs_ok', public.draft_duel_command_submit(
  (select value::uuid from public.dd_pgtap_ctx where name = 'room_d'),
  'bs-d-auto', null, '{"kind":"broadcast-start","gameNumber":1,"auto":true}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.dd_pgtap_ctx where name = 'auto_bs_ok'),
  'true', 'auto start is accepted after the idle window');
select is(
  (select phase from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_d')),
  'broadcasting', 'auto start applies the normal broadcast phase');
select is(
  (select broadcast->>'gameNumber' from public.draft_duel_rooms where id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_d')),
  '1', 'auto start records the broadcast game number');
select is(
  (select count(*)::int from public.draft_duel_room_members
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_d') and next_game_ready <> 0),
  0, 'auto start consumes both next-game ready flags');
select is(
  (select count(*)::int from public.draft_duel_room_commands
    where room_id = (select value::uuid from public.dd_pgtap_ctx where name = 'room_d')
      and payload->>'kind' = 'ready-next-game'
      and actor_participant_id = 'p2'),
  0, 'the idle seat never readied before the auto start');

select * from finish();
rollback;
