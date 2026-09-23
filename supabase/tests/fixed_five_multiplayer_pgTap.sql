-- pgTAP tests for M2.8 Fixed-Five live multiplayer.
-- Run with: supabase test db
--
-- Behavioral RPC calls run as the authenticated role with request.jwt.claims
-- set (the fixed-five RPCs read auth.uid()). Assertions run as the session
-- role (postgres in supabase test db) and read the captured receipts from a
-- scratch table, so pgTAP state is never role-switched.

begin;
select plan(127);

-- 1. Schema.
select has_table('public', 'fixed_five_rooms', 'fixed_five_rooms exists');
select has_table('public', 'fixed_five_room_members', 'members exists');
select has_table('public', 'fixed_five_room_commands', 'commands exists');
select has_table('public', 'fixed_five_join_attempts', 'join attempts exists');
select has_table('public', 'fixed_five_deadline_commitments', 'deadline commitments exists');
select has_table('public', 'fixed_five_server_versions', 'server versions exists');
select has_table('public', 'fixed_five_verification_receipts', 'verification receipts exists');

select col_type_is('public', 'fixed_five_rooms', 'code', 'text', 'code is text preserving leading zeroes');
select has_check('public', 'fixed_five_rooms', 'fixed_five_rooms_code_check', 'code check enforces four digits');
select has_check('public', 'fixed_five_rooms', 'fixed_five_rooms_mode_check', 'mode check');
select has_check('public', 'fixed_five_rooms', 'fixed_five_rooms_phase_check', 'phase check');

select has_index('public', 'fixed_five_rooms', 'fixed_five_rooms_active_code_uidx', 'partial unique active code index exists');
select has_index('public', 'fixed_five_room_commands', 'fixed_five_room_commands_room_ordinal_idx', 'command ordinal index exists');
select has_pk('public', 'fixed_five_deadline_commitments', 'deadline commitments primary key exists');
select has_pk('public', 'fixed_five_verification_receipts', 'verification receipts primary key exists');
select col_is_pk('public', 'fixed_five_server_versions', 'key', 'server versions key is the primary key');

select has_policy('public', 'fixed_five_rooms', 'ff members read their room');
select has_policy('public', 'fixed_five_room_commands', 'ff members read their commands');
select has_policy('public', 'fixed_five_deadline_commitments', 'ff members read deadline commitments');
select has_policy('public', 'fixed_five_verification_receipts', 'ff members read verification receipts');

-- No direct-write policies: only select policies should exist for anon/authenticated.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_rooms' and cmd <> 'SELECT'),
  0, 'no direct client writes to rooms');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_room_commands' and cmd <> 'SELECT'),
  0, 'no direct client writes to commands');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_deadline_commitments' and cmd <> 'SELECT'),
  0, 'no direct client writes to deadline commitments');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_verification_receipts' and cmd <> 'SELECT'),
  0, 'no direct client writes to verification receipts');

select is(
  (select relrowsecurity from pg_class where oid = 'public.fixed_five_deadline_commitments'::regclass),
  true, 'deadline commitments have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.fixed_five_verification_receipts'::regclass),
  true, 'verification receipts have RLS enabled');
select is(
  (select relrowsecurity from pg_class where oid = 'public.fixed_five_server_versions'::regclass),
  true, 'server versions have RLS enabled');

