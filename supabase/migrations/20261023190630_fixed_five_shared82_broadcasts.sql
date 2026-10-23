-- Shared-82 H2H broadcasts reuse the Duel timing envelope and per-game digest
-- confirmations. The season schedule and completion cursor are coordination
-- facts only; results and tapes remain local to each participant.

alter function public.fixed_five_command_submit(uuid, text, integer, text, jsonb)
  rename to fixed_five_command_submit_legacy;

revoke all on function public.fixed_five_command_submit_legacy(uuid, text, integer, text, jsonb)
  from public, anon, authenticated;

create function public.fixed_five_command_submit(
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
  v_existing_ordinal integer;
  v_existing_actor text;
  v_kind text;
  v_game integer;
  v_candidate_game integer;
  v_game_text text;
  v_next_game integer;
  v_last_game integer;
  v_ordinal integer;
  v_revision integer;
  v_candidate jsonb;
  v_eligible jsonb := '[]'::jsonb;
  v_progress jsonb;
  v_previous integer := 0;
  v_confirmations jsonb;
begin
  select * into v_room from public.fixed_five_rooms where id = p_room_id;
  if not found
    or v_room.mode not in ('classic-shared-82', 'sandbox-shared-82')
    or v_room.versions->>'multiplayerVersion' <> 'fixed-five-multiplayer-v5'
    or p_payload->>'kind' not in ('broadcast-start', 'propose-game-result', 'confirm-game-result') then
    return public.fixed_five_command_submit_legacy(
      p_room_id, p_command_id, p_expected_revision, p_actor, p_payload);
  end if;

  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  if p_payload is null or octet_length(p_payload::text) > 32768
    or p_command_id is null or octet_length(p_command_id) not between 1 and 128
    or p_actor not in ('p1', 'p2') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;

  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select ordinal, actor_participant_id into v_existing_ordinal, v_existing_actor
    from public.fixed_five_room_commands
    where room_id = p_room_id and command_id = p_command_id limit 1;
  if found then
    if v_existing_actor is distinct from p_actor then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    return jsonb_build_object(
      'accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if v_member.participant_id <> p_actor then
    return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'stale-revision', 'revision', v_room.revision);
  end if;
  if v_room.phase in ('completed', 'integrity-failed', 'expired') then
    return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
  end if;

  v_kind := p_payload->>'kind';
  if jsonb_typeof(p_payload->'gameNumber') is distinct from 'number' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  v_game_text := p_payload->>'gameNumber';
  if v_game_text !~ '^[0-9]{1,2}$' then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;
  v_game := v_game_text::integer;
  if v_game not between 1 and 82 then
    return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
  end if;

  if v_kind = 'broadcast-start' then
    if jsonb_exists(p_payload, 'auto')
      and jsonb_typeof(p_payload->'auto') is distinct from 'boolean' then
      return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
    end if;
    if v_room.broadcast->>'gameNumber' = v_game::text
      and v_room.phase in ('broadcasting', 'game-results') then
      null;
    else
      if v_room.phase <> 'simulating' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
      end if;
      if jsonb_typeof(p_payload->'eligibleGameNumbers') is distinct from 'array' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
      if jsonb_array_length(p_payload->'eligibleGameNumbers') not between 1 and 82 then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
      for v_candidate in select value from jsonb_array_elements(p_payload->'eligibleGameNumbers') loop
        if jsonb_typeof(v_candidate) is distinct from 'number' then
          return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
        end if;
        v_game_text := v_candidate #>> '{}';
        if v_game_text !~ '^[0-9]{1,2}$' then
          return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
        end if;
        v_candidate_game := v_game_text::integer;
        if v_candidate_game not between 1 and 82 or v_candidate_game <= v_previous then
          return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
        end if;
        v_previous := v_candidate_game;
        v_eligible := v_eligible || jsonb_build_array(v_previous);
      end loop;
      v_progress := v_room.game_state->'season';
      if v_progress is not null and
        v_progress->'eligibleGameNumbers' is distinct from v_eligible then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
      v_last_game := case
        when v_progress->>'lastCompletedGameNumber' ~ '^[0-9]{1,2}$'
          then (v_progress->>'lastCompletedGameNumber')::integer
        else null
      end;
      select (entries.value #>> '{}')::integer into v_next_game
        from jsonb_array_elements(v_eligible) with ordinality as entries(value, ordinal)
        where v_last_game is null or (entries.value #>> '{}')::integer > v_last_game
        order by entries.ordinal limit 1;
      if v_next_game is distinct from v_game then
        return jsonb_build_object('accepted', false, 'rejection_code', 'turn');
      end if;
    end if;
  else
    if v_room.phase not in ('broadcasting', 'game-results')
      or v_room.broadcast->>'gameNumber' is distinct from v_game::text
      or v_room.game_state->'season' is null then
      return jsonb_build_object('accepted', false, 'rejection_code', 'phase');
    end if;
    if v_kind = 'propose-game-result' then
      if p_payload->>'winner' is null or p_payload->>'winner' not in ('p1', 'p2')
        or p_payload->>'resultDigest' is null
        or p_payload->>'resultDigest' !~ '^[0-9a-f]{64}$'
        or p_payload->>'tapeDigest' is null
        or p_payload->>'tapeDigest' !~ '^[0-9a-f]{64}$'
        or p_payload->>'inputDigest' is null
        or p_payload->>'inputDigest' !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    else
      if p_payload->>'resultDigest' is null
        or p_payload->>'resultDigest' !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(p_payload->'verified') is distinct from 'boolean'
        or not exists (
          select 1 from jsonb_each(coalesce(v_room.game_state->'proposals', '{}'::jsonb)) proposal
          where proposal.value->>'gameNumber' = v_game::text
            and proposal.value->>'resultDigest' = p_payload->>'resultDigest') then
        return jsonb_build_object('accepted', false, 'rejection_code', 'illegal-move');
      end if;
    end if;
  end if;

  v_ordinal := v_room.command_count;
  begin
    insert into public.fixed_five_room_commands
      (room_id, command_id, ordinal, actor_participant_id, payload)
      values (p_room_id, p_command_id, v_ordinal, p_actor, p_payload);
  exception when unique_violation then
    select ordinal, actor_participant_id into v_existing_ordinal, v_existing_actor
      from public.fixed_five_room_commands
      where room_id = p_room_id and command_id = p_command_id limit 1;
    if v_existing_actor is distinct from p_actor then
      return jsonb_build_object('accepted', false, 'rejection_code', 'membership');
    end if;
    return jsonb_build_object(
      'accepted', true, 'ordinal', v_existing_ordinal, 'revision', v_room.revision);
  end;

  if v_kind = 'broadcast-start'
    and v_room.broadcast->>'gameNumber' = v_game::text
    and v_room.phase in ('broadcasting', 'game-results') then
    update public.fixed_five_rooms
      set command_count = command_count + 1, revision = revision + 1, updated_at = now()
      where id = p_room_id returning revision into v_revision;
    return jsonb_build_object('accepted', true, 'ordinal', v_ordinal, 'revision', v_revision);
  elsif v_kind = 'broadcast-start' then
    v_progress := jsonb_build_object(
      'eligibleGameNumbers', v_eligible,
      'lastCompletedGameNumber', coalesce(v_progress->'lastCompletedGameNumber', 'null'::jsonb));
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          phase = 'broadcasting',
          broadcast = jsonb_build_object(
            'gameNumber', v_game,
            'startedAtIso', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'durationMs', 10000),
          game_state = jsonb_set(coalesce(game_state, '{}'::jsonb), '{season}', v_progress, true)
      where id = p_room_id returning revision into v_revision;
  elsif v_kind = 'propose-game-result' then
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          phase = 'game-results',
          game_state = jsonb_set(
            jsonb_set(
              coalesce(game_state, '{}'::jsonb),
              '{proposals}', coalesce(game_state->'proposals', '{}'::jsonb), true),
            array['proposals', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'resultDigest', p_payload->>'resultDigest',
              'tapeDigest', p_payload->>'tapeDigest',
              'inputDigest', p_payload->>'inputDigest',
              'winner', p_payload->>'winner'), true)
      where id = p_room_id returning revision into v_revision;
  else
    update public.fixed_five_rooms
      set command_count = command_count + 1,
          revision = revision + 1,
          updated_at = now(),
          game_state = jsonb_set(
            jsonb_set(
              coalesce(game_state, '{}'::jsonb),
              '{confirmations}', coalesce(game_state->'confirmations', '{}'::jsonb), true),
            array['confirmations', v_member.participant_id],
            jsonb_build_object(
              'gameNumber', v_game,
              'resultDigest', p_payload->>'resultDigest',
              'verified', (p_payload->>'verified')::boolean), true)
      where id = p_room_id returning revision into v_revision;
    select * into v_state from public.fixed_five_rooms where id = p_room_id;
    v_confirmations := v_state.game_state->'confirmations';
    if v_confirmations->'p1'->>'gameNumber' = v_game::text
      and v_confirmations->'p2'->>'gameNumber' = v_game::text
      and v_confirmations->'p1'->>'resultDigest' = v_confirmations->'p2'->>'resultDigest'
      and v_confirmations->'p1'->>'verified' = 'true'
      and v_confirmations->'p2'->>'verified' = 'true' then
      update public.fixed_five_rooms
        set phase = 'simulating',
            broadcast = null,
            game_state = jsonb_build_object(
              'season', jsonb_build_object(
                'eligibleGameNumbers', v_state.game_state->'season'->'eligibleGameNumbers',
                'lastCompletedGameNumber', v_game),
              'proposals', '{}'::jsonb,
              'confirmations', '{}'::jsonb)
        where id = p_room_id returning revision into v_revision;
    end if;
  end if;

  return jsonb_build_object('accepted', true, 'ordinal', v_ordinal, 'revision', v_revision);
end;
$$;

revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) from public;
revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) from anon;
grant execute on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb) to authenticated;
