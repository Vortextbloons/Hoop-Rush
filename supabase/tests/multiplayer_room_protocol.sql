-- Room protocol version enforcement.
--
-- Milestone 3 of spec/refactors/shared-mode-infrastructure.md.
--
-- Covers the server half of the protocol break: a client that cannot declare
-- the current version is refused, and a room created under an older version
-- cannot be reached by a current client. Client-side checks cannot substitute
-- for these, because a stale tab talks to the server directly.

begin;
select plan(6);

do $test$
declare
  v_uid uuid := gen_random_uuid();
  v_room uuid;
  v_result jsonb;
  v_case record;
begin
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  -- 1. The server publishes the version clients must speak.
  assert public.multiplayer_room_protocol_version() = 2;
  assert multiplayer_private.required_room_protocol_version() = 2;

  -- 2. A current-version room is served when the client declares version 2.
  v_room := gen_random_uuid();
  insert into public.havoc_multiplayer_rooms(id, versions, root_seed, command_count, room_protocol_version)
    values(v_room, '{}'::jsonb, repeat('d', 32), 0, 2);
  insert into public.havoc_multiplayer_room_members(room_id, uid, participant_id)
    values(v_room, v_uid, 'p1');
  v_result := public.multiplayer_room_sync('havoc', v_room, -1, 2::smallint);
  assert v_result->'room'->>'id' = v_room::text;

  -- 3. A room created under version 1 is refused for a version-2 client.
  update public.havoc_multiplayer_rooms set room_protocol_version = 1 where id = v_room;
  begin
    perform public.multiplayer_room_sync('havoc', v_room, -1, 2::smallint);
    raise exception 'outdated room was served to a current client';
  exception when raise_exception then assert sqlerrm = 'outdated-room'; end;

  -- 4. A client that cannot declare the version is refused before any read.
  update public.havoc_multiplayer_rooms set room_protocol_version = 2 where id = v_room;
  begin
    perform public.multiplayer_room_sync('havoc', v_room, -1, null);
    raise exception 'versionless client was served';
  exception when raise_exception then assert sqlerrm = 'unsupported-protocol'; end;

  -- 5. The three-argument legacy form always refuses, so an undeployed-client
  --    stale tab cannot mutate a new-protocol room.
  begin
    perform public.multiplayer_room_sync('havoc', v_room, -1);
    raise exception 'legacy signature was served';
  exception when raise_exception then assert sqlerrm = 'unsupported-protocol'; end;

  -- 6. Every mode table carries the column, and new rooms default to current.
  for v_case in select unnest(array['fixed_five_rooms', 'draft_duel_rooms', 'havoc_multiplayer_rooms', 'cap_rush_multiplayer_rooms']) as tbl loop
    assert exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = v_case.tbl
         and column_name = 'room_protocol_version'
    );
  end loop;
end;
$test$;

select pass('room protocol refuses outdated rooms and versionless clients for every mode');
select ok(has_function_privilege('authenticated', 'public.multiplayer_room_protocol_version()', 'execute'), 'authenticated callers can read the required protocol version');
select ok(not has_function_privilege('anon', 'public.multiplayer_room_protocol_version()', 'execute'), 'anonymous role cannot read the required protocol version');
select ok(multiplayer_private.required_room_protocol_version() = 2, 'one required version is declared in one place');
select ok(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and column_name = 'room_protocol_version'
      and table_name in ('fixed_five_rooms', 'draft_duel_rooms', 'havoc_multiplayer_rooms', 'cap_rush_multiplayer_rooms')) = 4,
  'all four room tables expose room_protocol_version'
);
select ok(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'cap_rush_multiplayer_rooms' and column_name = 'room_protocol_version') = '2',
  'new rooms default to the current protocol version'
);

select * from finish();
rollback;
