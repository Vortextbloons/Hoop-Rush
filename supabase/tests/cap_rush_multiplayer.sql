-- pgTAP tests for Cap Rush multiplayer coordination.
-- Run with: supabase test db

begin;
select plan(47);

-- 1. Schema and policies.
select has_table('public', 'cap_rush_multiplayer_rooms', 'rooms exist');
select has_table('public', 'cap_rush_multiplayer_room_members', 'members exist');
select has_table('public', 'cap_rush_multiplayer_room_commands', 'commands exist');
select has_table('public', 'cap_rush_multiplayer_verification_receipts', 'receipts exist');
select has_table('public', 'cap_rush_multiplayer_join_attempts', 'join attempts exist');

select col_type_is('public', 'cap_rush_multiplayer_rooms', 'code', 'text', 'code preserves leading zeroes');
select col_type_is('public', 'cap_rush_multiplayer_rooms', 'state', 'jsonb', 'state is jsonb');
select col_type_is('public', 'cap_rush_multiplayer_rooms', 'settings', 'jsonb', 'settings is jsonb');

select has_index('public', 'cap_rush_multiplayer_rooms', 'cap_rush_multiplayer_rooms_active_code', 'active code index exists');
select has_index('public', 'cap_rush_multiplayer_room_commands', 'cap_rush_multiplayer_commands_ordinal', 'command ordinal index exists');

select has_pk('public', 'cap_rush_multiplayer_rooms', 'rooms primary key exists');
select has_pk('public', 'cap_rush_multiplayer_room_members', 'members primary key exists');
select has_pk('public', 'cap_rush_multiplayer_room_commands', 'commands primary key exists');
select has_pk('public', 'cap_rush_multiplayer_verification_receipts', 'receipts primary key exists');

select ok(public.cap_rush_multiplayer_is_member(gen_random_uuid()) is not null, 'membership helper is callable');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'cap_rush_multiplayer_rooms' and cmd <> 'SELECT'),
  0, 'no direct client writes to rooms');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'cap_rush_multiplayer_room_commands' and cmd <> 'SELECT'),
  0, 'no direct client writes to commands');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'cap_rush_multiplayer_verification_receipts' and cmd <> 'SELECT'),
  0, 'no direct client writes to receipts');

-- 2. Behavioral harness.
create table public.cr_pgtap_ctx (name text primary key, value text);
grant select, insert, update, delete on public.cr_pgtap_ctx to authenticated;

create function public.cr_pgtap_claim(p_uid text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;
create function public.cr_pgtap_clear() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
grant execute on function public.cr_pgtap_claim(text) to authenticated;
grant execute on function public.cr_pgtap_clear() to authenticated;

-- 3. Create, preview, join, resume.
set local role authenticated;
select public.cr_pgtap_claim('11111111-1111-1111-1111-111111111111');
insert into public.cr_pgtap_ctx (name, value)
select 'created', public.cap_rush_multiplayer_room_create('clash', '{"schemaVersion":1}'::jsonb)::text;
reset role;

select is(
  (select value::jsonb->>'code' ~ '^[0-9]{4}$' from public.cr_pgtap_ctx where name = 'created'),
  true, 'create returns a four-digit code');
select is(
  (select value::jsonb->>'rootSeed' ~ '^[0-9a-f]{32}$' from public.cr_pgtap_ctx where name = 'created'),
  true, 'create returns a 32-hex root seed');
select is(
  (select count(*)::int from public.cap_rush_multiplayer_room_members
    where room_id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid
      and participant_id = 'p1'),
  1, 'create seats the host as p1');
select is(
  (select state->>'phase' from public.cap_rush_multiplayer_rooms
    where id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid),
  'lobby', 'create stores the initial lobby state');

set local role authenticated;
select public.cr_pgtap_claim('22222222-2222-2222-2222-222222222222');
insert into public.cr_pgtap_ctx (name, value)
select 'preview', public.cap_rush_multiplayer_room_preview(
  (select value::jsonb->>'code' from public.cr_pgtap_ctx where name = 'created'))::text;
insert into public.cr_pgtap_ctx (name, value)
select 'joined', public.cap_rush_multiplayer_room_join(
  (select value::jsonb->>'code' from public.cr_pgtap_ctx where name = 'created'))::text;
reset role;

select is(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'preview'),
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created'),
  'preview returns the room');
