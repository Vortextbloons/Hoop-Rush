do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_room_members' and policyname='members may update own member') then
    create policy "members may update own member"
    on public.season_room_members for update
    to authenticated
    using (uid = auth.uid())
    with check (uid = auth.uid());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_room_members' and policyname='members may delete own member') then
    create policy "members may delete own member"
    on public.season_room_members for delete
    to authenticated
    using (uid = auth.uid());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_rooms' and policyname='members may update their room') then
    create policy "members may update their room"
    on public.season_rooms for update
    to authenticated
    using (exists (select 1 from public.season_room_members m where m.room_id = season_rooms.id and m.uid = auth.uid()))
    with check (exists (select 1 from public.season_room_members m where m.room_id = season_rooms.id and m.uid = auth.uid()));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_rooms' and policyname='members may delete their room') then
    create policy "members may delete their room"
    on public.season_rooms for delete
    to authenticated
    using (exists (select 1 from public.season_room_members m where m.room_id = season_rooms.id and m.uid = auth.uid()));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_room_members' and policyname='members may insert own member') then
    create policy "members may insert own member"
    on public.season_room_members for insert
    to authenticated
    with check (uid = auth.uid());
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_join_attempts' and policyname='authenticated may insert join attempts') then
    create policy "authenticated may insert join attempts"
    on public.season_join_attempts for insert
    to authenticated
    with check (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='season_join_attempts' and policyname='authenticated may read own attempts') then
    create policy "authenticated may read own attempts"
    on public.season_join_attempts for select
    to authenticated
    using (true);
  end if;
end $$;
;
