begin;
select plan(1);
do $$
declare
  v_host uuid := gen_random_uuid();
  v_guest uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_lobby jsonb;
  v_next jsonb;
  v_settings jsonb;
  v_versions jsonb;
  v_room uuid;
  v_code text;
  v_revision integer;
begin
  perform set_config('request.jwt.claim.sub', v_host::text, true);
  v_lobby := public.multiplayer_lobby_command('{"kind":"create"}');
  v_code := v_lobby->>'code';
  assert v_code ~ '^[0-9]{4}$', 'four-digit lobby code';
  assert (v_lobby->>'canStart')::boolean, 'empty lobby can start';
  select jsonb_object_agg(key, value) into v_versions from public.fixed_five_server_versions;
  v_versions := '{"dataVersion":"data-v1","ratingVersion":"ratings-v3.12","bracketVersion":"bracket-m3-v4","scheduleVersion":"schedule-v1","profileVersion":"2010s-fixed-v1"}'::jsonb || v_versions;
  v_settings := jsonb_build_object('gameKind', 'fixed-five', 'mode', 'classic-shared-82', 'sourceMode', 'classic', 'variant', 'ratings', 'versions', v_versions);
  v_lobby := public.multiplayer_lobby_command(jsonb_build_object('kind', 'start', 'lobbyId', v_lobby->>'id', 'expectedRevision', 0, 'settings', v_settings));
  v_room := (v_lobby->>'gameRoomId')::uuid;
  assert v_lobby->>'code' = v_code, 'starting preserves lobby code';
  assert not (v_lobby->>'canStart')::boolean, 'cannot replace an unfinished game';
  perform set_config('request.jwt.claim.sub', v_guest::text, true);
  v_next := public.multiplayer_lobby_command(jsonb_build_object('kind', 'join', 'code', v_code));
  assert v_next->>'participantId' = 'p2', 'guest joins without selecting a mode';
  assert exists(select 1 from public.fixed_five_room_members where room_id = v_room and uid = v_guest and participant_id = 'p2'), 'guest has a fixed-five seat';
  v_revision := (v_next->>'revision')::integer;
  v_next := public.multiplayer_lobby_command(jsonb_build_object('kind', 'join', 'code', v_code));
  assert (v_next->>'revision')::integer = v_revision, 'rejoin is idempotent';
  begin
    perform public.multiplayer_lobby_command(jsonb_build_object('kind', 'start', 'lobbyId', v_lobby->>'id', 'expectedRevision', v_revision, 'settings', v_settings));
    raise exception 'guest start unexpectedly accepted';
  exception when raise_exception then
    assert sqlerrm = 'authorization', 'only the host can choose the next game';
  end;
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  begin
    perform public.multiplayer_lobby_command(jsonb_build_object('kind', 'join', 'code', v_code));
    raise exception 'third seat unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'room-full', 'capacity is two'; end;
  begin
    perform public.multiplayer_lobby_command(jsonb_build_object('kind', 'get', 'lobbyId', v_lobby->>'id'));
    raise exception 'nonmember read unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'membership', 'reads require membership'; end;
  perform set_config('request.jwt.claim.sub', v_host::text, true);
  begin
    perform public.multiplayer_lobby_command(jsonb_build_object('kind', 'start', 'lobbyId', v_lobby->>'id', 'expectedRevision', v_revision, 'settings', v_settings));
    raise exception 'in-progress switch unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'game-in-progress', 'unfinished matches are protected'; end;
  update public.fixed_five_rooms set phase = 'completed' where id = v_room;
  select jsonb_object_agg(key, value) into v_versions from public.draft_duel_server_versions;
  v_versions := jsonb_build_object('seedDerivationVersion', 'seed-v1', 'dataVersion', 'data-v1', 'ratingsVersion', 'ratings-v3.12', 'catalogVersion', 'catalog-v1', 'catalogHash', repeat('a',64), 'playerVersionIdVersion', 'player-version-v1', 'positionNormalizationVersion', 'position-v3', 'engineVersion', 'draft-duel-web-v1', 'profileVersion', '2010s-fixed-v1') || v_versions;
  v_settings := jsonb_build_object('gameKind', 'draft-duel', 'fairness', 'fair', 'variant', 'ball-knowledge', 'versions', v_versions);
  v_next := public.multiplayer_lobby_command(jsonb_build_object('kind', 'start', 'lobbyId', v_lobby->>'id', 'expectedRevision', v_revision, 'settings', v_settings));
  assert v_next->>'code' = v_code, 'mode switch preserves code';
  assert v_next->>'gameKind' = 'draft-duel', 'fixed-five switches to Draft Duel';
  assert exists(select 1 from public.draft_duel_room_members where room_id = (v_next->>'gameRoomId')::uuid and uid = v_host and participant_id = 'p1'), 'host seat transfers';
  assert exists(select 1 from public.draft_duel_room_members where room_id = (v_next->>'gameRoomId')::uuid and uid = v_guest and participant_id = 'p2'), 'guest seat transfers';
  assert exists(select 1 from public.fixed_five_rooms where id = v_room and phase = 'completed'), 'previous result stays intact';
  begin
    perform public.multiplayer_lobby_command(jsonb_build_object('kind', 'start', 'lobbyId', v_lobby->>'id', 'expectedRevision', v_revision, 'settings', v_settings));
    raise exception 'stale start unexpectedly accepted';
  exception when raise_exception then assert sqlerrm = 'stale-revision', 'stale starts are rejected'; end;
  perform set_config('request.jwt.claim.sub', v_guest::text, true);
  v_next := public.multiplayer_lobby_command(jsonb_build_object('kind', 'get', 'lobbyId', v_lobby->>'id'));
  assert v_next->>'gameKind' = 'draft-duel', 'guest discovers the next game without rejoining';
  perform set_config('request.jwt.claim.sub', v_host::text, true);
  v_next := public.multiplayer_lobby_command(jsonb_build_object('kind', 'remove-guest', 'lobbyId', v_lobby->>'id'));
  assert not (v_next->>'guestJoined')::boolean, 'removing opponent clears lobby seat';
  assert v_next->>'code' <> v_code, 'removing opponent rotates invite code';
  assert not exists(select 1 from public.draft_duel_room_members where room_id = (v_next->>'gameRoomId')::uuid and uid = v_guest), 'removed opponent loses game seat';
  update public.draft_duel_rooms set phase = 'championship' where id = (v_next->>'gameRoomId')::uuid;
  select jsonb_object_agg(key, value) into v_versions from public.havoc_multiplayer_server_versions;
  v_versions := jsonb_build_object(
    'schemaVersion', 1,
    'engineVersion', 'm3-engine-v25',
    'rulesVersion', 'havoc-rules-v9',
    'mutationCatalogVersion', 'havoc-mutations-v8',
    'profileVersion', '2010s-fixed-v1',
    'dataVersion', 'data-v1',
    'catalogVersion', 'catalog-v1',
    'catalogHash', repeat('a',64),
    'profileHash', repeat('b',64)) || v_versions;
  v_settings := jsonb_build_object('gameKind', 'havoc', 'variant', 'curated', 'versions', v_versions);
  v_next := public.multiplayer_lobby_command(jsonb_build_object(
    'kind', 'start', 'lobbyId', v_lobby->>'id',
    'expectedRevision', (select revision from public.multiplayer_lobbies where id = (v_lobby->>'id')::uuid),
    'settings', v_settings));
  assert v_next->>'gameKind' = 'havoc', 'draft-duel switches to Hoop Havoc';
  assert (select variant from public.havoc_multiplayer_rooms where id = (v_next->>'gameRoomId')::uuid) = 'curated', 'lobby passes the curated variant into the room';
  assert exists(select 1 from public.havoc_multiplayer_room_members where room_id = (v_next->>'gameRoomId')::uuid and uid = v_host and participant_id = 'p1'), 'havoc host seat transfers';
end $$;
select pass('multiplayer lobby integration assertions passed');
select * from finish();
rollback;