select has_function('public', 'fixed_five_room_create', array['text','text','text','jsonb'], 'create exists');
select has_function('public', 'fixed_five_room_preview', array['text'], 'preview exists');
select has_function('public', 'fixed_five_room_join', array['text'], 'join exists');
select has_function('public', 'fixed_five_command_submit', array['uuid','text','integer','text','jsonb'], 'command submit exists');
select has_function('public', 'fixed_five_commit_fallback', array['uuid','text','jsonb','integer'], 'commit fallback exists');
select has_function('public', 'fixed_five_timeout_resolve', array['uuid'], 'timeout resolve exists');
select has_function('public', 'fixed_five_verification_challenge', array['uuid'], 'verification challenge exists');
select has_function('public', 'fixed_five_verification_submit', array['uuid','text','jsonb','integer'], 'verification submit exists');
select has_function('public', 'fixed_five_complete', array['uuid','text'], 'complete takes a receipt id');
select has_function('public', 'fixed_five_fail', array['uuid'], 'fail exists');
select has_function('public', 'fixed_five_guest_remove', array['uuid','text'], 'guest remove exists');
select has_function('public', 'fixed_five_is_member', array['uuid'], 'membership helper exists');
select has_function('public', 'fixed_five_versions_valid', array['jsonb'], 'version lock helper exists');
select has_function('public', 'fixed_five_cron_tick', array[]::text[], 'cron exists');
select has_policy('public', 'fixed_five_room_members', 'ff members read room membership');
select col_type_is('public', 'fixed_five_server_versions', 'value', 'text', 'server version values are text');
select has_function('public', 'fixed_five_random_code', array[]::text[], 'cryptographic room-code generator exists');
select is(
  has_function_privilege('authenticated', 'public.fixed_five_room_create(text,text,text,jsonb)', 'EXECUTE'),
  true, 'authenticated can create fixed-five rooms');
select is(
  has_function_privilege('anon', 'public.fixed_five_room_create(text,text,text,jsonb)', 'EXECUTE'),
  false, 'anon cannot create fixed-five rooms');
select is(
  (select count(*)::int
   from pg_proc p
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
   where p.oid = 'public.fixed_five_room_create(text,text,text,jsonb)'::regprocedure
     and acl.grantee = 0
     and acl.privilege_type = 'EXECUTE'),
  0, 'room creation is not executable by PUBLIC');
select is(
  has_function_privilege('authenticated', 'public.fixed_five_random_code()', 'EXECUTE'),
  false, 'authenticated cannot call the internal room-code generator');
select is(
  has_function_privilege('anon', 'public.fixed_five_random_code()', 'EXECUTE'),
  false, 'anon cannot call the internal room-code generator');
select matches(public.fixed_five_random_code(), '^[0-9]{4}$', 'generated room codes preserve four digits');
select is(
  (select count(distinct public.fixed_five_random_code()) > 100 from generate_series(1, 128)),
  true, 'generated room codes have broad sample diversity');
select ok(
  position('extensions.gen_random_bytes' in pg_get_functiondef('public.fixed_five_random_code()'::regprocedure)) > 0,
  'room-code entropy comes from pgcrypto');
select is(
  position('random()' in pg_get_functiondef('public.fixed_five_random_code()'::regprocedure)),
  0, 'room-code generator does not use PostgreSQL random()');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_room_members' and cmd <> 'SELECT'),
  0, 'memberships have no direct client write policies');
select is(
  (select relrowsecurity from pg_class where oid = 'public.fixed_five_room_members'::regclass),
  true, 'room memberships have RLS enabled');
select ok(to_regprocedure('public.season_room_create(text,text)') is null, 'legacy season room-create RPC is removed');
select ok(to_regprocedure('public.season_room_create(text,text,text)') is null, 'legacy season room-create mode overload is removed');

-- 2. Behavioral harness.
create table public.ff_pgtap_ctx (name text primary key, value text);
grant select, insert, update, delete on public.ff_pgtap_ctx to authenticated;

create function public.ff_pgtap_claim(p_uid text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

create function public.ff_pgtap_clear_claim() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function public.ff_pgtap_receipt(
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
      from public.fixed_five_room_commands c
      where c.room_id = p_room_id
    ),
    'gameSeeds', jsonb_build_array(
      jsonb_build_object('gameNumber', 1, 'seed', 'seed-pgtap-1', 'tag', 'h2h')
    ),
    'resultDigest', p_result_digest,
    'receiptDigest', p_receipt_digest
  )
  from public.fixed_five_rooms r
  where r.id = p_room_id;
$$;

