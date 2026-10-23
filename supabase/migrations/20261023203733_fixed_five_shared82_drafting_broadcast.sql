alter function public.fixed_five_command_submit(uuid, text, integer, text, jsonb)
  set schema multiplayer_private;

alter function multiplayer_private.fixed_five_command_submit(uuid, text, integer, text, jsonb)
  rename to fixed_five_command_submit_shared82_core;

revoke all on function multiplayer_private.fixed_five_command_submit_shared82_core(uuid, text, integer, text, jsonb)
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
  v_draft_ready boolean := false;
  v_promoted boolean := false;
  v_result jsonb;
begin
  if p_payload->>'kind' = 'broadcast-start' then
    select * into v_room
      from public.fixed_five_rooms
      where id = p_room_id
      for update;

    if found
      and v_room.phase = 'drafting'
      and v_room.mode in ('classic-shared-82', 'sandbox-shared-82')
      and v_room.versions->>'multiplayerVersion' = 'fixed-five-multiplayer-v5'
      and not exists (
        select 1 from public.fixed_five_room_commands
        where room_id = p_room_id and command_id = p_command_id
      ) then
      if v_room.mode = 'classic-shared-82' then
        select count(*) >= 10 into v_draft_ready
          from public.fixed_five_room_commands
          where room_id = p_room_id
            and payload->>'kind' in ('classic-pick', 'timeout-autopick');
      else
        select count(distinct actor_participant_id) = 2 into v_draft_ready
          from public.fixed_five_room_commands
          where room_id = p_room_id and payload->>'kind' = 'sandbox-lock';
      end if;

      if v_draft_ready then
        update public.fixed_five_rooms set phase = 'simulating' where id = p_room_id;
        v_promoted := true;
      end if;
    end if;
  end if;

  v_result := public.fixed_five_command_submit_shared82_core(
    p_room_id, p_command_id, p_expected_revision, p_actor, p_payload);

  if v_promoted and v_result->>'accepted' is distinct from 'true' then
    update public.fixed_five_rooms set phase = 'drafting'
      where id = p_room_id and phase = 'simulating';
  end if;

  return v_result;
end;
$$;

revoke all on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb)
  from public, anon;
grant execute on function public.fixed_five_command_submit(uuid, text, integer, text, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