select is(
  (select value::jsonb->>'participantId' from public.cr_pgtap_ctx where name = 'joined'),
  'p2', 'join seats the guest as p2');
select is(
  (select jsonb_array_length(value::jsonb->'members') from public.cr_pgtap_ctx where name = 'preview'),
  2, 'preview always reports two seats');
select is(
  (select count(*)::int from public.cap_rush_multiplayer_room_members
    where room_id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid),
  2, 'join creates the guest member');

set local role authenticated;
select public.cr_pgtap_claim('33333333-3333-3333-3333-333333333333');
select throws_ok(
  format('select public.cap_rush_multiplayer_room_join(%L)',
    (select value::jsonb->>'code' from public.cr_pgtap_ctx where name = 'created')),
  'P0001', 'room-full', 'a third seat is rejected');
reset role;

set local role authenticated;
select public.cr_pgtap_claim('11111111-1111-1111-1111-111111111111');
insert into public.cr_pgtap_ctx (name, value)
select 'resume_p1', public.cap_rush_multiplayer_room_resume(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid)::text;
reset role;
set local role authenticated;
select public.cr_pgtap_claim('22222222-2222-2222-2222-222222222222');
insert into public.cr_pgtap_ctx (name, value)
select 'resume_p2', public.cap_rush_multiplayer_room_resume(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid)::text;
reset role;

select is(
  (select value::jsonb->>'participantId' from public.cr_pgtap_ctx where name = 'resume_p1'),
  'p1', 'host resume returns p1');
select is(
  (select value::jsonb->>'participantId' from public.cr_pgtap_ctx where name = 'resume_p2'),
  'p2', 'guest resume returns p2');

-- 4. Sync and membership.
set local role authenticated;
select public.cr_pgtap_claim('11111111-1111-1111-1111-111111111111');
insert into public.cr_pgtap_ctx (name, value)
select 'sync', public.cap_rush_multiplayer_room_sync(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid, -1)::text;
reset role;
select is(
  (select jsonb_array_length(value::jsonb->'members') from public.cr_pgtap_ctx where name = 'sync'),
  2, 'sync returns both members');
select is(
  (select jsonb_array_length(value::jsonb->'commands') from public.cr_pgtap_ctx where name = 'sync'),
  0, 'sync starts with no commands');