insert into public.ff_pgtap_ctx (name, value) values
  ('versions', '{"dataVersion":"data-v1","ratingVersion":"ratings-v3.12","positionNormalizationVersion":"position-v3","engineVersion":"m3-engine-v22","bracketVersion":"bracket-m3-v4","scheduleVersion":"schedule-v1","seedDerivationVersion":"seed-v1","classicRollVersion":"classic-roll-v1","profileVersion":"2010s-fixed-v1","multiplayerVersion":"fixed-five-multiplayer-v3","autopickVersion":"fixed-five-autopick-v1"}'),
  ('uid_a1', '00000000-0000-4000-8000-000000000001'),
  ('uid_a2', '00000000-0000-4000-8000-000000000002'),
  ('uid_b1', '00000000-0000-4000-8000-000000000003'),
  ('uid_b2', '00000000-0000-4000-8000-000000000004'),
  ('uid_c1', '00000000-0000-4000-8000-000000000005'),
  ('uid_c2', '00000000-0000-4000-8000-000000000006'),
  ('uid_stranger', '00000000-0000-4000-8000-000000000099');

-- 3. Server version locks reject unsupported values at create.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
do $$
begin
  perform public.fixed_five_room_create(
    'classic-shared-82', 'classic', 'ratings',
    jsonb_set(
      (select value::jsonb from public.ff_pgtap_ctx where name = 'versions'),
      '{engineVersion}', '"m3-engine-v14"'
    )
  );
  insert into public.ff_pgtap_ctx (name, value) values ('create_lock_error', 'none');
exception when others then
  insert into public.ff_pgtap_ctx (name, value) values ('create_lock_error', sqlstate);
end $$;
reset role;
select is(
  (select value from public.ff_pgtap_ctx where name = 'create_lock_error'),
  '22023',
  'unsupported engineVersion lock is rejected at create');

-- 4. Valid create -> join -> ready -> start.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
with created as (
  select public.fixed_five_room_create(
    'classic-shared-82', 'classic', 'ratings',
    (select value::jsonb from public.ff_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.ff_pgtap_ctx (name, value)
select 'room_a', r->>'room_id' from created
union all
select 'code_a', r->>'code' from created;
reset role;
select ok(
  (select value from public.ff_pgtap_ctx where name = 'room_a') is not null,
  'room A is created with server-locked versions');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a2'));
insert into public.ff_pgtap_ctx (name, value)
select 'join_a', public.fixed_five_room_join(
  (select value from public.ff_pgtap_ctx where name = 'code_a'))->>'participant_id';
reset role;
select is((select value from public.ff_pgtap_ctx where name = 'join_a'), 'p2', 'guest joins as p2');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'ready_a1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'ready-a1', null, 'p1', '{"kind":"ready","ready":true}'::jsonb)->>'accepted';
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'ready_a1'), 'true', 'host ready accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a2'));
insert into public.ff_pgtap_ctx (name, value)
select 'ready_a2', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'ready-a2', null, 'p2', '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'ready_a2'), 'true', 'guest ready accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'start_a1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'start-a1', null, 'p1', '{"kind":"start"}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'start_a1'), 'true', 'start accepted');
select is(
  (select phase from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  'drafting', 'start moves the room to drafting');
select is(
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  't0', 'start opens a drafting deadline cursor');
select is(
  (select deadline_participant from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  'p1', 'drafting deadline starts with p1');
select is(
  (select deadline_pick_ordinal from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  0, 'drafting deadline starts at pick ordinal 0');

-- 5. Resolve with no commitment returns no-commitment.
update public.fixed_five_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a');
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'resolve_a_none', public.fixed_five_timeout_resolve(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'resolve_a_none'),
  'false', 'resolve without a commitment is not accepted');
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'resolve_a_none'),
  'no-commitment', 'resolve without a commitment reports no-commitment');

