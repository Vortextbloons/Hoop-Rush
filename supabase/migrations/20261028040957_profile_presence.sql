do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $sql$create policy "fixed five members read profile presence" on realtime.messages for select to authenticated using (realtime.topic() ~ '^profile-fixed-five:[0-9a-f-]{36}$' and public.fixed_five_is_member(substring(realtime.topic() from 20)::uuid))$sql$;
    execute $sql$create policy "fixed five members send profile presence" on realtime.messages for insert to authenticated with check (realtime.topic() ~ '^profile-fixed-five:[0-9a-f-]{36}$' and public.fixed_five_is_member(substring(realtime.topic() from 20)::uuid))$sql$;
    execute $sql$create policy "draft duel members read profile presence" on realtime.messages for select to authenticated using (realtime.topic() ~ '^profile-draft-duel:[0-9a-f-]{36}$' and public.draft_duel_is_member(substring(realtime.topic() from 20)::uuid))$sql$;
    execute $sql$create policy "draft duel members send profile presence" on realtime.messages for insert to authenticated with check (realtime.topic() ~ '^profile-draft-duel:[0-9a-f-]{36}$' and public.draft_duel_is_member(substring(realtime.topic() from 20)::uuid))$sql$;
    execute $sql$create policy "havoc members read profile presence" on realtime.messages for select to authenticated using (realtime.topic() ~ '^profile-havoc-multiplayer:[0-9a-f-]{36}$' and public.havoc_multiplayer_is_member(substring(realtime.topic() from 27)::uuid))$sql$;
    execute $sql$create policy "havoc members send profile presence" on realtime.messages for insert to authenticated with check (realtime.topic() ~ '^profile-havoc-multiplayer:[0-9a-f-]{36}$' and public.havoc_multiplayer_is_member(substring(realtime.topic() from 27)::uuid))$sql$;
    execute $sql$create policy "lobby members read profile presence" on realtime.messages for select to authenticated using (realtime.topic() ~ '^profile-lobby:[0-9a-f-]{36}$' and exists (select 1 from public.multiplayer_lobbies l where l.id = substring(realtime.topic() from 15)::uuid and (select auth.uid()) in (l.host_uid, l.guest_uid)))$sql$;
    execute $sql$create policy "lobby members send profile presence" on realtime.messages for insert to authenticated with check (realtime.topic() ~ '^profile-lobby:[0-9a-f-]{36}$' and exists (select 1 from public.multiplayer_lobbies l where l.id = substring(realtime.topic() from 15)::uuid and (select auth.uid()) in (l.host_uid, l.guest_uid)))$sql$;
  end if;
end $$;
