-- Fixed-five multiplayer v5 adds the Duel broadcast protocol:
--   * rooms gain series, broadcast, and game_state coordination columns;
--   * members gain next_game_ready for per-game readiness;
--   * ready-next-game, broadcast-start, propose-game-result and
--     confirm-game-result coordinate one recorded game at a time;
--   * the draft completes into preparing-game once ten picks land;
--   * four confirmed wins move the room to awaiting-confirmation, where the
--     existing propose-result/confirm-result receipt flow finishes the match.
-- Older rooms (v3/v4) keep their original protocol: the new kinds are gated
-- to v5 duel rooms and the engine ignores them for older versions.
-- The server multiplayerVersion lock moves to fixed-five-multiplayer-v5.

alter table public.fixed_five_rooms add column if not exists series jsonb;
alter table public.fixed_five_rooms add column if not exists broadcast jsonb;
alter table public.fixed_five_rooms add column if not exists game_state jsonb;
alter table public.fixed_five_room_members add column if not exists next_game_ready smallint;

alter table public.fixed_five_rooms drop constraint if exists fixed_five_rooms_phase_check;
alter table public.fixed_five_rooms add constraint fixed_five_rooms_phase_check check (
  phase in (
    'lobby', 'drafting', 'simulating', 'preparing-game', 'broadcasting',
    'game-results', 'awaiting-confirmation', 'completed', 'integrity-failed', 'expired'
  )
);

alter table public.fixed_five_room_members
  drop constraint if exists fixed_five_room_members_next_game_ready_check;
alter table public.fixed_five_room_members
  add constraint fixed_five_room_members_next_game_ready_check
  check (next_game_ready is null or next_game_ready between 1 and 7);

insert into public.fixed_five_server_versions (key, value) values
  ('multiplayerVersion', 'fixed-five-multiplayer-v5')
on conflict (key) do update set value = excluded.value;