-- 6. Commit fallback guards.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a2'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a2_wrong_seat', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  '{"kind":"timeout-autopick","playerId":"p2-fallback","slotIndex":0,"pickOrdinal":0,"seedPath":"fallback/p2/0"}'::jsonb,
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'commit_a2_wrong_seat'),
  'turn', 'only the deadline participant can commit a fallback');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a1_wrong_cursor', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'stale-cursor',
  '{"kind":"timeout-autopick","playerId":"p1-fallback","slotIndex":0,"pickOrdinal":0,"seedPath":"fallback/p1/0"}'::jsonb,
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'commit_a1_wrong_cursor'),
  'turn', 'commit with the wrong cursor is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a1_wrong_ordinal', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  '{"kind":"timeout-autopick","playerId":"p1-fallback","slotIndex":0,"pickOrdinal":5,"seedPath":"fallback/p1/0"}'::jsonb,
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'commit_a1_wrong_ordinal'),
  'turn', 'commit with the wrong pick ordinal is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a1_stale', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  '{"kind":"timeout-autopick","playerId":"p1-fallback","slotIndex":0,"pickOrdinal":0,"seedPath":"fallback/p1/0"}'::jsonb,
  0)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'commit_a1_stale'),
  'stale-revision', 'commit with a stale revision is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a1', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  '{"kind":"timeout-autopick","playerId":"p1-fallback","slotIndex":2,"pickOrdinal":0,"seedPath":"fallback/p1/0"}'::jsonb,
  null)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'commit_a1'),
  'true', 'deadline participant commits the fallback');
select is(
  (select deadline_fallback->>'playerId' from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  'p1-fallback', 'commit stores the exact fallback payload on the room');

-- 7. Forged timeout-autopick payloads are rejected; the canonical one applies.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'submit_a_forged', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'timeout-t0-0', null, 'p1',
  '{"kind":"timeout-autopick","playerId":"forged-player","slotIndex":2,"pickOrdinal":0,"seedPath":"fallback/p1/0"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejection_code' from public.ff_pgtap_ctx where name = 'submit_a_forged'),
  'illegal-move', 'a timeout payload that is not the stored fallback is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'submit_a_old_id', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'timeout-classic-shared-82-p1-0', null, 'p1',
  '{"kind":"timeout-autopick","playerId":"p1-fallback","slotIndex":2,"pickOrdinal":0,"seedPath":"fallback/p1/0"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'rejection_code' from public.ff_pgtap_ctx where name = 'submit_a_old_id'),
  'illegal-move', 'the old timeout-<mode>-<actor>-<ordinal> command id is gone');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'submit_a_canonical', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  'timeout-t0-0', null, 'p1',
  '{"kind":"timeout-autopick","playerId":"p1-fallback","slotIndex":2,"pickOrdinal":0,"seedPath":"fallback/p1/0"}'::jsonb)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'submit_a_canonical'),
  'true', 'the stored commitment applies through command submit');
select is(
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  't1', 'applying a timeout advances the deadline cursor');
select is(
  (select deadline_participant from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  'p2', 'applying a timeout alternates the deadline participant');
select is(
  (select deadline_pick_ordinal from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  1, 'applying a timeout increments the deadline ordinal');
select is(
  (select deadline_fallback from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  null, 'applying a timeout clears the fallback');
select is(
  (select actor_participant_id from public.fixed_five_room_commands
    where room_id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')
      and command_id = 'timeout-t0-0'),
  'p1', 'the applied timeout command is attributed to the timed-out seat');

-- 8. The next seat commits and any member resolves it.
update public.fixed_five_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a');
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a2'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a2', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  '{"kind":"timeout-autopick","playerId":"p2-fallback","slotIndex":1,"pickOrdinal":1,"seedPath":"fallback/p2/0"}'::jsonb,
  null)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'commit_a2'),
  'true', 'the second deadline participant commits a fallback');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'resolve_a2', public.fixed_five_timeout_resolve(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'))::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'resolve_a2'),
  'true', 'an overdue committed deadline resolves');
select is(
  (select value::jsonb->>'commandId' from public.ff_pgtap_ctx where name = 'resolve_a2'),
  'timeout-t1-1', 'resolve applies the canonical timeout command id');
