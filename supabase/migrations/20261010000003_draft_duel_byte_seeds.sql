-- Draft Duel seed derivation fix: first picker and home draw are derived from
-- the root seed bytes (mirroring the engine), replacing the SQL PRNG
-- replication which overflowed bigint for real room seeds.

create or replace function public.draft_duel_first_picker(p_root_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (('x' || substr(p_root_seed, 1, 2))::bit(8)::integer) % 2 = 0 then 'p1'
    else 'p2'
  end;
$$;
revoke all on function public.draft_duel_first_picker(text) from public, anon, authenticated;

create or replace function public.draft_duel_home_winner(p_root_seed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (('x' || substr(p_root_seed, 3, 2))::bit(8)::integer) % 2 = 0 then 'p1'
    else 'p2'
  end;
$$;
revoke all on function public.draft_duel_home_winner(text) from public, anon, authenticated;

drop function if exists public.draft_duel_rng_draw(text);

notify pgrst, 'reload schema';
