-- M2.7 mode for multiplayer rooms (season | classic | sandbox)
-- Host selects before create; guest previews same mode.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='season_rooms' and column_name='mode') then
    alter table public.season_rooms add column mode text not null default 'season' check (mode in ('season','classic','sandbox'));
  end if;
end $$;

-- ensure existing rooms have season mode
update public.season_rooms set mode='season' where mode is null;

-- extend season_room_create to accept mode (optional third param)
-- keep backward compat: create overload with mode, original 2-arg wrapper delegates to season default
drop function if exists public.season_room_create(text, text);
create or replace function public.season_room_create(p_pace text, p_root_seed text, p_mode text default 'season')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_room_id uuid;
    v_code text;
    v_tries integer := 0;
    v_mode text := coalesce(p_mode, 'season');
begin
    if p_pace not in ('live','async') then
        raise exception 'invalid pace';
    end if;
    if v_mode not in ('season','classic','sandbox') then
        v_mode := 'season';
    end if;
    loop
        v_code := lpad((floor(random()*10000))::text, 4, '0');
        begin
            insert into public.season_rooms (pace, mode, root_seed, code, code_expires_at, phase)
            values (p_pace, v_mode, p_root_seed, v_code, now() + interval '15 minutes', 'waiting')
            returning id into v_room_id;
            exit;
        exception when unique_violation then
            v_tries := v_tries + 1;
            if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
        end;
    end loop;
    return v_room_id;
end;
$$;
revoke all on function public.season_room_create(text, text, text) from public;
grant execute on function public.season_room_create(text, text, text) to authenticated;
-- keep 2-arg signature as wrapper for older clients (test helpers)
create or replace function public.season_room_create(p_pace text, p_root_seed text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.season_room_create(p_pace, p_root_seed, 'season');
end;
$$;
revoke all on function public.season_room_create(text, text) from public;
grant execute on function public.season_room_create(text, text) to authenticated;
