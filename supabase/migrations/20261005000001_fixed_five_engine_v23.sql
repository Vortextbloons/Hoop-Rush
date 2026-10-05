insert into public.fixed_five_server_versions (key, value) values
  ('engineVersion', 'm3-engine-v23')
on conflict (key) do update set value = excluded.value;
