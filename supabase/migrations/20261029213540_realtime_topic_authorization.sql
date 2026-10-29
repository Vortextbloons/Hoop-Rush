alter policy "dd members read room transient channel" on realtime.messages using (public.draft_duel_is_member(substring(realtime.topic() from '^draft-duel:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));
alter policy "dd members send room transient channel" on realtime.messages with check (public.draft_duel_is_member(substring(realtime.topic() from '^draft-duel:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));

alter policy "hm members read room transient channel" on realtime.messages using (public.havoc_multiplayer_is_member(substring(realtime.topic() from '^havoc-multiplayer:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));
alter policy "hm members send room transient channel" on realtime.messages with check (public.havoc_multiplayer_is_member(substring(realtime.topic() from '^havoc-multiplayer:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));

alter policy "fixed five members read profile presence" on realtime.messages using (public.fixed_five_is_member(substring(realtime.topic() from '^profile-fixed-five:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));
alter policy "fixed five members send profile presence" on realtime.messages with check (public.fixed_five_is_member(substring(realtime.topic() from '^profile-fixed-five:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));

alter policy "draft duel members read profile presence" on realtime.messages using (public.draft_duel_is_member(substring(realtime.topic() from '^profile-draft-duel:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));
alter policy "draft duel members send profile presence" on realtime.messages with check (public.draft_duel_is_member(substring(realtime.topic() from '^profile-draft-duel:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));

alter policy "havoc members read profile presence" on realtime.messages using (public.havoc_multiplayer_is_member(substring(realtime.topic() from '^profile-havoc-multiplayer:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));
alter policy "havoc members send profile presence" on realtime.messages with check (public.havoc_multiplayer_is_member(substring(realtime.topic() from '^profile-havoc-multiplayer:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid));

alter policy "lobby members read profile presence" on realtime.messages using (exists (select 1 from public.multiplayer_lobbies l where l.id = substring(realtime.topic() from '^profile-lobby:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid and (select auth.uid()) in (l.host_uid, l.guest_uid)));
alter policy "lobby members send profile presence" on realtime.messages with check (exists (select 1 from public.multiplayer_lobbies l where l.id = substring(realtime.topic() from '^profile-lobby:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid and (select auth.uid()) in (l.host_uid, l.guest_uid)));
