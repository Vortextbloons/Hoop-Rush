-- fixed_five_verification_submit succeeded but returned a payload without
-- `accepted: true`, so clients treated every accepted receipt as a rejection
-- (`invalid-receipt`), rebuilt and resubmitted forever: the room never left
-- awaiting-confirmation while the receipts table kept upserting and revision
-- kept climbing. Every other fixed-five RPC returns `accepted` explicitly;
-- restore that contract on the success path.
create or replace function public.fixed_five_verification_submit(
  p_room_id uuid, p_receipt_id text, p_receipt jsonb, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.fixed_five_rooms%rowtype;
  v_member public.fixed_five_room_members%rowtype;
  v_command_ids jsonb;
  v_result_digest text;
begin
  if auth.uid() is null then
    raise exception 'anonymous session required' using errcode = '28000';
  end if;
  select * into v_room from public.fixed_five_rooms where id = p_room_id for update;
  if not found then
    raise exception 'authorization' using errcode = 'P0001';
  end if;
  select * into v_member from public.fixed_five_room_members
    where room_id = p_room_id and uid = auth.uid() limit 1;
  if not found then
    raise exception 'membership' using errcode = 'P0001';
  end if;
  if p_receipt_id is null or octet_length(p_receipt_id) < 1 or octet_length(p_receipt_id) > 128 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) is distinct from 'object' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if v_room.phase <> 'awaiting-confirmation' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'phase',
      'revision', v_room.revision);
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_room.revision then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'stale-revision',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'schemaVersion') is distinct from '1'
    or (p_receipt->>'roomId') is distinct from p_room_id::text
    or (p_receipt->>'rootSeed') is distinct from v_room.root_seed then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt->'versions' is distinct from v_room.versions then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'challenge') is distinct from public.fixed_five_verification_challenge(p_room_id) then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if p_receipt->'participantIds' is distinct from '["p1", "p2"]'::jsonb then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  select coalesce(jsonb_agg(c.command_id order by c.ordinal), '[]'::jsonb)
    into v_command_ids
    from public.fixed_five_room_commands c
    where c.room_id = p_room_id;
  if p_receipt->'commandIds' is distinct from v_command_ids then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  v_result_digest := p_receipt->>'resultDigest';
  if v_result_digest is null or v_result_digest !~* '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if (p_receipt->>'receiptDigest') is null
    or (p_receipt->>'receiptDigest') !~* '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if jsonb_typeof(p_receipt->'gameSeeds') is distinct from 'array' then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  if jsonb_array_length(p_receipt->'gameSeeds') < 1 then
    return jsonb_build_object('accepted', false, 'rejectionCode', 'invalid-receipt',
      'revision', v_room.revision);
  end if;
  insert into public.fixed_five_verification_receipts
    (room_id, participant_id, receipt_id, receipt)
    values (p_room_id, v_member.participant_id, p_receipt_id, p_receipt)
    on conflict (room_id, participant_id)
    do update set receipt_id = excluded.receipt_id, receipt = excluded.receipt, created_at = now();
  update public.fixed_five_rooms
    set revision = revision + 1, updated_at = now()
    where id = p_room_id;
  return jsonb_build_object('accepted', true, 'receiptId', p_receipt_id,
    'revision', v_room.revision + 1);
end;
$$;
revoke all on function public.fixed_five_verification_submit(uuid, text, jsonb, integer) from public;
grant execute on function public.fixed_five_verification_submit(uuid, text, jsonb, integer) to authenticated;