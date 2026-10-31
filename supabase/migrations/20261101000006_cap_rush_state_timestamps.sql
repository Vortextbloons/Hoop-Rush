-- Rooms created before the clock normalization may already hold state timestamps
-- with a +00:00 offset. The client state schema requires Z. Normalize existing
-- state documents in place; only the timestamp suffix changes.

update public.cap_rush_multiplayer_rooms
  set state = replace(state::text, '+00:00', 'Z')::jsonb
  where state is not null and state::text like '%+00:00%';

notify pgrst, 'reload schema';
