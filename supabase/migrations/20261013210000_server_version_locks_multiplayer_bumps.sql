-- Version locks: multiplayer versions were bumped in code without updating
-- the server locks, so room creation rejected with 'invalid versions' again.
-- Keep in sync with FIXED_FIVE_MULTIPLAYER_VERSION in
-- packages/data-contracts/src/fixed-five-versions.ts and
-- DRAFT_DUEL_MULTIPLAYER_VERSION in
-- packages/data-contracts/src/draft-duel-versions.ts.
insert into public.fixed_five_server_versions (key, value) values
  ('multiplayerVersion', 'fixed-five-multiplayer-v4')
on conflict (key) do update set value = excluded.value;
insert into public.draft_duel_server_versions (key, value) values
  ('multiplayerVersion', 'draft-duel-multiplayer-v2')
on conflict (key) do update set value = excluded.value;