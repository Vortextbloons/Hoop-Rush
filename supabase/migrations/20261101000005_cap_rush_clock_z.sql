-- The client stores the accepted timestamp in the room state, and the state
-- schema requires UTC ISO with a Z suffix. Return the coordination clock in that
-- exact shape instead of a timestamptz offset.

create or replace function public.cap_rush_multiplayer_clock()
returns text language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

notify pgrst, 'reload schema';