create or replace function public.fixed_five_command_submit(
  p_room_id uuid,
  p_command_id text,
  p_expected_revision integer,
  p_actor text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_state public.fixed_five_rooms%rowtype;
  v_member public.fixed_five_room_members%rowtype;
  v_ordinal integer;
  v_existing_ordinal integer;
  v_existing_actor text;
  v_kind text;
  v_step interval;
  v_next_cursor text;
  v_next_ordinal integer;
  v_commitment public.fixed_five_deadline_commitments%rowtype;
  v_is_sandbox_snake boolean;
  v_reposition_aware boolean;
  v_duel_broadcast boolean;
  v_game integer;
  v_home text;
  v_away text;
  v_winner text;
  v_p1 integer;
  v_p2 integer;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'payload-too-large');
  end if;
  if p_command_id is null or octet_length(p_command_id) < 1 or octet_length(p_command_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  if p_actor is null or p_actor not in ('p1', 'p2') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  v_kind := p_payload->>'kind';
  if v_kind is null or v_kind not in (
    'ready', 'start',
    'reroll', 'classic-pick', 'classic-reposition', 'duel-claim', 'duel-reposition',
    'sandbox-place', 'sandbox-reposition', 'sandbox-remove', 'sandbox-lock',
    'timeout-autopick',
    'ready-next-game', 'broadcast-start', 'propose-game-result', 'confirm-game-result',
    'propose-result', 'confirm-result',
    'rematch-request', 'rematch-confirm',
    'leave', 'remove-guest'
  ) then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  case v_kind
    when 'ready' then
      if jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'reroll' then
      if p_payload->>'axis' is distinct from 'franchise'
        and p_payload->>'axis' is distinct from 'era' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'classic-pick', 'classic-reposition' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'duel-claim' then
      if p_payload->>'playerId' is null
        or p_payload->>'franchiseId' is null
        or p_payload->>'eraId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'duel-reposition' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'sandbox-place', 'sandbox-reposition' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'sandbox-remove' then
      if (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]+$'
        or (p_payload->>'slotIndex')::integer not between 0 and 4) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'timeout-autopick' then
      if p_payload->>'playerId' is null
        or (p_payload->>'slotIndex' is null or p_payload->>'slotIndex' !~ '^[0-9]{1,2}$'
          or (p_payload->>'slotIndex')::integer not between 0 and 4)
        or (p_payload->>'pickOrdinal' is null or p_payload->>'pickOrdinal' !~ '^[0-9]{1,6}$')
        or p_payload->>'seedPath' is null then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'ready-next-game' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'broadcast-start' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7 then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
      if jsonb_exists(p_payload, 'auto')
        and jsonb_typeof(p_payload->'auto') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'propose-game-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or (p_payload->>'winner' is distinct from 'p1' and p_payload->>'winner' is distinct from 'p2')
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{64}$'
        or p_payload->>'tapeDigest' is null or (p_payload->>'tapeDigest') !~ '^[0-9a-f]{64}$'
        or p_payload->>'inputDigest' is null or (p_payload->>'inputDigest') !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'confirm-game-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'propose-result' then
      if p_payload->>'resultDigest' is null
        or octet_length(p_payload->>'resultDigest') not between 32 and 256 then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'confirm-result' then
      if p_payload->>'resultDigest' is null
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    when 'remove-guest' then
      if p_payload->>'targetParticipantId' is distinct from 'p2' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    else
      null;
  end case;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  v_is_sandbox_snake :=
    v_room.versions->>'multiplayerVersion' in (
      'fixed-five-multiplayer-v3', 'fixed-five-multiplayer-v4', 'fixed-five-multiplayer-v5')
    and (
      v_room.mode = 'sandbox-shared-82'
      or (v_room.mode = 'duel' and v_room.source_mode = 'sandbox')
    );
  v_reposition_aware :=
    v_room.versions->>'multiplayerVersion' in (
      'fixed-five-multiplayer-v4', 'fixed-five-multiplayer-v5');
  v_duel_broadcast :=
    v_room.mode = 'duel'
    and v_room.versions->>'multiplayerVersion' = 'fixed-five-multiplayer-v5';
  if v_kind = 'duel-reposition'
    and (v_room.mode <> 'duel' or not v_reposition_aware) then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  if v_kind = 'sandbox-reposition' and v_is_sandbox_snake and not v_reposition_aware then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  select ordinal, actor_participant_id into v_existing_ordinal, v_existing_actor
    from public.fixed_five_room_commands
    where room_id = p_room_id and command_id = p_command_id limit 1;
  if found then
    if v_existing_actor is distinct from p_actor then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end if;
  if v_kind = 'start' and v_room.phase <> 'lobby' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_kind = 'remove-guest'
    and (v_room.phase <> 'lobby' or v_member.participant_id <> 'p1') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_member.participant_id <> p_actor then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  if v_is_sandbox_snake and v_kind = 'sandbox-place' then
    if v_room.phase <> 'drafting'
      or v_room.deadline_participant is null
      or v_room.deadline_pick_ordinal is null
      or v_room.deadline_pick_ordinal >= 10
      or p_actor <> v_room.deadline_participant then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
  end if;
  if v_is_sandbox_snake and v_kind in ('sandbox-place', 'timeout-autopick') then
    if exists (
      select 1
      from public.fixed_five_room_commands prior
      where prior.room_id = p_room_id
        and prior.payload->>'kind' in ('sandbox-place', 'timeout-autopick')
        and prior.payload->>'playerId' = p_payload->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if not v_reposition_aware and exists (
      select 1
      from public.fixed_five_room_commands prior
      where prior.room_id = p_room_id
        and prior.actor_participant_id = p_actor
        and prior.payload->>'kind' in ('sandbox-place', 'timeout-autopick')
        and prior.payload->>'slotIndex' = p_payload->>'slotIndex'
    ) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
  end if;
  if v_kind = 'timeout-autopick' then
    if v_room.deadline_at is null or v_room.deadline_at > now() then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_cursor is null or v_room.deadline_participant is null
      or v_room.deadline_pick_ordinal is null then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if p_actor <> v_room.deadline_participant then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if (p_payload->>'pickOrdinal')::integer <> v_room.deadline_pick_ordinal then
      return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
    end if;
    if v_room.deadline_fallback is null or p_payload is distinct from v_room.deadline_fallback then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    select * into v_commitment from public.fixed_five_deadline_commitments
      where room_id = p_room_id
        and cursor = v_room.deadline_cursor
        and participant_id = p_actor
        and pick_ordinal = v_room.deadline_pick_ordinal;
    if not found or v_commitment.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if p_command_id is distinct from
      ('timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text) then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejection_code', 'stale-revision', 'revision', v_room.revision);
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;
  if v_kind in ('ready-next-game', 'broadcast-start', 'propose-game-result', 'confirm-game-result') then
    if not v_duel_broadcast then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_kind = 'ready-next-game' then
      if v_room.phase <> 'preparing-game' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
      end if;
      if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
      end if;
    elsif v_kind = 'broadcast-start' then
      if v_room.phase <> 'preparing-game' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
      end if;
      if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
      end if;
      select count(*) into v_count from public.fixed_five_room_members
        where room_id = p_room_id and next_game_ready = v_game;
      if v_count < 2 then
        if coalesce((p_payload->>'auto')::boolean, false) is not true
          or v_room.updated_at > now() - interval '60 seconds' then
          return jsonb_build_object('accepted', false, 'rejection_code', 'not-ready');
        end if;
      end if;
    elsif v_kind = 'propose-game-result' then
      if v_room.phase not in ('broadcasting', 'game-results') then
        return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
      end if;
      if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
      end if;
      v_home := case when v_game % 2 = 1 then 'p1' else 'p2' end;
      v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
      if p_payload->>'winner' is distinct from v_home
        and p_payload->>'winner' is distinct from v_away then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    else
      if v_room.phase not in ('broadcasting', 'game-results') then
        return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
      end if;
      if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
      end if;
      if not exists (
        select 1 from public.fixed_five_room_commands c
        where c.room_id = p_room_id
          and c.payload->>'kind' = 'propose-game-result'
          and (c.payload->>'gameNumber')::integer = v_game
          and c.payload->>'resultDigest' = p_payload->>'resultDigest'
      ) then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    end if;
  end if;
  v_ordinal := v_room.command_count;
  begin
    insert into public.fixed_five_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
      values (p_room_id, p_command_id, v_ordinal, p_actor, p_payload);
  exception when unique_violation then
    select ordinal, actor_participant_id into v_existing_ordinal, v_existing_actor
      from public.fixed_five_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    if v_existing_actor is distinct from p_actor then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end;
  if v_room.mode = 'sandbox-shared-82' then
    v_step := interval '5 minutes';
  else
    v_step := interval '90 seconds';
  end if;
  if v_kind = 'timeout-autopick'
    or (v_is_sandbox_snake and v_kind = 'sandbox-place') then
    v_next_ordinal := v_room.deadline_pick_ordinal + 1;
    if v_is_sandbox_snake then
      v_next_cursor := 't' || v_next_ordinal::text;
      if v_next_ordinal >= 10 then
        update public.fixed_five_rooms
          set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
              deadline_cursor = v_next_cursor,
              deadline_participant = null,
              deadline_pick_ordinal = v_next_ordinal,
              deadline_at = null,
              deadline_fallback = null
          where id = p_room_id;
      else
        update public.fixed_five_rooms
          set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
              deadline_cursor = v_next_cursor,
              deadline_participant = public.fixed_five_sandbox_picker(v_room.root_seed, v_next_ordinal),
              deadline_pick_ordinal = v_next_ordinal,
              deadline_at = now() + v_step,
              deadline_fallback = null
          where id = p_room_id;
      end if;
    else
      v_next_cursor := 't' || v_next_ordinal::text;
      update public.fixed_five_rooms
        set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
            deadline_cursor = v_next_cursor,
            deadline_participant = case when v_room.deadline_participant = 'p1' then 'p2' else 'p1' end,
            deadline_pick_ordinal = v_next_ordinal,
            deadline_at = now() + v_step,
            deadline_fallback = null
        where id = p_room_id;
    end if;
  elsif v_kind = 'start' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'drafting',
          deadline_cursor = 't0',
          deadline_participant = case
            when v_is_sandbox_snake then public.fixed_five_sandbox_picker(v_room.root_seed, 0)
            else 'p1'
          end,
          deadline_pick_ordinal = 0,
          deadline_at = now() + v_step,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_kind = 'propose-result' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'awaiting-confirmation'
      where id = p_room_id;
  elsif v_duel_broadcast and v_kind = 'ready-next-game' then
    update public.fixed_five_room_members
      set next_game_ready = case when (p_payload->>'ready')::boolean then v_game else null end,
          last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now()
      where id = p_room_id;
  elsif v_duel_broadcast and v_kind = 'broadcast-start' then
    update public.fixed_five_room_members
      set next_game_ready = null
      where room_id = p_room_id;
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'broadcasting',
          broadcast = jsonb_build_object(
            'gameNumber', v_game,
            'startedAtIso', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'durationMs', 10000)
      where id = p_room_id;
  elsif v_duel_broadcast and v_kind = 'propose-game-result' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          phase = 'game-results',
          game_state = jsonb_set(
            jsonb_set(
              coalesce(game_state, '{}'::jsonb),
              array['proposals'],
              coalesce(game_state->'proposals', '{}'::jsonb),
              true),
            array['proposals', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'resultDigest', p_payload->>'resultDigest',
              'tapeDigest', p_payload->>'tapeDigest',
              'inputDigest', p_payload->>'inputDigest',
              'winner', p_payload->>'winner'),
            true)
      where id = p_room_id;
  elsif v_duel_broadcast and v_kind = 'confirm-game-result' then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now(),
          game_state = jsonb_set(
            jsonb_set(
              coalesce(game_state, '{}'::jsonb),
              array['confirmations'],
              coalesce(game_state->'confirmations', '{}'::jsonb),
              true),
            array['confirmations', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'resultDigest', p_payload->>'resultDigest',
              'verified', (p_payload->>'verified')::boolean),
            true)
      where id = p_room_id;
    select * into v_state from public.fixed_five_rooms where id = p_room_id;
    if v_state.game_state->'confirmations'->'p1'->>'gameNumber' = v_game::text
      and v_state.game_state->'confirmations'->'p2'->>'gameNumber' = v_game::text
      and v_state.game_state->'confirmations'->'p1'->>'resultDigest'
        = v_state.game_state->'confirmations'->'p2'->>'resultDigest'
      and v_state.game_state->'confirmations'->'p1'->>'verified' = 'true'
      and v_state.game_state->'confirmations'->'p2'->>'verified' = 'true' then
      v_winner := coalesce(
        case when v_state.game_state->'proposals'->'p1'->>'resultDigest'
            = v_state.game_state->'confirmations'->'p1'->>'resultDigest'
          then v_state.game_state->'proposals'->'p1'->>'winner' end,
        case when v_state.game_state->'proposals'->'p2'->>'resultDigest'
            = v_state.game_state->'confirmations'->'p1'->>'resultDigest'
          then v_state.game_state->'proposals'->'p2'->>'winner' end);
      if v_winner is not null then
        v_home := case when v_game % 2 = 1 then 'p1' else 'p2' end;
        v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
        v_p1 := coalesce((v_state.series->>'p1Wins')::integer, 0)
          + case when v_winner = 'p1' then 1 else 0 end;
        v_p2 := coalesce((v_state.series->>'p2Wins')::integer, 0)
          + case when v_winner = 'p2' then 1 else 0 end;
        if v_p1 >= 4 or v_p2 >= 4 then
          update public.fixed_five_rooms
            set series = jsonb_build_object(
                  'games', coalesce(v_state.series->'games', '[]'::jsonb)
                    || jsonb_build_array(jsonb_build_object(
                      'gameNumber', v_game,
                      'homeParticipantId', v_home,
                      'awayParticipantId', v_away,
                      'winner', v_winner)),
                  'p1Wins', v_p1,
                  'p2Wins', v_p2,
                  'currentGameNumber', null,
                  'champion', case when v_p1 >= 4 then 'p1' else 'p2' end),
                phase = 'awaiting-confirmation',
                broadcast = null,
                game_state = '{}'::jsonb
            where id = p_room_id;
        else
          update public.fixed_five_rooms
            set series = jsonb_build_object(
                  'games', coalesce(v_state.series->'games', '[]'::jsonb)
                    || jsonb_build_array(jsonb_build_object(
                      'gameNumber', v_game,
                      'homeParticipantId', v_home,
                      'awayParticipantId', v_away,
                      'winner', v_winner)),
                  'p1Wins', v_p1,
                  'p2Wins', v_p2,
                  'currentGameNumber', v_game + 1,
                  'champion', null),
                phase = 'preparing-game',
                broadcast = null,
                game_state = '{}'::jsonb
            where id = p_room_id;
        end if;
        update public.fixed_five_room_members
          set next_game_ready = null
          where room_id = p_room_id;
      end if;
    end if;
  else
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now()
      where id = p_room_id;
  end if;
  if v_duel_broadcast then
    select * into v_state from public.fixed_five_rooms where id = p_room_id;
    if v_state.series is null then
      select count(*) into v_count
        from public.fixed_five_room_commands
        where room_id = p_room_id
          and payload->>'kind' in ('duel-claim', 'classic-pick', 'sandbox-place', 'timeout-autopick');
      if v_count >= 10 then
        update public.fixed_five_rooms
          set phase = 'preparing-game',
              series = jsonb_build_object(
                'games', '[]'::jsonb,
                'p1Wins', 0,
                'p2Wins', 0,
                'currentGameNumber', 1,
                'champion', null),
              broadcast = null,
              game_state = '{}'::jsonb,
              deadline_at = null,
              deadline_cursor = null,
              deadline_participant = null,
              deadline_pick_ordinal = null,
              deadline_fallback = null
          where id = p_room_id;
        update public.fixed_five_room_members
          set next_game_ready = null
          where room_id = p_room_id;
      end if;
    end if;
  end if;
  return jsonb_build_object('accepted', true, 'ordinal', v_ordinal, 'revision', v_room.revision + 1);
end;
$$;

revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) from public;
grant execute on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) to authenticated;

