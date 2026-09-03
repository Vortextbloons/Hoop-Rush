-- pgTAP tests for M2.8 Fixed-Five live multiplayer.
-- Run with: supabase test db

begin;
select plan(24);

select has_table('public', 'fixed_five_rooms', 'fixed_five_rooms exists');
select has_table('public', 'fixed_five_room_members', 'members exists');
select has_table('public', 'fixed_five_room_commands', 'commands exists');
select has_table('public', 'fixed_five_join_attempts', 'join attempts exists');

select col_type_is('public', 'fixed_five_rooms', 'code', 'text', 'code is text preserving leading zeroes');
select has_check('public', 'fixed_five_rooms', 'fixed_five_rooms_code_check', 'code check enforces four digits');
select has_check('public', 'fixed_five_rooms', 'fixed_five_rooms_mode_check', 'mode check');
select has_check('public', 'fixed_five_rooms', 'fixed_five_rooms_phase_check', 'phase check');

select has_index('public', 'fixed_five_rooms', 'fixed_five_rooms_active_code_uidx', 'partial unique active code index exists');
select has_index('public', 'fixed_five_room_commands', 'fixed_five_room_commands_room_ordinal_idx', 'command ordinal index exists');

select has_policy('public', 'fixed_five_rooms', 'ff members read their room');
select has_policy('public', 'fixed_five_room_commands', 'ff members read their commands');

-- No direct-write policies: only select policies should exist for anon/authenticated.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_rooms' and cmd <> 'SELECT'),
  0, 'no direct client writes to rooms');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'fixed_five_room_commands' and cmd <> 'SELECT'),
  0, 'no direct client writes to commands');

select has_function('public', 'fixed_five_room_create', array['text','text','text','jsonb'], 'create exists');
select has_function('public', 'fixed_five_room_preview', array['text'], 'preview exists');
select has_function('public', 'fixed_five_room_join', array['text'], 'join exists');
select has_function('public', 'fixed_five_command_submit', array['uuid','text','integer','text','jsonb'], 'command submit exists');
select has_function('public', 'fixed_five_timeout_resolve', array['uuid'], 'timeout resolve exists');
select has_function('public', 'fixed_five_guest_remove', array['uuid','text'], 'guest remove exists');
select has_function('public', 'fixed_five_leave', array['uuid'], 'leave exists');
select has_function('public', 'fixed_five_rematch', array['uuid'], 'rematch exists');
select has_function('public', 'fixed_five_complete', array['uuid','text'], 'complete exists');
select has_function('public', 'fixed_five_fail', array['uuid'], 'fail exists');

select * from finish();
rollback;