select is(
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  't2', 'resolve advances the deadline cursor atomically');
select is(
  (select deadline_participant from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  'p1', 'resolve alternates the deadline participant');
select is(
  (select deadline_pick_ordinal from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  2, 'resolve increments the deadline ordinal');
select is(
  (select actor_participant_id from public.fixed_five_room_commands
    where room_id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')
      and command_id = 'timeout-t1-1'),
  'p2', 'resolve attributes the command to the stored commitment seat');

-- 9. Member and anonymous guards.
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_stranger'));
select throws_ok(
  format(
    'select public.fixed_five_verification_challenge(%L::uuid)',
    (select value from public.ff_pgtap_ctx where name = 'room_a')),
  'P0001', 'membership', 'non-members cannot read the verification challenge');
select public.ff_pgtap_clear_claim();
select throws_ok(
  format(
    'select public.fixed_five_commit_fallback(%L::uuid, %L, %L::jsonb, null)',
    (select value from public.ff_pgtap_ctx where name = 'room_a'),
    'drafting',
    '{"kind":"timeout-autopick","playerId":"x","slotIndex":0,"pickOrdinal":0,"seedPath":"x"}'),
  '28000', 'anonymous session required', 'anonymous callers are rejected');

-- 10. Cron resolves committed overdue drafting rooms server-side.
update public.fixed_five_rooms set deadline_at = now() - interval '5 seconds'
  where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a');
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_a1'));
insert into public.ff_pgtap_ctx (name, value)
select 'commit_a1_cron', public.fixed_five_commit_fallback(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_a'),
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  '{"kind":"timeout-autopick","playerId":"p1-fallback-3","slotIndex":3,"pickOrdinal":2,"seedPath":"fallback/p1/2"}'::jsonb,
  null)::text;
reset role;
select is(
  (select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'commit_a1_cron'),
  'true', 'the third deadline participant commits a fallback');
select public.fixed_five_cron_tick();
select is(
  (select deadline_cursor from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')),
  't3', 'cron applies committed overdue deadlines');
select is(
  (select actor_participant_id from public.fixed_five_room_commands
    where room_id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_a')
      and command_id = 'timeout-t2-2'),
  'p1', 'cron attributes the command to the stored commitment seat');

-- 11. Verification flow for room B.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
with created as (
  select public.fixed_five_room_create(
    'classic-shared-82', 'classic', 'ratings',
    (select value::jsonb from public.ff_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.ff_pgtap_ctx (name, value)
select 'room_b', r->>'room_id' from created
union all
select 'code_b', r->>'code' from created;
reset role;
select ok(
  (select value from public.ff_pgtap_ctx where name = 'room_b') is not null,
  'room B is created');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b2'));
insert into public.ff_pgtap_ctx (name, value)
select 'join_b', public.fixed_five_room_join(
  (select value from public.ff_pgtap_ctx where name = 'code_b'))->>'participant_id';
reset role;
select is((select value from public.ff_pgtap_ctx where name = 'join_b'), 'p2', 'guest joins room B');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'ready_b1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'ready-b1', null, 'p1', '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'ready_b1'), 'true', 'room B host ready accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b2'));
insert into public.ff_pgtap_ctx (name, value)
select 'ready_b2', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'ready-b2', null, 'p2', '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'ready_b2'), 'true', 'room B guest ready accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'start_b1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'start-b1', null, 'p1', '{"kind":"start"}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'start_b1'), 'true', 'room B start accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'propose_b1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'propose-b1', null, 'p1',
  jsonb_build_object('kind', 'propose-result', 'resultDigest', repeat('a', 64)))::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'propose_b1'), 'true', 'result proposal accepted');
select is(
  (select phase from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_b')),
  'awaiting-confirmation', 'proposal moves the room to awaiting-confirmation');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'confirm_b1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'confirm-b1', null, 'p1',
  jsonb_build_object('kind', 'confirm-result', 'resultDigest', repeat('a', 64), 'verified', true))::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'confirm_b1'), 'true', 'host confirms the result');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b2'));
