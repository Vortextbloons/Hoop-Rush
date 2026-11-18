-- Revenge Tour rematch verification.
--
-- The profile achievement needs to know whether a finished room is the direct
-- successor of an earlier room between the same two players, and whether one
-- seat explicitly confirmed the other seat's rematch request. The client can
-- claim that relationship, so this additive predicate verifies it against the
-- stored room and command rows instead.
--
-- Contract:
--   * Only Draft Duel and Havoc are allowlisted. Fixed Five is excluded: its
--     completed phase currently rejects rematch commands, and this migration
--     must not change that behaviour.
--   * Both rooms must have exactly the same two authenticated members, the
--     caller must be one of them, and the predecessor's successor_room_id must
--     be the claimed successor.
--   * The caller declares the current room protocol version; both rooms must
--     speak it. Legacy or malformed rooms fail closed.
--   * One seat's accepted rematch-request followed by the other seat's accepted
--     rematch-confirm proves agreement. The current UI only requires one
--     confirmation in response to the other seat's request, so two confirms are
--     not required.
--   * Every invalid input returns false. The function returns only a boolean,
--     writes nothing, and never exposes raw participant IDs.

create or replace function public.multiplayer_verify_rematch(
  p_kind text,
  p_previous_room_id uuid,
  p_room_id uuid,
  p_protocol_version integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_required integer := multiplayer_private.required_room_protocol_version();
  v_previous_successor_id uuid;
  v_previous_protocol smallint;
  v_successor_protocol smallint;
  v_previous_members uuid[];
  v_successor_members uuid[];
  v_previous_member_count integer;
  v_successor_member_count integer;
  v_confirmed boolean := false;
begin
  if v_uid is null
    or p_kind is null
    or p_previous_room_id is null
    or p_room_id is null
    or p_protocol_version is null
    or p_previous_room_id = p_room_id
    or p_protocol_version <> v_required
    or p_kind not in ('draft-duel', 'havoc') then
    return false;
  end if;

  if p_kind = 'draft-duel' then
    select r.successor_room_id, r.room_protocol_version
      into v_previous_successor_id, v_previous_protocol
      from public.draft_duel_rooms r
      where r.id = p_previous_room_id;
    if not found then
      return false;
    end if;

    select r.room_protocol_version
      into v_successor_protocol
      from public.draft_duel_rooms r
      where r.id = p_room_id;
    if not found then
      return false;
    end if;

    select count(*), array_agg(m.uid order by m.uid)
      into v_previous_member_count, v_previous_members
      from public.draft_duel_room_members m
      where m.room_id = p_previous_room_id;

    select count(*), array_agg(m.uid order by m.uid)
      into v_successor_member_count, v_successor_members
      from public.draft_duel_room_members m
      where m.room_id = p_room_id;

    select exists (
      select 1
      from public.draft_duel_room_commands c
      where c.room_id = p_previous_room_id
        and c.payload->>'kind' = 'rematch-confirm'
        and exists (
          select 1
          from public.draft_duel_room_commands r
          where r.room_id = c.room_id
            and r.payload->>'kind' = 'rematch-request'
            and r.actor_participant_id <> c.actor_participant_id
            and r.ordinal < c.ordinal
        )
    )
    into v_confirmed;
  elsif p_kind = 'havoc' then
    select r.successor_room_id, r.room_protocol_version
      into v_previous_successor_id, v_previous_protocol
      from public.havoc_multiplayer_rooms r
      where r.id = p_previous_room_id;
    if not found then
      return false;
    end if;

    select r.room_protocol_version
      into v_successor_protocol
      from public.havoc_multiplayer_rooms r
      where r.id = p_room_id;
    if not found then
      return false;
    end if;

    select count(*), array_agg(m.uid order by m.uid)
      into v_previous_member_count, v_previous_members
      from public.havoc_multiplayer_room_members m
      where m.room_id = p_previous_room_id;

    select count(*), array_agg(m.uid order by m.uid)
      into v_successor_member_count, v_successor_members
      from public.havoc_multiplayer_room_members m
      where m.room_id = p_room_id;

    select exists (
      select 1
      from public.havoc_multiplayer_room_commands c
      where c.room_id = p_previous_room_id
        and c.payload->>'kind' = 'rematch-confirm'
        and exists (
          select 1
          from public.havoc_multiplayer_room_commands r
          where r.room_id = c.room_id
            and r.payload->>'kind' = 'rematch-request'
            and r.actor_participant_id <> c.actor_participant_id
            and r.ordinal < c.ordinal
        )
    )
    into v_confirmed;
  else
    return false;
  end if;

  if v_previous_successor_id is distinct from p_room_id
    or v_previous_protocol is distinct from v_required::smallint
    or v_successor_protocol is distinct from v_required::smallint
    or v_previous_member_count <> 2
    or v_successor_member_count <> 2
    or v_previous_members is distinct from v_successor_members
    or not (v_uid = any (v_previous_members))
    or not (v_uid = any (v_successor_members))
    or not v_confirmed then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.multiplayer_verify_rematch(text, uuid, uuid, integer)
  from public, anon;
grant execute on function public.multiplayer_verify_rematch(text, uuid, uuid, integer)
  to authenticated;
