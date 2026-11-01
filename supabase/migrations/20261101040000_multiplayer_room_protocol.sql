-- Shared room protocol enforcement.
--
-- Milestone 3 of spec/refactors/shared-mode-infrastructure.md.
--
-- The TypeScript contract in data-contracts/src/multiplayer-protocol.ts already
-- refuses mismatched mode/state pairs and old protocol versions on the client.
-- A TypeScript helper cannot enforce that for remote callers, so this migration
-- adds the server half: every room operation routed through
-- multiplayer_private.dispatch is checked against the client's declared
-- protocol version before it can touch room state.
--
-- Design notes:
--   * The client declares its protocol version per call. A room that is older
--     than the required version is refused with a stable code, and the refusal
--     happens *before* any row is read for update, so a stale tab cannot reach
--     new room state.
--   * Room versions live on each mode's room table. Two of the four already
--     carry room_protocol_version; havoc and cap-rush rooms get the column here
--     with a default of the previous value so existing rows stay inspectable.
--   * Only version 2 is supported. Version 1 rooms are rejected, not migrated.
--     This matches the user-authorized protocol break; the spec says old
--     in-flight rooms may end at cutover.

-- 1. Required protocol version, in one place.

create or replace function multiplayer_private.required_room_protocol_version()
returns smallint
language sql
immutable
set search_path = ''
as $$ select 2::smallint $$;

-- 2. Give every room table the same version column.

alter table public.fixed_five_rooms
  add column if not exists room_protocol_version smallint not null default 1;

alter table public.draft_duel_rooms
  add column if not exists room_protocol_version smallint not null default 1;

alter table public.havoc_multiplayer_rooms
  add column if not exists room_protocol_version smallint not null default 1;

alter table public.cap_rush_multiplayer_rooms
  add column if not exists room_protocol_version smallint not null default 1;

-- Rooms created from now on speak the current protocol.
alter table public.fixed_five_rooms
  alter column room_protocol_version set default 2;
alter table public.draft_duel_rooms
  alter column room_protocol_version set default 2;
alter table public.havoc_multiplayer_rooms
  alter column room_protocol_version set default 2;
alter table public.cap_rush_multiplayer_rooms
  alter column room_protocol_version set default 2;

-- 3. Read a room's protocol version without knowing its mode's table layout.

create or replace function multiplayer_private.room_protocol_version(
  p_kind text,
  p_room_id uuid
) returns smallint
language plpgsql
stable
set search_path = ''
as $$
declare v_version smallint;
begin
  if p_room_id is null then return null; end if;
  case p_kind
    when 'fixed-five' then
      select room_protocol_version into v_version
        from public.fixed_five_rooms where id = p_room_id;
    when 'draft-duel' then
      select room_protocol_version into v_version
        from public.draft_duel_rooms where id = p_room_id;
    when 'havoc' then
      select room_protocol_version into v_version
        from public.havoc_multiplayer_rooms where id = p_room_id;
    when 'cap-rush' then
      select room_protocol_version into v_version
        from public.cap_rush_multiplayer_rooms where id = p_room_id;
    else
      raise exception 'invalid-mode';
  end case;
  return v_version;
end $$;

-- 4. Refuse a room the caller cannot speak to.
--
-- The declared version is the client's current *supported* version, not the
-- room's. If the room predates it, the player is told to start a new room.
-- The error code is stable so clients can branch on it instead of parsing text.

create or replace function multiplayer_private.assert_room_protocol(
  p_kind text,
  p_room_id uuid,
  p_client_protocol_version smallint
) returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_required smallint := multiplayer_private.required_room_protocol_version();
  v_room smallint;
begin
  if p_client_protocol_version is null or p_client_protocol_version <> v_required then
    raise exception 'unsupported-protocol'
      using detail = jsonb_build_object(
        'reason', 'unsupported-version',
        'required', v_required,
        'client', p_client_protocol_version
      )::text;
  end if;
  v_room := multiplayer_private.room_protocol_version(p_kind, p_room_id);
  if v_room is not null and v_room <> v_required then
    raise exception 'outdated-room'
      using detail = jsonb_build_object(
        'reason', 'unsupported-version',
        'room', v_room,
        'required', v_required
      )::text,
      hint = 'Start a new room to play.';
  end if;
end $$;

-- 5. Enforce it on the shared sync path.

create or replace function public.multiplayer_room_sync(
  p_mode text,
  p_room_id uuid,
  p_after_ordinal integer default -1,
  p_protocol_version smallint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authorization'; end if;
  if p_after_ordinal is null or p_after_ordinal < -1 then raise exception 'invalid-ordinal'; end if;
  perform multiplayer_private.assert_room_protocol(p_mode, p_room_id, p_protocol_version);
  case p_mode
    when 'fixed-five' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.fixed_five_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.fixed_five_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.fixed_five_rooms r
      where r.id = p_room_id and public.fixed_five_is_member(r.id);
    when 'draft-duel' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.draft_duel_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.draft_duel_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.draft_duel_rooms r
      where r.id = p_room_id and public.draft_duel_is_member(r.id);
    when 'havoc' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.havoc_multiplayer_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.havoc_multiplayer_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.havoc_multiplayer_rooms r
      where r.id = p_room_id and public.havoc_multiplayer_is_member(r.id);
    when 'cap-rush' then
      select jsonb_build_object(
        'room', to_jsonb(r),
        'members', (select coalesce(jsonb_agg(to_jsonb(m) order by m.participant_id), '[]'::jsonb) from public.cap_rush_multiplayer_room_members m where m.room_id = r.id),
        'commands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal), '[]'::jsonb) from public.cap_rush_multiplayer_room_commands c where c.room_id = r.id and c.ordinal > p_after_ordinal)
      ) into v_result
      from public.cap_rush_multiplayer_rooms r
      where r.id = p_room_id and public.cap_rush_multiplayer_is_member(r.id);
    else raise exception 'invalid-mode';
  end case;
  if v_result is null then raise exception 'authorization'; end if;
  return v_result;
end;
$$;

revoke all on function public.multiplayer_room_sync(text, uuid, integer, smallint) from public, anon;
grant execute on function public.multiplayer_room_sync(text, uuid, integer, smallint) to authenticated;

-- The three-argument form stays callable so a still-deployed older client
-- fails with a clear protocol error instead of a function-not-found error.
-- It always refuses, because it cannot declare a protocol version.
create or replace function public.multiplayer_room_sync(
  p_mode text,
  p_room_id uuid,
  p_after_ordinal integer default -1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'unsupported-protocol'
    using detail = jsonb_build_object('reason', 'unsupported-version', 'required', 2)::text,
    hint = 'Reload the page to update, then start a new room.';
end;
$$;

revoke all on function public.multiplayer_room_sync(text, uuid, integer) from public, anon;
grant execute on function public.multiplayer_room_sync(text, uuid, integer) to authenticated;

-- 6. Expose the requirement so clients can assert compatibility up front.

create or replace function public.multiplayer_room_protocol_version()
returns smallint
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select multiplayer_private.required_room_protocol_version() $$;

revoke all on function public.multiplayer_room_protocol_version() from public, anon;
grant execute on function public.multiplayer_room_protocol_version() to authenticated;
