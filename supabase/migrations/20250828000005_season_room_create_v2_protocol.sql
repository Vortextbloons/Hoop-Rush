-- Ensure season_room_create always writes v2 protocol fields (not just table defaults).

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
            insert into public.season_rooms (
                pace, mode, root_seed, code, code_expires_at, phase,
                room_protocol_version, multiplayer_version
            )
            values (
                p_pace, v_mode, p_root_seed, v_code, now() + interval '15 minutes', 'waiting',
                2, 'season-multiplayer-v2'
            )
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
