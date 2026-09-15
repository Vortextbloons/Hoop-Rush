insert into public.fixed_five_server_versions (key, value)
values ('positionNormalizationVersion', 'position-v4')
on conflict (key) do update set value = excluded.value;
