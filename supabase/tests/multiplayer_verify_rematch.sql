-- pgTAP tests for public.multiplayer_verify_rematch.
-- Run with: supabase test db
--
-- The predicate is read-only and returns only a boolean. Fixtures are inserted
-- directly as the test session role so each fail-closed branch can be exercised
-- independently; the final draft-duel and havoc cases use the real create,
-- join, command-submit, rematch, and join RPCs.

begin;
select plan(44);

-- 1. Contract and grants.
select has_function(
  'public',
  'multiplayer_verify_rematch',
  array['text', 'uuid', 'uuid', 'integer'],
  'verify-rematch RPC exists with the client contract'
);
select is(
  pg_get_function_arguments(
    'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure
  ),
  'p_kind text, p_previous_room_id uuid, p_room_id uuid, p_protocol_version integer',
  'argument names and types match the client call'
);
select is(
  pg_get_function_result(
    'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure
  ),
  'boolean',
  'the verifier returns only a boolean'
);
select is(
  (select p.provolatile
     from pg_proc p
    where p.oid = 'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure),
  's',
  'the verifier is stable and read-only'
);
select is(
  (select p.prosecdef
     from pg_proc p
    where p.oid = 'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure),
  true,
  'the verifier is security definer so it can read protected membership rows'
);
select ok(
  (select p.proconfig is not null
          and array_to_string(p.proconfig, ',') like 'search_path=%'
     from pg_proc p
    where p.oid = 'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure),
  'the verifier pins an explicit empty search path'
);
select ok(
  not pg_get_functiondef(
    'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure
  ) ~* '(insert\s+into|update\s+public\.|delete\s+from|for\s+update)',
  'the verifier contains no write statements'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.multiplayer_verify_rematch(text, uuid, uuid, integer)',
    'EXECUTE'
  ),
  true,
  'authenticated callers can execute the verifier'
);
select is(
  has_function_privilege(
    'anon',
    'public.multiplayer_verify_rematch(text, uuid, uuid, integer)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot execute the verifier'
);
select is(
  (select count(*)::int
     from pg_proc p
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.multiplayer_verify_rematch(text, uuid, uuid, integer)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC cannot execute the verifier'
);

-- 2. Fixtures.
create table public.mvr_pgtap_ctx (name text primary key, value text);
grant select, insert, update, delete on public.mvr_pgtap_ctx to authenticated;

create function public.mvr_pgtap_claim(p_uid text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid, true);
end $$;

create function public.mvr_pgtap_verify(
  p_kind text,
  p_previous_room_id uuid,
  p_room_id uuid,
  p_protocol_version integer,
  p_uid uuid
) returns boolean
language plpgsql as $$
declare v_result boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v_result := public.multiplayer_verify_rematch(
    p_kind, p_previous_room_id, p_room_id, p_protocol_version
  );
  reset role;
  return v_result;
end $$;

insert into public.mvr_pgtap_ctx (name, value) values
  ('uid_a', '00000000-0000-4000-8000-0000000000a1'),
  ('uid_b', '00000000-0000-4000-8000-0000000000a2'),
  ('uid_c', '00000000-0000-4000-8000-0000000000a3'),
  ('dd_versions', '{"dataVersion":"data-v1","ratingsVersion":"ratings-v1","catalogVersion":"catalog-v1","catalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","playerVersionIdVersion":"pv-v1","positionNormalizationVersion":"position-v3","engineVersion":"engine-v1","profileVersion":"profile-v1","seedDerivationVersion":"draft-duel-seed-v1","multiplayerVersion":"draft-duel-multiplayer-v2","autopickVersion":"draft-duel-autopick-v1"}'),
  ('hv_versions', '{"schemaVersion":1,"engineVersion":"engine-v1","rulesVersion":"havoc-rules-v9","mutationCatalogVersion":"havoc-mutations-v8","profileVersion":"profile-v1","dataVersion":"data-v1","catalogVersion":"catalog-v1","catalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","profileHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","multiplayerVersion":"havoc-multiplayer-v2"}');

-- Draft Duel fixtures.
insert into public.draft_duel_rooms
  (id, fairness, presentation, versions, root_seed, phase, successor_room_id, room_protocol_version)
values
  ('11111111-1111-4111-8111-111111111101', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111102', 2),
  ('11111111-1111-4111-8111-111111111102', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111103', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111104', 2),
  ('11111111-1111-4111-8111-111111111104', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111105', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111106', 2),
  ('11111111-1111-4111-8111-111111111106', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111107', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111108', 2),
  ('11111111-1111-4111-8111-111111111108', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111109', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111110', 2),
  ('11111111-1111-4111-8111-111111111110', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111111', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111112', 2),
  ('11111111-1111-4111-8111-111111111112', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111113', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', null, 2),
  ('11111111-1111-4111-8111-111111111114', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111115', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111116', 1),
  ('11111111-1111-4111-8111-111111111116', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111117', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111118', 2),
  ('11111111-1111-4111-8111-111111111118', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 1),
  ('11111111-1111-4111-8111-111111111119', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111120', 2),
  ('11111111-1111-4111-8111-111111111120', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('11111111-1111-4111-8111-111111111121', 'fair', 'ratings', '{}'::jsonb, repeat('a', 32), 'championship', '11111111-1111-4111-8111-111111111122', 2),
  ('11111111-1111-4111-8111-111111111122', 'fair', 'ratings', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2);

insert into public.draft_duel_room_members (room_id, uid, participant_id)
select id, (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a'), 'p1'
  from public.draft_duel_rooms
 where id::text like '11111111-1111-4111-8111-1111111111%'
union all
select id, (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b'), 'p2'
  from public.draft_duel_rooms
 where id::text like '11111111-1111-4111-8111-1111111111%'
   and id not in (
     '11111111-1111-4111-8111-111111111110',
     '11111111-1111-4111-8111-111111111112',
     '11111111-1111-4111-8111-111111111122'
   );

-- The three exceptions above replace p2 with a different member.
insert into public.draft_duel_room_members (room_id, uid, participant_id) values
  ('11111111-1111-4111-8111-111111111110', (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_c'), 'p2'),
  ('11111111-1111-4111-8111-111111111122', (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_c'), 'p2');

insert into public.draft_duel_room_commands (room_id, command_id, ordinal, actor_participant_id, payload) values
  ('11111111-1111-4111-8111-111111111101', 'dd-good-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111101', 'dd-good-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111103', 'dd-no-confirm-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111105', 'dd-same-actor-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111105', 'dd-same-actor-confirm', 1, 'p1', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111107', 'dd-confirm-first-confirm', 0, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111107', 'dd-confirm-first-request', 1, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111109', 'dd-diff-members-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111109', 'dd-diff-members-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111111', 'dd-one-member-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111111', 'dd-one-member-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111113', 'dd-no-successor-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111113', 'dd-no-successor-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111115', 'dd-prev-protocol-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111115', 'dd-prev-protocol-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111117', 'dd-succ-protocol-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111117', 'dd-succ-protocol-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111121', 'dd-prev-only-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111121', 'dd-prev-only-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('11111111-1111-4111-8111-111111111120', 'dd-succ-only-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('11111111-1111-4111-8111-111111111120', 'dd-succ-only-confirm', 1, 'p2', '{"kind":"rematch-confirm"}');

-- Havoc fixtures.
insert into public.havoc_multiplayer_rooms
  (id, versions, root_seed, phase, successor_room_id, room_protocol_version)
values
  ('22222222-2222-4222-8222-222222222201', '{}'::jsonb, repeat('a', 32), 'championship', '22222222-2222-4222-8222-222222222202', 2),
  ('22222222-2222-4222-8222-222222222202', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('22222222-2222-4222-8222-222222222203', '{}'::jsonb, repeat('a', 32), 'championship', '22222222-2222-4222-8222-222222222204', 2),
  ('22222222-2222-4222-8222-222222222204', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('22222222-2222-4222-8222-222222222205', '{}'::jsonb, repeat('a', 32), 'championship', '22222222-2222-4222-8222-222222222206', 2),
  ('22222222-2222-4222-8222-222222222206', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2),
  ('22222222-2222-4222-8222-222222222207', '{}'::jsonb, repeat('a', 32), 'championship', '22222222-2222-4222-8222-222222222208', 1),
  ('22222222-2222-4222-8222-222222222208', '{}'::jsonb, repeat('b', 32), 'lobby', null, 2);

insert into public.havoc_multiplayer_room_members (room_id, uid, participant_id)
select id, (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a'), 'p1'
  from public.havoc_multiplayer_rooms
 where id::text like '22222222-2222-4222-8222-2222222222%'
union all
select id, (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b'), 'p2'
  from public.havoc_multiplayer_rooms
 where id::text like '22222222-2222-4222-8222-2222222222%';

insert into public.havoc_multiplayer_room_commands (room_id, command_id, ordinal, actor_participant_id, payload) values
  ('22222222-2222-4222-8222-222222222201', 'hv-good-request', 0, 'p2', '{"kind":"rematch-request"}'),
  ('22222222-2222-4222-8222-222222222201', 'hv-good-confirm', 1, 'p1', '{"kind":"rematch-confirm"}'),
  ('22222222-2222-4222-8222-222222222204', 'hv-succ-only-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('22222222-2222-4222-8222-222222222204', 'hv-succ-only-confirm', 1, 'p2', '{"kind":"rematch-confirm"}'),
  ('22222222-2222-4222-8222-222222222207', 'hv-protocol-request', 0, 'p1', '{"kind":"rematch-request"}'),
  ('22222222-2222-4222-8222-222222222207', 'hv-protocol-confirm', 1, 'p2', '{"kind":"rematch-confirm"}');

-- 3. Draft Duel behavior.
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  true,
  'accepts a confirmed Draft Duel rematch for the requesting seat'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b')
  ),
  true,
  'accepts the same rematch for the confirming seat with one confirmation'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111103',
    '11111111-1111-4111-8111-111111111104',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a rematch with no accepted confirmation'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111105',
    '11111111-1111-4111-8111-111111111106',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a confirmation by the same seat that requested'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111107',
    '11111111-1111-4111-8111-111111111108',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b')
  ),
  false,
  'rejects a confirmation recorded before the other seat requested'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111109',
    '11111111-1111-4111-8111-111111111110',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects rooms whose two member UID sets differ'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111112',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a successor with only one member'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111113',
    '11111111-1111-4111-8111-111111111114',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a room that is not the predecessor successor'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111115',
    '11111111-1111-4111-8111-111111111116',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a predecessor on an older protocol version'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111117',
    '11111111-1111-4111-8111-111111111118',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a successor on an older protocol version'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111119',
    '11111111-1111-4111-8111-111111111120',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects rematch commands stored only in the successor'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_c')
  ),
  false,
  'rejects a caller who is not a member of either room'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111121',
    '11111111-1111-4111-8111-111111111122',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a caller who is missing from the successor'
);
select is(
  public.mvr_pgtap_verify(
    'fixed-five',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'does not allowlist Fixed Five because its completed phase rejects rematches'
);
select is(
  public.mvr_pgtap_verify(
    'cap-rush',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects non-allowlisted mode kinds'
);
select is(
  public.mvr_pgtap_verify(
    'unknown-mode',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects unknown mode kinds'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    1,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a caller that declares an unsupported protocol version'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    null,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a missing protocol version'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    null,
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a missing predecessor room id'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    null,
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a missing successor room id'
);
select is(
  public.mvr_pgtap_verify(
    null,
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a missing mode kind'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111101',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a room claimed as its own predecessor'
);

-- 4. Havoc behavior.
select is(
  public.mvr_pgtap_verify(
    'havoc',
    '22222222-2222-4222-8222-222222222201',
    '22222222-2222-4222-8222-222222222202',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  true,
  'accepts a confirmed Havoc rematch where the guest requested and the host confirmed'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    '22222222-2222-4222-8222-222222222201',
    '22222222-2222-4222-8222-222222222202',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b')
  ),
  true,
  'accepts the same Havoc rematch for the other seat'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    '22222222-2222-4222-8222-222222222203',
    '22222222-2222-4222-8222-222222222204',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects Havoc commands stored only in the successor'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    '22222222-2222-4222-8222-222222222205',
    '22222222-2222-4222-8222-222222222206',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects a Havoc rematch without accepted commands'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    '22222222-2222-4222-8222-222222222207',
    '22222222-2222-4222-8222-222222222208',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  false,
  'rejects an older Havoc predecessor protocol version'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    '22222222-2222-4222-8222-222222222201',
    '22222222-2222-4222-8222-222222222202',
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_c')
  ),
  false,
  'rejects a Havoc caller who is not a room member'
);

-- 5. Real RPC flow: Draft Duel.
set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_a'));
end
$flow$;
with created as (
  select public.draft_duel_room_create(
    'fair',
    'ratings',
    (select value::jsonb from public.mvr_pgtap_ctx where name = 'dd_versions')
  ) as r
)
insert into public.mvr_pgtap_ctx (name, value)
select 'dd_real_prev', r->>'room_id' from created
union all
select 'dd_real_code', r->>'code' from created;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_b'));
  perform public.draft_duel_room_join((select value from public.mvr_pgtap_ctx where name = 'dd_real_code'));
end
$flow$;
reset role;

update public.draft_duel_rooms
   set phase = 'championship'
 where id = (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev');

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_a'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev'),
    'dd-real-request',
    null,
    '{"kind":"rematch-request"}'
  );
end
$flow$;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_b'));
  perform public.draft_duel_command_submit(
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev'),
    'dd-real-confirm',
    null,
    '{"kind":"rematch-confirm"}'
  );
end
$flow$;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_a'));
end
$flow$;
with created as (
  select public.draft_duel_rematch(
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev')
  ) as r
)
insert into public.mvr_pgtap_ctx (name, value)
select 'dd_real_succ', r->>'room_id' from created
union all
select 'dd_real_succ_code', r->>'code' from created;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_b'));
  perform public.draft_duel_room_join((select value from public.mvr_pgtap_ctx where name = 'dd_real_succ_code'));
end
$flow$;
reset role;

select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev'),
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_succ'),
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  true,
  'verifies a rematch created by the real Draft Duel RPCs for the host'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev'),
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_succ'),
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b')
  ),
  true,
  'verifies a rematch created by the real Draft Duel RPCs for the guest'
);
select is(
  public.mvr_pgtap_verify(
    'draft-duel',
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_prev'),
    (select value::uuid from public.mvr_pgtap_ctx where name = 'dd_real_succ'),
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_c')
  ),
  false,
  'rejects a nonmember against a real Draft Duel rematch'
);

-- 6. Real RPC flow: Havoc.
set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_a'));
end
$flow$;
with created as (
  select public.havoc_multiplayer_room_create(
    (select value::jsonb from public.mvr_pgtap_ctx where name = 'hv_versions')
  ) as r
)
insert into public.mvr_pgtap_ctx (name, value)
select 'hv_real_prev', r->>'room_id' from created
union all
select 'hv_real_code', r->>'code' from created;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_b'));
  perform public.havoc_multiplayer_room_join((select value from public.mvr_pgtap_ctx where name = 'hv_real_code'));
end
$flow$;
reset role;

update public.havoc_multiplayer_rooms
   set phase = 'championship'
 where id = (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev');

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_a'));
  perform public.havoc_multiplayer_command_submit(
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev'),
    'hv-real-request',
    null,
    '{"kind":"rematch-request"}'
  );
end
$flow$;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_b'));
  perform public.havoc_multiplayer_command_submit(
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev'),
    'hv-real-confirm',
    null,
    '{"kind":"rematch-confirm"}'
  );
end
$flow$;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_a'));
end
$flow$;
with created as (
  select public.havoc_multiplayer_rematch(
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev')
  ) as r
)
insert into public.mvr_pgtap_ctx (name, value)
select 'hv_real_succ', r->>'room_id' from created
union all
select 'hv_real_succ_code', r->>'code' from created;
reset role;

set local role authenticated;
do $flow$
begin
  perform public.mvr_pgtap_claim((select value from public.mvr_pgtap_ctx where name = 'uid_b'));
  perform public.havoc_multiplayer_room_join((select value from public.mvr_pgtap_ctx where name = 'hv_real_succ_code'));
end
$flow$;
reset role;

select is(
  public.mvr_pgtap_verify(
    'havoc',
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev'),
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_succ'),
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_a')
  ),
  true,
  'verifies a rematch created by the real Havoc RPCs for the host'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev'),
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_succ'),
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_b')
  ),
  true,
  'verifies a rematch created by the real Havoc RPCs for the guest'
);
select is(
  public.mvr_pgtap_verify(
    'havoc',
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_prev'),
    (select value::uuid from public.mvr_pgtap_ctx where name = 'hv_real_succ'),
    2,
    (select value::uuid from public.mvr_pgtap_ctx where name = 'uid_c')
  ),
  false,
  'rejects a nonmember against a real Havoc rematch'
);

select * from finish();
rollback;