create or replace function public.fixed_five_timeout_apply(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_state public.fixed_five_rooms%rowtype;
  v_commitment public.fixed_five_deadline_commitments%rowtype;
  v_command_id text;
  v_next_cursor text;
  v_ordinal integer;
  v_next_ordinal integer;
  v_step interval;
  v_is_sandbox_snake boolean;
  v_count integer;
begin
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'authorization');
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_at is null or v_room.deadline_at > now() then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'not-due',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  if v_room.deadline_cursor is null or v_room.deadline_participant is null
    or v_room.deadline_pick_ordinal is null then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'no-commitment',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  select * into v_commitment from public.fixed_five_deadline_commitments
    where room_id = p_room_id
      and cursor = v_room.deadline_cursor
      and participant_id = v_room.deadline_participant
      and pick_ordinal = v_room.deadline_pick_ordinal;
  if not found then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'no-commitment',
      'roomId', p_room_id, 'revision', v_room.revision);
  end if;
  v_command_id := 'timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text;
  select ordinal into v_ordinal from public.fixed_five_room_commands
    where room_id = p_room_id and command_id = v_command_id limit 1;
  if found then
    return jsonb_build_object(
      'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
      'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision,
      'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
      'pickOrdinal', v_room.deadline_pick_ordinal);
  end if;
  if v_room.mode = 'sandbox-shared-82' then
    v_step := interval '5 minutes';
  else
    v_step := interval '90 seconds';
  end if;
  v_is_sandbox_snake :=
    v_room.versions->>'multiplayerVersion' in (
      'fixed-five-multiplayer-v3', 'fixed-five-multiplayer-v4', 'fixed-five-multiplayer-v5')
    and (
      v_room.mode = 'sandbox-shared-82'
      or (v_room.mode = 'duel' and v_room.source_mode = 'sandbox')
    );
  v_next_ordinal := v_room.deadline_pick_ordinal + 1;
  v_next_cursor := 't' || v_next_ordinal::text;
  v_ordinal := v_room.command_count;
  insert into public.fixed_five_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
    values (p_room_id, v_command_id, v_ordinal, v_room.deadline_participant, v_commitment.payload);
  if v_is_sandbox_snake and v_next_ordinal >= 10 then
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = null,
          deadline_pick_ordinal = v_next_ordinal,
          deadline_at = null,
          deadline_fallback = null
      where id = p_room_id;
  elsif v_is_sandbox_snake then
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = public.fixed_five_sandbox_picker(v_room.root_seed, v_next_ordinal),
          deadline_pick_ordinal = v_next_ordinal,
          deadline_at = now() + v_step,
          deadline_fallback = null
      where id = p_room_id;
  else
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          deadline_cursor = v_next_cursor,
          deadline_participant = case when v_room.deadline_participant = 'p1' then 'p2' else 'p1' end,
          deadline_pick_ordinal = v_next_ordinal,
          deadline_at = now() + v_step,
          deadline_fallback = null
      where id = p_room_id;
  end if;
  if v_room.mode = 'duel'
    and v_room.versions->>'multiplayerVersion' = 'fixed-five-multiplayer-v5' then
    select * into v_state from public.fixed_five_rooms where id = p_room_id;
    if v_state.series is null then
      select count(*) into v_count
        from public.fixed_five_room_commands
        where room_id = p_room_id
          and payload->>'kind' in ('duel-claim', 'classic-pick', 'sandbox-place', 'timeout-autopick');
      if v_count >= 10 then
        update public.fixed_five_rooms
          set phase = 'preparing-game',
              series = jsonb_build_object(
                'games', '[]'::jsonb,
                'p1Wins', 0,
                'p2Wins', 0,
                'currentGameNumber', 1,
                'champion', null),
              broadcast = null,
              game_state = '{}'::jsonb,
              deadline_at = null,
              deadline_cursor = null,
              deadline_participant = null,
              deadline_pick_ordinal = null,
              deadline_fallback = null
          where id = p_room_id;
        update public.fixed_five_room_members
          set next_game_ready = null
          where room_id = p_room_id;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'roomId', p_room_id, 'accepted', true, 'rejectionCode', null,
    'commandId', v_command_id, 'ordinal', v_ordinal, 'revision', v_room.revision + 1,
    'cursor', v_room.deadline_cursor, 'participantId', v_room.deadline_participant,
    'pickOrdinal', v_room.deadline_pick_ordinal);