insert into public.ff_pgtap_ctx (name, value)
select 'confirm_b2', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'confirm-b2', null, 'p2',
  jsonb_build_object('kind', 'confirm-result', 'resultDigest', repeat('a', 64), 'verified', true))::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'confirm_b2'), 'true', 'guest confirms the result');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'challenge_b', public.fixed_five_verification_challenge(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'));
reset role;
select matches(
  (select value from public.ff_pgtap_ctx where name = 'challenge_b'),
  '^[0-9a-f]{64}$',
  'verification challenge is a sha256 hex nonce');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'complete_b_early', public.fixed_five_complete(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-missing')::text;
reset role;
select is(
  (select value::jsonb->>'completed' from public.ff_pgtap_ctx where name = 'complete_b_early'),
  'false', 'completion without a stored receipt is rejected');
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'complete_b_early'),
  'not-ready', 'completion without a stored receipt reports not-ready');

-- 12. Forged receipts are rejected; the real receipt completes the room.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'verify_b_bad_challenge', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-bad-challenge',
  jsonb_set(
    public.ff_pgtap_receipt(
      (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
      (select value from public.ff_pgtap_ctx where name = 'challenge_b'),
      repeat('a', 64), repeat('b', 64)),
    '{challenge}', to_jsonb(repeat('c', 64))),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'verify_b_bad_challenge'),
  'invalid-receipt', 'a receipt with a forged challenge is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'verify_b_bad_commands', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-bad-commands',
  jsonb_set(
    public.ff_pgtap_receipt(
      (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
      (select value from public.ff_pgtap_ctx where name = 'challenge_b'),
      repeat('a', 64), repeat('b', 64)),
    '{commandIds}', '["forged-command"]'::jsonb),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'verify_b_bad_commands'),
  'invalid-receipt', 'a receipt with forged command ids is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'verify_b_bad_seed', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-bad-seed',
  jsonb_set(
    public.ff_pgtap_receipt(
      (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
      (select value from public.ff_pgtap_ctx where name = 'challenge_b'),
      repeat('a', 64), repeat('b', 64)),
    '{rootSeed}', to_jsonb('forged-seed')),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'verify_b_bad_seed'),
  'invalid-receipt', 'a receipt with a forged root seed is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'verify_b_stale', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-stale',
  public.ff_pgtap_receipt(
    (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
    (select value from public.ff_pgtap_ctx where name = 'challenge_b'),
    repeat('a', 64), repeat('b', 64)),
  99)::text;