set local role authenticated;
select public.cr_pgtap_claim('33333333-3333-3333-3333-333333333333');
select throws_ok(
  format('select public.cap_rush_multiplayer_room_sync(%L::uuid, -1)',
    (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')),
  'P0001', 'membership', 'strangers cannot sync');
reset role;

-- 5. Ordered commands, idempotency, and stale revisions.
set local role authenticated;
select public.cr_pgtap_claim('11111111-1111-1111-1111-111111111111');
insert into public.cr_pgtap_ctx (name, value)
select 'ready1', public.cap_rush_multiplayer_command_submit(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid,
  'cmd-ready-1', 1, '{"kind":"ready","ready":true}'::jsonb,
  '{"phase":"lobby"}'::jsonb, repeat('a', 32), now()::text, null)::text;
insert into public.cr_pgtap_ctx (name, value)
select 'ready1_retry', public.cap_rush_multiplayer_command_submit(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid,
  'cmd-ready-1', 1, '{"kind":"ready","ready":true}'::jsonb,
  '{"phase":"lobby"}'::jsonb, repeat('a', 32), now()::text, null)::text;
insert into public.cr_pgtap_ctx (name, value)
select 'ready1_conflict', public.cap_rush_multiplayer_command_submit(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid,
  'cmd-ready-1', 1, '{"kind":"ready","ready":false}'::jsonb,
  '{"phase":"lobby"}'::jsonb, repeat('a', 32), now()::text, null)::text;
insert into public.cr_pgtap_ctx (name, value)
select 'stale', public.cap_rush_multiplayer_command_submit(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid,
  'cmd-stale', 1, '{"kind":"ready","ready":true}'::jsonb,
  '{"phase":"lobby"}'::jsonb, repeat('a', 32), now()::text, null)::text;
reset role;

select is((select value::jsonb->>'accepted' from public.cr_pgtap_ctx where name = 'ready1'), 'true', 'host ready accepted');
select is((select value::jsonb->>'ordinal' from public.cr_pgtap_ctx where name = 'ready1_retry'), '0', 'identical retry reuses the ordinal');
select is((select value::jsonb->>'rejectionCode' from public.cr_pgtap_ctx where name = 'ready1_conflict'), 'command-conflict', 'same id with a different payload conflicts');
select is((select value::jsonb->>'rejectionCode' from public.cr_pgtap_ctx where name = 'stale'), 'stale-revision', 'stale revision rejected');

set local role authenticated;
select public.cr_pgtap_claim('22222222-2222-2222-2222-222222222222');
insert into public.cr_pgtap_ctx (name, value)
select 'ready2', public.cap_rush_multiplayer_command_submit(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid,
  'cmd-ready-2', 2, '{"kind":"ready","ready":true}'::jsonb,
  '{"phase":"lobby"}'::jsonb, repeat('b', 32), now()::text, null)::text;
insert into public.cr_pgtap_ctx (name, value)
select 'sync_later', public.cap_rush_multiplayer_room_sync(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid, 0)::text;
reset role;

select is((select value::jsonb->>'accepted' from public.cr_pgtap_ctx where name = 'ready2'), 'true', 'guest ready accepted');
select is(
  (select command_count from public.cap_rush_multiplayer_rooms
    where id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid),
  2, 'two commands are stored');
select is(
  (select jsonb_array_length(value::jsonb->'commands') from public.cr_pgtap_ctx where name = 'sync_later'),
  1, 'sync after an ordinal returns only later commands');

-- 6. Legacy lobby lookup.
set local role authenticated;
select public.cr_pgtap_claim('33333333-3333-3333-3333-333333333333');
insert into public.cr_pgtap_ctx (name, value)
select 'legacy', public.multiplayer_lobby_command(
  jsonb_build_object('kind', 'preview',
    'code', (select value::jsonb->>'code' from public.cr_pgtap_ctx where name = 'created')))::text;
reset role;
select is((select value::jsonb->>'gameKind' from public.cr_pgtap_ctx where name = 'legacy'), 'cap-rush', 'legacy lookup resolves cap-rush');
select is(
  (select value::jsonb->>'gameRoomId' from public.cr_pgtap_ctx where name = 'legacy'),
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created'),
  'legacy lookup returns the room id');

-- 7. Verification and completion.
set local role authenticated;
select public.cr_pgtap_claim('11111111-1111-1111-1111-111111111111');
insert into public.cr_pgtap_ctx (name, value)
select 'challenge', public.cap_rush_multiplayer_verification_challenge(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid);
select public.cap_rush_multiplayer_room_complete(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid, repeat('c', 32));
reset role;
select is(length((select value from public.cr_pgtap_ctx where name = 'challenge')), 64, 'challenge is a sha256 hex nonce');
select is(
  (select phase from public.cap_rush_multiplayer_rooms
    where id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid),
  'completed', 'complete sets the room phase');

-- 8. Fail and cron.
set local role authenticated;
select public.cr_pgtap_claim('11111111-1111-1111-1111-111111111111');
insert into public.cr_pgtap_ctx (name, value)
select 'second', public.cap_rush_multiplayer_room_create('roulette', '{"schemaVersion":1}'::jsonb)::text;
select public.cap_rush_multiplayer_room_fail(
  (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'second')::uuid);
reset role;
select is(
  (select phase from public.cap_rush_multiplayer_rooms
    where id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'second')::uuid),
  'integrity-failed', 'fail sets the room phase');

update public.cap_rush_multiplayer_rooms
  set code_expires_at = now() - interval '1 minute'
  where id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid;
select public.cap_rush_multiplayer_cron_tick();
select is(
  (select code_active from public.cap_rush_multiplayer_rooms
    where id = (select value::jsonb->>'roomId' from public.cr_pgtap_ctx where name = 'created')::uuid),
  false, 'cron deactivates an expired code');

-- 9. Strangers cannot read room rows.
set local role authenticated;
select public.cr_pgtap_claim('33333333-3333-3333-3333-333333333333');
insert into public.cr_pgtap_ctx (name, value)
select 'stranger_rooms', count(*)::text from public.cap_rush_multiplayer_rooms;
insert into public.cr_pgtap_ctx (name, value)
select 'stranger_commands', count(*)::text from public.cap_rush_multiplayer_room_commands;
reset role;
select is((select value from public.cr_pgtap_ctx where name = 'stranger_rooms'), '0', 'strangers cannot read rooms');
select is((select value from public.cr_pgtap_ctx where name = 'stranger_commands'), '0', 'strangers cannot read commands');

select * from finish();
rollback;