end;
$$;

revoke all on function public.fixed_five_timeout_apply(uuid) from public;
revoke all on function public.fixed_five_timeout_apply(uuid) from anon;
revoke all on function public.fixed_five_timeout_apply(uuid) from authenticated;
grant execute on function public.fixed_five_timeout_apply(uuid) to service_role;

-- Anonymous sessions must never call game RPCs. Newer Supabase images attach
-- default execute grants to anon, so state the intent explicitly.
revoke all on function public.fixed_five_room_create(text, text, text, jsonb) from anon;
revoke all on function public.fixed_five_room_preview(text) from anon;
revoke all on function public.fixed_five_room_join(text) from anon;
revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) from anon;
revoke all on function public.fixed_five_commit_fallback(uuid, text, jsonb, integer) from anon;
revoke all on function public.fixed_five_timeout_resolve(uuid) from anon;
revoke all on function public.fixed_five_verification_challenge(uuid) from anon;
revoke all on function public.fixed_five_verification_submit(uuid, text, jsonb, integer) from anon;
revoke all on function public.fixed_five_complete(uuid, text) from anon;
revoke all on function public.fixed_five_fail(uuid) from anon;
revoke all on function public.fixed_five_guest_remove(uuid, text) from anon;
revoke all on function public.fixed_five_leave(uuid) from anon;
revoke all on function public.fixed_five_rematch(uuid) from anon;