reset role;
select is(
  (select value::jsonb->>'rejectionCode' from public.ff_pgtap_ctx where name = 'verify_b_stale'),
  'stale-revision', 'verification submit with a stale revision is rejected');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'verify_b_ok', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-final',
  public.ff_pgtap_receipt(
    (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
    (select value from public.ff_pgtap_ctx where name = 'challenge_b'),
    repeat('a', 64), repeat('b', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.ff_pgtap_ctx where name = 'verify_b_ok'),
  'receipt-b-final', 'a valid receipt is stored for the caller seat');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_b1'));
insert into public.ff_pgtap_ctx (name, value)
select 'complete_b', public.fixed_five_complete(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_b'),
  'receipt-b-final')::text;
reset role;
select is(
  (select value::jsonb->>'completed' from public.ff_pgtap_ctx where name = 'complete_b'),
  'true', 'a challenge-bound receipt with two verified confirmations completes the room');
select is(
  (select phase from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_b')),
  'completed', 'completed room phase is set');
select is(
  (select result_digest from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_b')),
  repeat('a', 64), 'result digest comes from the stored receipt');

-- 13. Disagreeing receipts fail the room.
set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
with created as (
  select public.fixed_five_room_create(
    'classic-shared-82', 'classic', 'ratings',
    (select value::jsonb from public.ff_pgtap_ctx where name = 'versions')
  ) as r
)
insert into public.ff_pgtap_ctx (name, value)
select 'room_c', r->>'room_id' from created
union all
select 'code_c', r->>'code' from created;
reset role;
select ok(
  (select value from public.ff_pgtap_ctx where name = 'room_c') is not null,
  'room C is created');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c2'));
insert into public.ff_pgtap_ctx (name, value)
select 'join_c', public.fixed_five_room_join(
  (select value from public.ff_pgtap_ctx where name = 'code_c'))->>'participant_id';
reset role;
select is((select value from public.ff_pgtap_ctx where name = 'join_c'), 'p2', 'guest joins room C');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
insert into public.ff_pgtap_ctx (name, value)
select 'ready_c1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'ready-c1', null, 'p1', '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'ready_c1'), 'true', 'room C host ready accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c2'));
insert into public.ff_pgtap_ctx (name, value)
select 'ready_c2', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'ready-c2', null, 'p2', '{"kind":"ready","ready":true}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'ready_c2'), 'true', 'room C guest ready accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
insert into public.ff_pgtap_ctx (name, value)
select 'start_c1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'start-c1', null, 'p1', '{"kind":"start"}'::jsonb)::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'start_c1'), 'true', 'room C start accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
insert into public.ff_pgtap_ctx (name, value)
select 'propose_c1', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'propose-c1', null, 'p1',
  jsonb_build_object('kind', 'propose-result', 'resultDigest', repeat('d', 64)))::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'propose_c1'), 'true', 'room C result proposal accepted');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c2'));
insert into public.ff_pgtap_ctx (name, value)
select 'confirm_c2', public.fixed_five_command_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'confirm-c2', null, 'p2',
  jsonb_build_object('kind', 'confirm-result', 'resultDigest', repeat('d', 64), 'verified', true))::text;
reset role;
select is((select value::jsonb->>'accepted' from public.ff_pgtap_ctx where name = 'confirm_c2'), 'true', 'room C guest confirms the result');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
insert into public.ff_pgtap_ctx (name, value)
select 'challenge_c', public.fixed_five_verification_challenge(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'));
reset role;
select matches(
  (select value from public.ff_pgtap_ctx where name = 'challenge_c'),
  '^[0-9a-f]{64}$',
  'room C challenge is a sha256 hex nonce');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
insert into public.ff_pgtap_ctx (name, value)
select 'receipt_c1', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'receipt-c1',
  public.ff_pgtap_receipt(
    (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
    (select value from public.ff_pgtap_ctx where name = 'challenge_c'),
    repeat('d', 64), repeat('1', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.ff_pgtap_ctx where name = 'receipt_c1'),
  'receipt-c1', 'room C host receipt stored');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c2'));
insert into public.ff_pgtap_ctx (name, value)
select 'receipt_c2', public.fixed_five_verification_submit(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
  'receipt-c2',
  public.ff_pgtap_receipt(
    (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'),
    (select value from public.ff_pgtap_ctx where name = 'challenge_c'),
    repeat('d', 64), repeat('2', 64)),
  null)::text;
reset role;
select is(
  (select value::jsonb->>'receiptId' from public.ff_pgtap_ctx where name = 'receipt_c2'),
  'receipt-c2', 'room C guest receipt stored');

set local role authenticated;
select public.ff_pgtap_claim((select value from public.ff_pgtap_ctx where name = 'uid_c1'));
insert into public.ff_pgtap_ctx (name, value)
select 'fail_c1', public.fixed_five_fail(
  (select value::uuid from public.ff_pgtap_ctx where name = 'room_c'))::text;
reset role;
select is(
  (select value::jsonb->>'failed' from public.ff_pgtap_ctx where name = 'fail_c1'),
  'true', 'disagreeing receipts fail the room');
select is(
  (select phase from public.fixed_five_rooms where id = (select value::uuid from public.ff_pgtap_ctx where name = 'room_c')),
  'integrity-failed', 'receipt disagreement sets integrity-failed');

select * from finish();
rollback;
