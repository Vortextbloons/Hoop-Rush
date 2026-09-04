-- M2.8 fix: a policy on fixed_five_room_members cannot subquery
-- fixed_five_room_members (infinite recursion → 500 on member/command reads).
-- Membership checks run in this definer helper instead.
-- (Already applied to the live project via migration
-- fixed_five_membership_helper.)

create or replace function public.fixed_five_is_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fixed_five_room_members m
    where m.room_id = p_room_id and m.uid = auth.uid()
  );
$$;
revoke all on function public.fixed_five_is_member(uuid) from public;
grant execute on function public.fixed_five_is_member(uuid) to authenticated;

drop policy if exists "ff members read room membership" on public.fixed_five_room_members;
create policy "ff members read room membership"
  on public.fixed_five_room_members for select to authenticated
  using (public.fixed_five_is_member(room_id));
