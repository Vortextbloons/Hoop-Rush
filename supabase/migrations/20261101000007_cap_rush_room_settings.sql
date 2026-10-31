-- Rooms created before the adapter settings wrapper stored the lobby match
-- settings shape. Convert those documents to the room settings shape the client
-- snapshot expects. Rooms already carrying versionLocks are untouched.

update public.cap_rush_multiplayer_rooms
  set settings = jsonb_build_object(
    'schemaVersion', 1,
    'variant', coalesce(settings->>'variant', 'clash'),
    'versionLocks', coalesce(settings->'versions', '{}'::jsonb)
  )
  where settings is not null
    and settings ? 'gameKind'
    and not (settings ? 'versionLocks');

notify pgrst, 'reload schema';
