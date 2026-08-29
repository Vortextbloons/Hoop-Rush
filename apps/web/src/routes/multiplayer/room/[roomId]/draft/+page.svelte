<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    Trophy,
    Users,
    Clock,
    Shield,
    ArrowLeft,
    RefreshCw,
    AlertTriangle,
  } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import {
    createSupabaseSeasonTransport,
    isSupabaseConfigured,
  } from '$lib/season/supabase-season-transport';
  import { loadMembership } from '$lib/season/season-room-identity';
  import type { SeasonRoomPublicSnapshot, SeasonRoomMembership } from '@hoop-rush/data-contracts';
  import { seasonRootSeed } from '$lib/season/season-ids';

  let roomId = $derived($page.params.roomId as string);

  let snap = $state<SeasonRoomPublicSnapshot | null>(null);
  let membership = $state<SeasonRoomMembership | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let coordinator: ReturnType<typeof createInMemorySeasonRoomCoordinator> | null = null;
  let transport: ReturnType<typeof createSupabaseSeasonTransport> | null = null;

  function getCoordinator() {
    const useSupabase = isSupabaseConfigured();
    transport = useSupabase
      ? createSupabaseSeasonTransport({
          url:
            (import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_URL ?? '',
          publishableKey:
            (import.meta as unknown as { env: Record<string, string> }).env
              .VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
        })
      : null;
    const t = (transport ?? undefined) as unknown as
      import('@hoop-rush/data-contracts').SeasonMultiplayerTransport | undefined;
    return createInMemorySeasonRoomCoordinator({
      transport: t,
      onSnapshot: (s) => (snap = s),
      onCommands: () => {},
    });
  }

  async function load() {
    loading = true;
    error = null;
    try {
      coordinator = getCoordinator();
      membership = loadMembership(roomId);
      try {
        coordinator.hydrateFromStorage(roomId);
      } catch {}
      membership = loadMembership(roomId) ?? membership;
      const t = transport as unknown as
        import('@hoop-rush/data-contracts').SeasonMultiplayerTransport | null;
      if (t) {
        snap = await t.resume(roomId);
      } else if (coordinator) {
        const anyCoord = coordinator as unknown as {
          transport?: { resume: (id: string) => Promise<SeasonRoomPublicSnapshot> };
        };
        if (anyCoord.transport) snap = await anyCoord.transport.resume(roomId);
        else throw new Error('Multiplayer not configured');
      }
      if (!membership) {
        // try to infer from coordinator state after resume
        const st = coordinator.state;
        if (st.participantId && st.franchiseId) {
          membership = loadMembership(roomId);
        }
      }
      if (snap) coordinator.subscribe(roomId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    return () => coordinator?.destroy();
  });

  let modeLabel = $derived.by(() => {
    const raw = (snap?.settings as unknown as { mode?: string })?.mode ?? 'season';
    return raw === 'season' ? 'Season Run' : raw;
  });
  let isHost = $derived(membership?.participantId === 'p1');
  let youLabel = $derived(
    membership
      ? isHost
        ? 'You are Host · P1'
        : 'You joined as Guest · P2'
      : 'No membership — rejoin from invite code',
  );
</script>

<svelte:head><title>Draft · Room {roomId.slice(0, 8)} — Hoop Rush</title></svelte:head>

<section class="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex items-center justify-between gap-3 py-6">
    <a
      href={`/multiplayer/room/${roomId}`}
      class="text-label inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      ><ArrowLeft class="h-3.5 w-3.5" /> Back to lobby</a
    >
    <button
      type="button"
      onclick={load}
      class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold hover:border-line-strong"
      ><RefreshCw class="h-3.5 w-3.5" />Refresh</button
    >
  </div>

  {#if loading}
    <div class="rounded-xl bg-surface-1 p-10 text-center">
      <p class="font-mono text-sm text-muted-foreground">Loading draft…</p>
    </div>
  {:else if error}
    <div class="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
      <div class="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle class="h-4 w-4" />Could not load draft
      </div>
      <p class="mt-2 text-sm text-muted-foreground">{error}</p>
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          onclick={load}
          class="rounded-lg bg-card px-4 py-2 text-sm font-semibold">Retry</button
        >
        <a
          href={`/multiplayer/room/${roomId}`}
          class="rounded-lg border border-line-soft px-4 py-2 text-sm font-semibold"
          >Back to lobby</a
        >
      </div>
    </div>
  {:else if !membership}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 class="font-display text-lg font-extrabold uppercase">No seat found</h2>
      <p class="mt-2 text-sm text-muted-foreground">
        This browser has no stored membership for this room. Re-join with the 4-digit invite code.
      </p>
      <a
        href={resolve('/multiplayer')}
        class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >Go to Multiplayer entry</a
      >
      <p class="mt-3 font-mono text-xs text-muted-foreground">Room: {roomId}</p>
    </div>
  {:else if snap?.phase === 'waiting'}
    <div class="rounded-xl bg-surface-1 p-8 text-center">
      <p class="text-label text-primary">Draft not yet started</p>
      <h2 class="font-display mt-2 text-2xl font-extrabold uppercase">Waiting for host</h2>
      <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        You are {youLabel} · {modeLabel} · {snap.settings.pace === 'live'
          ? 'Live 90s / 5m'
          : 'Async 24h'}. Host must press “Start draft” in the lobby before picks begin.
      </p>
      <a
        href={`/multiplayer/room/${roomId}`}
        class="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
        >Back to lobby →</a
      >
    </div>
  {:else if snap?.phase === 'drafting'}
    <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-label tracking-[0.16em] text-primary">
            Multiplayer draft · {roomId.slice(0, 8)}…
          </p>
          <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">
            {modeLabel} draft
          </h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {youLabel} · {membership.franchiseId} · {snap.settings.pace === 'live'
              ? 'Live — 90s per pick'
              : 'Async — 24h per pick'}
          </p>
        </div>
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-3 py-1 text-xs font-semibold text-positive"
          ><Users class="h-3 w-3" /> {snap.memberCount}/2 · live</span
        >
      </div>
      <div class="mt-6 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Your seat</p>
          <p class="mt-1 text-sm font-bold">
            {membership.participantId === 'p1' ? 'P1 · Host' : 'P2 · Guest'}
          </p>
          <p class="mt-1 font-mono text-xs text-muted-foreground">{membership.franchiseId}</p>
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Mode & pace</p>
          <p class="mt-1 text-sm font-semibold">{modeLabel} · {snap.settings.pace}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {snap.settings.pace === 'live' ? '90s draft · 5m decisions' : '24h · 12h'}
          </p>
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Room</p>
          <p class="mt-1 font-mono text-xs break-all">{roomId}</p>
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-xl bg-surface-1 p-6">
      <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Draft board</h2>
      <p class="mt-2 text-sm text-muted-foreground">
        You are in the room-scoped draft — not the solo Season page. Draft offers are 8 cards with
        at least 3 safe picks, alternating turns for 10 rounds. This lobby keeps your seat ({membership.participantId})
        and franchise ({membership.franchiseId}) — they survive reloads via local membership.
      </p>
      <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <p class="text-sm font-semibold">Draft engine wiring</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          Multiplayer draft turns, offer verification, and pick ordering are room-scoped and
          hash-verified. This placeholder confirms retained identity ({membership.participantId}/{membership.franchiseId}),
          shared mode ({modeLabel}), and correct destination (<code class="font-mono"
            >/multiplayer/room/{roomId.slice(0, 8)}…/draft</code
          >). Full card board and pick submission via <code class="font-mono">submitCommand</code> follow
          the same 8-card / 10-round rules as solo Season Run.
        </p>
      </div>
      <div class="mt-4 flex gap-2">
        <a
          href={`/multiplayer/room/${roomId}`}
          class="rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
          >Back to lobby</a
        >
        <a
          href={resolve('/multiplayer')}
          class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >Multiplayer entry</a
        >
      </div>
    </div>

    <div
      class="mt-6 rounded-xl border border-line-soft bg-card p-4 text-xs leading-relaxed text-muted-foreground"
    >
      <p class="font-semibold text-foreground">Next basketball decision</p>
      <p class="mt-1">
        When it’s your turn, draw the 8-card offer, review safe vs. risky picks for the 4G/4F/3C
        targets, and select. The other player’s offer stays private until your pick locks.
      </p>
    </div>
  {:else}
    <div class="rounded-xl bg-surface-1 p-6">
      <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">
        Room phase: {snap?.phase}
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        This draft view is for the multiplayer room. Current phase is {snap?.phase}. Return to lobby
        for next steps.
      </p>
      <a
        href={`/multiplayer/room/${roomId}`}
        class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >Back to lobby →</a
      >
    </div>
  {/if}
</section>
