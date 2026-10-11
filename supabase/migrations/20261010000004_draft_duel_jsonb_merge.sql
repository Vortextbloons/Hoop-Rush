-- Draft Duel fix: PostgreSQL jsonb_set does not create missing intermediate
-- objects, so array[key, subkey] writes were silent no-ops. This migration
-- replaces command_submit with the nested merge form for proposal and
-- confirmation bookkeeping.

create or replace function public.draft_duel_command_submit(
  p_room_id uuid, p_command_id text, p_expected_revision integer, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.draft_duel_rooms%rowtype;
  v_member public.draft_duel_room_members%rowtype;
  v_existing public.draft_duel_room_commands%rowtype;
  v_ordinal integer;
  v_kind text;
  v_count integer;
  v_pick_ordinal integer;
  v_next integer;
  v_first text;
  v_picker text;
  v_claimed jsonb;
  v_commitment public.draft_duel_deadline_commitments%rowtype;
  v_game integer;
  v_home text;
  v_away text;
  v_winner text;
  v_series jsonb;
  v_p1 integer;
  v_p2 integer;
  v_code text;
  v_tries integer := 0;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  if octet_length(p_payload::text) > 32768 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'payload-too-large');
  end if;
  if p_command_id is null or octet_length(p_command_id) < 1 or octet_length(p_command_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  v_kind := p_payload->>'kind';
  if v_kind is null or v_kind not in (
    'ready', 'settings', 'start', 'pick', 'timeout-autopick', 'ready-next-game',
    'broadcast-start', 'propose-result', 'confirm-result', 'rematch-request',
    'rematch-confirm', 'leave', 'remove-guest') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
  end if;
  case v_kind
    when 'ready' then
      if jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'settings' then
      if (p_payload->>'fairness' is distinct from 'fair' and p_payload->>'fairness' is distinct from 'unfair')
        or (p_payload->>'presentation' is distinct from 'ratings' and p_payload->>'presentation' is distinct from 'ball-knowledge') then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'pick' then
      if p_payload->>'pickOrdinal' is null
        or (p_payload->>'pickOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'pickOrdinal')::integer not between 0 and 9
        or p_payload->>'playerId' is null
        or (p_payload->>'playerId') !~ '^[a-z0-9][a-z0-9._:-]*$'
        or p_payload->>'playerVersionId' is null
        or (p_payload->>'playerVersionId') !~ '^pv-[0-9a-f]{32}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'timeout-autopick' then
      if p_payload->>'pickOrdinal' is null
        or (p_payload->>'pickOrdinal') !~ '^[0-9]{1,2}$'
        or (p_payload->>'pickOrdinal')::integer not between 0 and 9
        or p_payload->>'playerId' is null
        or (p_payload->>'playerId') !~ '^[a-z0-9][a-z0-9._:-]*$'
        or p_payload->>'playerVersionId' is null
        or (p_payload->>'playerVersionId') !~ '^pv-[0-9a-f]{32}$'
        or p_payload->>'seedPath' is null
        or octet_length(p_payload->>'seedPath') > 256 then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'ready-next-game' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or jsonb_typeof(p_payload->'ready') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'broadcast-start' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7 then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
      if jsonb_exists(p_payload, 'auto') and jsonb_typeof(p_payload->'auto') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'propose-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or (p_payload->>'winner' is distinct from 'p1' and p_payload->>'winner' is distinct from 'p2')
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{64}$'
        or p_payload->>'tapeDigest' is null or (p_payload->>'tapeDigest') !~ '^[0-9a-f]{64}$'
        or p_payload->>'inputDigest' is null or (p_payload->>'inputDigest') !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'confirm-result' then
      if p_payload->>'gameNumber' is null
        or (p_payload->>'gameNumber') !~ '^[0-9]{1,2}$'
        or (p_payload->>'gameNumber')::integer not between 1 and 7
        or p_payload->>'resultDigest' is null or (p_payload->>'resultDigest') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    when 'remove-guest' then
      if p_payload->>'targetParticipantId' is distinct from 'p2' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move');
      end if;
    else
      null;
  end case;
  select * into v_room from public.draft_duel_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.draft_duel_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  select * into v_existing from public.draft_duel_room_commands
    where room_id = p_room_id and command_id = p_command_id limit 1;
  if found then
    if v_existing.actor_participant_id is distinct from v_member.participant_id then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    if v_existing.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'duplicate-command', 'revision', v_room.revision);
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing.ordinal, 'revision', v_room.revision);
  end if;
  if v_room.phase in ('integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'stale-revision', 'revision', v_room.revision);
  end if;
  if v_kind = 'ready' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    update public.draft_duel_room_members
      set ready = (p_payload->>'ready')::boolean, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
  elsif v_kind = 'settings' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    update public.draft_duel_rooms
      set fairness = p_payload->>'fairness', presentation = p_payload->>'presentation'
      where id = p_room_id;
    update public.draft_duel_room_members set ready = false where room_id = p_room_id;
  elsif v_kind = 'start' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    select count(*) into v_count from public.draft_duel_room_members where room_id = p_room_id;
    if v_count < 2 or exists (
      select 1 from public.draft_duel_room_members
      where room_id = p_room_id and ready = false
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
    v_first := public.draft_duel_first_picker(v_room.root_seed);
    update public.draft_duel_rooms
      set phase = 'drafting',
          draft_state = jsonb_build_object(
            'pick_ordinal', 0,
            'first_picker', v_first,
            'claimed_players', '[]'::jsonb),
          series = jsonb_build_object(
            'homeWinner', public.draft_duel_home_winner(v_room.root_seed),
            'games', '[]'::jsonb,
            'p1Wins', 0,
            'p2Wins', 0,
            'currentGameNumber', 1,
            'champion', null),
          deadline_at = now() + interval '60 seconds',
          deadline_cursor = 't0',
          deadline_participant = v_first,
          deadline_pick_ordinal = 0,
          deadline_fallback = null
      where id = p_room_id;
    update public.draft_duel_room_members set next_game_ready = 0, locked = false where room_id = p_room_id;
  elsif v_kind = 'pick' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_pick_ordinal := (p_payload->>'pickOrdinal')::integer;
    v_picker := case
      when v_pick_ordinal % 2 = 0 then v_first
      when v_first = 'p1' then 'p2'
      else 'p1'
    end;
    if v_member.participant_id <> v_picker
      or v_pick_ordinal <> coalesce((v_room.draft_state->>'pick_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb)) e
      where e = p_payload->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken', 'revision', v_room.revision);
    end if;
    v_claimed := coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb) || to_jsonb(p_payload->>'playerId');
    v_next := v_pick_ordinal + 1;
    if v_next >= 10 then
      update public.draft_duel_rooms
        set phase = 'lineup-showdown',
            draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = null,
            deadline_cursor = null,
            deadline_participant = null,
            deadline_pick_ordinal = null,
            deadline_fallback = null
        where id = p_room_id;
    else
      update public.draft_duel_rooms
        set draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = now() + interval '60 seconds',
            deadline_cursor = 't' || v_next::text,
            deadline_participant = case when v_next % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end,
            deadline_pick_ordinal = v_next,
            deadline_fallback = null
        where id = p_room_id;
    end if;
  elsif v_kind = 'timeout-autopick' then
    if v_room.phase <> 'drafting' or v_room.draft_state->>'first_picker' is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_first := v_room.draft_state->>'first_picker';
    v_pick_ordinal := (p_payload->>'pickOrdinal')::integer;
    v_picker := case
      when v_pick_ordinal % 2 = 0 then v_first
      when v_first = 'p1' then 'p2'
      else 'p1'
    end;
    if v_room.deadline_at is null or v_room.deadline_at > now() then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_room.deadline_cursor is null or v_room.deadline_participant is null
      or v_room.deadline_pick_ordinal is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> v_room.deadline_participant
      or v_member.participant_id <> v_picker
      or v_pick_ordinal <> v_room.deadline_pick_ordinal
      or v_pick_ordinal <> coalesce((v_room.draft_state->>'pick_ordinal')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if v_room.deadline_fallback is null or p_payload is distinct from v_room.deadline_fallback then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    select * into v_commitment from public.draft_duel_deadline_commitments
      where room_id = p_room_id
        and cursor = v_room.deadline_cursor
        and participant_id = v_room.deadline_participant
        and pick_ordinal = v_room.deadline_pick_ordinal;
    if not found or v_commitment.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    if p_command_id is distinct from
      ('timeout-' || v_room.deadline_cursor || '-' || v_room.deadline_pick_ordinal::text) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb)) e
      where e = p_payload->>'playerId'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'claim-taken', 'revision', v_room.revision);
    end if;
    v_claimed := coalesce(v_room.draft_state->'claimed_players', '[]'::jsonb) || to_jsonb(p_payload->>'playerId');
    v_next := v_pick_ordinal + 1;
    if v_next >= 10 then
      update public.draft_duel_rooms
        set phase = 'lineup-showdown',
            draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = null,
            deadline_cursor = null,
            deadline_participant = null,
            deadline_pick_ordinal = null,
            deadline_fallback = null
        where id = p_room_id;
    else
      update public.draft_duel_rooms
        set draft_state = jsonb_build_object('pick_ordinal', v_next, 'first_picker', v_first, 'claimed_players', v_claimed),
            deadline_at = now() + interval '60 seconds',
            deadline_cursor = 't' || v_next::text,
            deadline_participant = case when v_next % 2 = 0 then v_first when v_first = 'p1' then 'p2' else 'p1' end,
            deadline_pick_ordinal = v_next,
            deadline_fallback = null
        where id = p_room_id;
    end if;
  elsif v_kind = 'ready-next-game' then
    if v_room.phase not in ('lineup-showdown', 'preparing-game', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    update public.draft_duel_room_members
      set next_game_ready = case when (p_payload->>'ready')::boolean then v_game else 0 end,
          last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
    if (p_payload->>'ready')::boolean and v_room.phase <> 'preparing-game' then
      update public.draft_duel_rooms set phase = 'preparing-game' where id = p_room_id;
    end if;
  elsif v_kind = 'broadcast-start' then
    if v_room.phase <> 'preparing-game' or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    select count(*) into v_count from public.draft_duel_room_members
      where room_id = p_room_id and next_game_ready = v_game;
    if v_count < 2 then
      if coalesce((p_payload->>'auto')::boolean, false) is not true
        or v_room.updated_at > now() - interval '60 seconds' then
        return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
      end if;
      update public.draft_duel_room_members set next_game_ready = v_game where room_id = p_room_id;
    end if;
    update public.draft_duel_rooms
      set phase = 'broadcasting',
          broadcast = jsonb_build_object(
            'gameNumber', v_game,
            'startedAtIso', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'durationMs', 30000)
      where id = p_room_id;
    update public.draft_duel_room_members set next_game_ready = 0 where room_id = p_room_id;
  elsif v_kind = 'propose-result' then
    if v_room.phase not in ('broadcasting', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    v_home := case
      when v_game in (1, 2, 5, 7) then v_room.series->>'homeWinner'
      when v_room.series->>'homeWinner' = 'p1' then 'p2'
      else 'p1'
    end;
    v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
    if p_payload->>'winner' is distinct from v_home and p_payload->>'winner' is distinct from v_away then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    update public.draft_duel_rooms
      set phase = case when phase = 'broadcasting' then 'game-results' else phase end,
          result_digest = p_payload->>'resultDigest',
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
  elsif v_kind = 'confirm-result' then
    if v_room.phase not in ('broadcasting', 'game-results') or v_room.series is null then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    v_game := (p_payload->>'gameNumber')::integer;
    if v_game <> coalesce((v_room.series->>'currentGameNumber')::integer, -1) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'turn', 'revision', v_room.revision);
    end if;
    if not exists (
      select 1 from public.draft_duel_room_commands c
      where c.room_id = p_room_id
        and c.payload->>'kind' = 'propose-result'
        and (c.payload->>'gameNumber')::integer = v_game
        and c.payload->>'resultDigest' = p_payload->>'resultDigest'
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'illegal-move', 'revision', v_room.revision);
    end if;
    update public.draft_duel_rooms
      set phase = case when phase = 'broadcasting' then 'game-results' else phase end,
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
    select * into v_room from public.draft_duel_rooms where id = p_room_id;
    if v_room.game_state->'confirmations'->'p1'->>'gameNumber' = v_game::text
      and v_room.game_state->'confirmations'->'p2'->>'gameNumber' = v_game::text
      and v_room.game_state->'confirmations'->'p1'->>'resultDigest' = v_room.game_state->'confirmations'->'p2'->>'resultDigest'
      and v_room.game_state->'confirmations'->'p1'->>'verified' = 'true'
      and v_room.game_state->'confirmations'->'p2'->>'verified' = 'true' then
      v_winner := coalesce(
        v_room.game_state->'proposals'->'p1'->>'winner',
        v_room.game_state->'proposals'->'p2'->>'winner');
      v_series := v_room.series;
      if v_winner is not null then
        v_home := case
          when v_game in (1, 2, 5, 7) then v_series->>'homeWinner'
          when v_series->>'homeWinner' = 'p1' then 'p2'
          else 'p1'
        end;
        v_away := case when v_home = 'p1' then 'p2' else 'p1' end;
        v_p1 := coalesce((v_series->>'p1Wins')::integer, 0) + case when v_winner = 'p1' then 1 else 0 end;
        v_p2 := coalesce((v_series->>'p2Wins')::integer, 0) + case when v_winner = 'p2' then 1 else 0 end;
        v_series := jsonb_build_object(
          'homeWinner', v_series->>'homeWinner',
          'games', coalesce(v_series->'games', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'gameNumber', v_game,
            'homeParticipantId', v_home,
            'awayParticipantId', v_away,
            'winner', v_winner)),
          'p1Wins', v_p1,
          'p2Wins', v_p2,
          'currentGameNumber', case when v_p1 >= 4 or v_p2 >= 4 then null else v_game + 1 end,
          'champion', case when v_p1 >= 4 then 'p1' when v_p2 >= 4 then 'p2' else null end);
      else
        v_series := jsonb_build_object(
          'homeWinner', v_series->>'homeWinner',
          'games', coalesce(v_series->'games', '[]'::jsonb),
          'p1Wins', coalesce((v_series->>'p1Wins')::integer, 0),
          'p2Wins', coalesce((v_series->>'p2Wins')::integer, 0),
          'currentGameNumber', case when v_game >= 7 then null else v_game + 1 end,
          'champion', null);
      end if;
      if v_series->>'champion' is not null then
        update public.draft_duel_rooms
          set series = v_series,
              phase = 'championship',
              broadcast = null,
              game_state = '{}'::jsonb,
              result_digest = p_payload->>'resultDigest',
              confirmed_digest = p_payload->>'resultDigest',
              code = null,
              code_active = false,
              code_expires_at = null
          where id = p_room_id;
      else
        update public.draft_duel_rooms
          set series = v_series,
              phase = 'preparing-game',
              broadcast = null,
              game_state = '{}'::jsonb,
              confirmed_digest = p_payload->>'resultDigest'
          where id = p_room_id;
      end if;
    end if;
  elsif v_kind = 'rematch-request' then
    if v_room.phase <> 'championship' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
  elsif v_kind = 'rematch-confirm' then
    if v_room.phase <> 'championship' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if not exists (
      select 1 from public.draft_duel_room_commands c
      where c.room_id = p_room_id
        and c.payload->>'kind' = 'rematch-request'
        and c.actor_participant_id <> v_member.participant_id
    ) then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'not-ready', 'revision', v_room.revision);
    end if;
  elsif v_kind = 'leave' then
    update public.draft_duel_room_members set online = false, last_seen_at = now()
      where room_id = p_room_id and uid = auth.uid();
  elsif v_kind = 'remove-guest' then
    if v_room.phase <> 'lobby' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'phase', 'revision', v_room.revision);
    end if;
    if v_member.participant_id <> 'p1' then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    delete from public.draft_duel_room_members where room_id = p_room_id and participant_id = 'p2';
    loop
      v_code := public.draft_duel_random_code();
      begin
        update public.draft_duel_rooms
          set code = v_code, code_active = true, code_expires_at = now() + interval '15 minutes'
          where id = p_room_id;
        exit;
      exception when unique_violation then
        v_tries := v_tries + 1;
        if v_tries > 20 then raise exception 'code collision retry exhausted'; end if;
      end;
    end loop;
  end if;
  v_ordinal := v_room.command_count;
  begin
    insert into public.draft_duel_room_commands (room_id, command_id, ordinal, actor_participant_id, payload)
      values (p_room_id, p_command_id, v_ordinal, v_member.participant_id, p_payload);
  exception when unique_violation then
    select * into v_existing from public.draft_duel_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    if v_existing.actor_participant_id is distinct from v_member.participant_id then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'membership', 'revision', v_room.revision);
    end if;
    if v_existing.payload is distinct from p_payload then
      return jsonb_build_object('accepted', false, 'rejectionCode', 'duplicate-command', 'revision', v_room.revision);
    end if;
    return jsonb_build_object('accepted', true, 'ordinal', v_existing.ordinal, 'revision', v_room.revision);
  end;
  update public.draft_duel_rooms
    set command_count = command_count + 1, revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object(
    'roomId', p_room_id,
    'commandId', p_command_id,
    'accepted', true,
    'rejectionCode', null,
    'ordinal', v_ordinal,
    'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.draft_duel_command_submit(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.draft_duel_command_submit(uuid, text, integer, jsonb) to authenticated;
