-- Fixed-five version lock: engine bumped to m3-engine-v24.
-- Keep in sync with ENGINE_VERSION in packages/engine/src/sim/constants.ts.
-- Room creation was rejecting with 'invalid versions' (HTTP 400) because the
-- client sends m3-engine-v24 while the server locked m3-engine-v23.
insert into public.fixed_five_server_versions (key, value) values
  ('engineVersion', 'm3-engine-v24')
on conflict (key) do update set value = excluded.value;
