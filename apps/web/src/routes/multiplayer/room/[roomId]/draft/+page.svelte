<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    Trophy,
    Users,
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
  import type { SeasonRoomPublicSnapshot, SeasonRoomMembership, SeasonMultiplayerTransport } from '@hoop-rush/data-contracts';
  import { RoomDraftController, type RoomDraftState } from '$lib/season/room-draft-controller';

  let roomId = $derived($page.params.roomId as string);

  let snap = $state<SeasonRoomPublicSnapshot | null>(null);
  let membership = $state<SeasonRoomMembership | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let coordinator: ReturnType<typeof createInMemorySeasonRoomCoordinator> | null = null;
  let transport: ReturnType<typeof createSupabaseSeasonTransport> | null = null;
  let draftState: RoomDraftState | null = $state(null);
  let controller = $state<RoomDraftController | null>(null);
  let picking = $state(false);
  let pickError = $state<string | null>(null);

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
    const t = (transport ?? undefined) as unknown as SeasonMultiplayerTransport | undefined;
    return createInMemorySeasonRoomCoordinator({
      transport: t,
      onSnapshot: (s) => {
        snap = s;
        if (s.phase === 'drafting' && controller) {
          void controller.restoreFromLog().then((state) => (draftState = { ...state }));
        }
      },
      onCommands: async () => {
        if (controller) {
          const state = await controller.restoreFromLog();
          draftState = { ...state };
        }
      },
    });
  }

  function getTransport(): SeasonMultiplayerTransport {
    if (transport) return transport as unknown as SeasonMultiplayerTransport;
    const anyCoord = coordinator as unknown as { transport?: SeasonMultiplayerTransport };
    if (anyCoord?.transport) return anyCoord.transport;
    throw new Error('no transport available');
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
      const t = transport as unknown as SeasonMultiplayerTransport | null;
      if (t) {
        const res = await t.resume(roomId) as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
        snap = res;
        if ((res as unknown as { membership?: SeasonRoomMembership }).membership) {
          membership = (res as unknown as { membership: SeasonRoomMembership }).membership;
        }
      } else if (coordinator) {
        const res = await coordinator.refresh(roomId) as unknown as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
        snap = res;
        if ((res as unknown as { membership?: SeasonRoomMembership }).membership) membership = (res as unknown as { membership: SeasonRoomMembership }).membership;
      } else {
        throw new Error('Multiplayer not configured');
      }
      if (!membership) {
        const st = coordinator.state;
        if (st.participantId && st.franchiseId) membership = loadMembership(roomId);
      }
      if (snap) {
        coordinator.subscribe(roomId);
        if (snap.phase === 'drafting' && membership) {
          const tr = getTransport();
          controller = new RoomDraftController({ transport: tr, roomId, snapshot: snap });
          const state = await controller.restoreFromLog();
          draftState = state;
        }
      }
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

  async function handlePick(playerVersionId: string) {
    if (!controller || !membership) return;
    picking = true;
    pickError = null;
    try {
      const pid = membership.participantId as 'p1'|'p2';
      const next = await controller.submitPick(pid, playerVersionId);
      draftState = { ...next };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'turn') pickError = 'Not your turn — wait for opponent.';
      else if (code === 'stale-revision') pickError = 'Stale revision — refreshing.';
      else pickError = e instanceof Error ? e.message : String(e);
      if (controller) {
        const state = await controller.restoreFromLog();
        draftState = { ...state };
      }
    } finally {
      picking = false;
    }
  }

  async function refreshDraft() {
    if (!controller) return;
    const state = await controller.restoreFromLog();
    draftState = { ...state };
  }

  let modeLabel = $derived.by(() => {
    const raw = (snap?.settings as unknown as { mode?: string })?.mode ?? snap?.mode ?? 'season';
    if (raw === 'classic') return 'Classic';
    if (raw === 'sandbox') return 'Sandbox';
    return 'Season Run';
  });
  let isMyTurn = $derived(draftState?.currentTurn === membership?.participantId);
  let opponentTurn = $derived((draftState?.currentTurn ?? null) !== null && draftState?.currentTurn !== membership?.participantId);
  let picksByParticipant = $derived.by(() => {
    if (!draftState) return { p1: [], p2: [] } as Record<string, RoomDraftState['picks']>;
    return {
      p1: draftState.picks.filter((p) => p.participantId === 'p1'),
      p2: draftState.picks.filter((p) => p.participantId === 'p2'),
    };
  });
  let totalTarget = $derived(modeLabel === 'Season Run' ? 20 : 10);
  let progress = $derived(draftState ? `${String(draftState.picks.length)}/${String(totalTarget)} picks` : '');
</script>

<svelte:head><title>Draft · Room {roomId.slice(0, 8)} — Hoop Rush</title></svelte:head>

<section class="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex items-center justify-between gap-3 py-6">
    <a
      href={`/multiplayer/room/${roomId}`}
      class="text-label inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      ><ArrowLeft class="h-3.5 w-3.5" /> Back to lobby</a
    >
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={load}
        class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold hover:border-line-strong"
        ><RefreshCw class="h-3.5 w-3.5" />Refresh</button
      >
      {#if draftState}<button type="button" onclick={refreshDraft} class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold">Reload picks</button>{/if}
    </div>
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
        <button type="button" onclick={load} class="rounded-lg bg-card px-4 py-2 text-sm font-semibold">Retry</button>
        <a href={`/multiplayer/room/${roomId}`} class="rounded-lg border border-line-soft px-4 py-2 text-sm font-semibold">Back to lobby</a>
      </div>
    </div>
  {:else if !membership}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 class="font-display text-lg font-extrabold uppercase">No seat found</h2>
      <p class="mt-2 text-sm text-muted-foreground">This browser has no stored membership for this room. Re-join with the 4-digit invite code.</p>
      <a href={resolve('/multiplayer')} class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to Multiplayer entry</a>
      <p class="mt-3 font-mono text-xs text-muted-foreground">Room: {roomId}</p>
    </div>
  {:else if snap?.phase === 'waiting'}
    <div class="rounded-xl bg-surface-1 p-8 text-center">
      <p class="text-label text-primary">Draft not yet started</p>
      <h2 class="font-display mt-2 text-2xl font-extrabold uppercase">Waiting for host</h2>
      <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        You are {membership.participantId === 'p1' ? 'Host · P1' : 'Guest · P2'} · {modeLabel} · {snap.settings.pace === 'live' ? 'Live 90s / 5m' : 'Async 24h'}. Host must press “Start draft” in the lobby. Both clients will auto-enter draft via authoritative start event (room {snap.roomId.slice(0,8)}…, seed {snap.seed?.slice(0,8) ?? '—'}…, rev {snap.settingsRevision}).
      </p>
      <a href={`/multiplayer/room/${roomId}`} class="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Back to lobby →</a>
    </div>
  {:else if snap?.phase === 'drafting' && draftState}
    <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-label tracking-[0.16em] text-primary">Multiplayer draft · {roomId.slice(0, 8)}… · {modeLabel}</p>
          <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">{modeLabel} shared draft</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {membership.participantId === 'p1' ? 'P1 · Host' : 'P2 · Guest'} · {membership.franchiseId} · {snap.settings.pace === 'live' ? 'Live — 90s per pick' : 'Async — 24h per pick'} · {progress}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">Seed {draftState.seed.slice(0,12)}… · rev {draftState.settingsRevision} · turn {draftState.currentTurn ?? '—'} · you {isMyTurn ? 'to pick' : opponentTurn ? 'waiting' : '—'}</p>
        </div>
        <div class="flex flex-col items-end gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-3 py-1 text-xs font-semibold text-positive"><Users class="h-3 w-3" /> {snap.memberCount}/2 · live</span>
          {#if isMyTurn}<span class="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">Your turn</span>{:else if opponentTurn}<span class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1 text-xs">Opponent’s turn — wait for authoritative pick</span>{/if}
        </div>
      </div>

      {#if modeLabel === 'Season Run'}
        <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
          <p class="font-semibold">Season Run: 10 rounds · alternating picks · 8 cards (≥3 safe) · 4G/4F/3C targets</p>
          <p class="mt-1 text-muted-foreground">Seeded deterministically from room seed + settings revision + draft cursor (<code class="font-mono">{snap.cursor}</code>). Both clients receive identical seed, offers, picks, turn order.</p>
        </div>
      {:else if modeLabel === 'Classic'}
        <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
          <p class="font-semibold">Classic: 5 rounds each · deterministic franchise-era roll per turn · one reroll each (existing Classic rules)</p>
          <p class="mt-1 text-muted-foreground">Each roll is deterministic per participant turn; accepting claims that pool against opponent. Roll seed: <code class="font-mono">{draftState.seed.slice(0,16)}…</code></p>
          {#if draftState.currentTurn}
            {@const roll = controller?.classicRollFor(draftState.currentTurn)}
            {#if roll}<p class="mt-1">Current roll for {draftState.currentTurn}: <span class="font-mono font-bold">{roll.franchiseId} / {roll.eraId}</span></p>{/if}
          {/if}
        </div>
      {:else}
        <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
          <p class="font-semibold">Sandbox: 5 rounds each · unrestricted peak seasons · best-of-2</p>
          <p class="mt-1 text-muted-foreground">Any 5 peak seasons — deterministic offer per turn, shared draft cursor <code class="font-mono">{snap.cursor}</code>.</p>
        </div>
      {/if}

      <div class="mt-6 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Your seat</p>
          <p class="mt-1 text-sm font-bold">{membership.participantId === 'p1' ? 'P1 · Host' : 'P2 · Guest'}</p>
          <p class="mt-1 font-mono text-xs text-muted-foreground">{membership.franchiseId}</p>
          {#if isMyTurn}<p class="mt-1 text-xs font-bold text-primary">Your turn — pick</p>{:else}<p class="mt-1 text-xs text-muted-foreground">Wait for opponent</p>{/if}
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Mode & pace (shared fact)</p>
          <p class="mt-1 text-sm font-semibold">{modeLabel} · {snap.settings.pace}</p>
          <p class="mt-1 text-xs text-muted-foreground">Seed {draftState.seed.slice(0,12)}… · rev {draftState.settingsRevision}</p>
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Picks</p>
          <p class="mt-1 text-sm font-bold">{draftState.picks.length} total</p>
          <p class="mt-1 text-xs text-muted-foreground">You {picksByParticipant[membership.participantId].length} · Opp {picksByParticipant[membership.participantId === 'p1' ? 'p2' : 'p1'].length}</p>
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-xl bg-surface-1 p-6">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Draft board — {progress}</h2>
        <span class="text-xs text-muted-foreground">{draftState.currentTurn ? `Turn: ${draftState.currentTurn} ${isMyTurn ? '(you)' : ''}` : 'Complete'}</span>
      </div>

      {#if draftState.status === 'complete'}
        <div class="mt-4 rounded-lg border border-positive/30 bg-positive/10 p-4">
          <p class="font-semibold text-positive">Draft complete — {draftState.picks.length} picks</p>
          <p class="mt-1 text-xs text-muted-foreground">Both clients have identical final draft state. Final picks preserved through refresh/disconnect.</p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            {#each draftState.picks as pick (pick.playerVersionId)}
              <div class="rounded-lg border border-line-soft bg-card p-2 text-xs">
                <span class="font-mono font-bold">{pick.playerVersionId}</span> — {pick.participantId} · R{pick.round} P{pick.pickOrdinal}
              </div>
            {/each}
          </div>
        </div>
      {:else if draftState.currentOffer}
        <div class="mt-4">
          <p class="text-xs text-muted-foreground">Offer for {draftState.currentOffer.participantId} · Round {draftState.currentOffer.round} · Pick {draftState.currentOffer.pickOrdinal} — 8 cards, at least 3 safe.</p>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {#each draftState.currentOffer.cards as card (card.playerVersionId)}
              <button
                type="button"
                onclick={() => handlePick(card.playerVersionId)}
                disabled={!isMyTurn || picking || !card.selectable}
                class="flex flex-col rounded-xl border p-3 text-left transition {isMyTurn && card.selectable ? 'border-primary hover:bg-primary/10 bg-card' : 'border-line-soft bg-card/50 opacity-60'} disabled:cursor-not-allowed"
              >
                <span class="font-mono text-xs font-bold">{card.playerVersionId}</span>
                <span class="mt-1 text-xs {card.selectable ? 'text-positive' : 'text-destructive'}">{card.selectable ? 'Selectable — safe' : card.reason ?? 'Not selectable'}</span>
                {#if isMyTurn}<span class="mt-2 text-xs font-semibold text-primary">{picking ? 'Picking…' : 'Pick →'}</span>{:else}<span class="mt-2 text-xs text-muted-foreground">Waiting for {draftState.currentTurn}</span>{/if}
              </button>
            {/each}
          </div>
          {#if pickError}<p role="alert" class="mt-3 text-xs text-destructive">{pickError}</p>{/if}
          {#if !isMyTurn}<p class="mt-3 text-xs text-muted-foreground">It’s opponent’s turn — waiting for authoritative command before updating both clients.</p>{/if}
        </div>
      {:else}
        <p class="mt-4 text-xs text-muted-foreground">No offer available — waiting for turn.</p>
      {/if}

      <div class="mt-6">
        <h3 class="text-label tracking-[0.12em] text-muted-foreground">Accepted picks ({draftState.picks.length}) — preserved through refresh</h3>
        {#if draftState.picks.length === 0}
          <p class="mt-2 text-xs text-muted-foreground">No picks yet — be the first.</p>
        {:else}
          <div class="mt-3 space-y-2">
            {#each draftState.picks as pick, i (pick.playerVersionId + String(i))}
              <div class="flex items-center justify-between rounded-lg border border-line-soft bg-card p-2">
                <div class="flex items-center gap-2">
                  <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i+1}</span>
                  <span class="font-mono text-xs font-bold">{pick.playerVersionId}</span>
                  <span class="text-xs text-muted-foreground">· {pick.participantId} · R{pick.round}</span>
                </div>
                <span class="inline-flex items-center gap-1 text-xs {pick.participantId===membership.participantId ? 'text-primary font-semibold' : 'text-muted-foreground'}">{pick.participantId===membership.participantId ? 'You' : 'Opponent'} {pick.participantId===membership.participantId ? '✓' : ''}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mt-6 flex gap-2">
        <a href={`/multiplayer/room/${roomId}`} class="rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Back to lobby</a>
        <a href={resolve('/multiplayer')} class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Multiplayer entry</a>
      </div>
    </div>

    <div class="mt-6 rounded-xl border border-line-soft bg-card p-4 text-xs leading-relaxed text-muted-foreground">
      <p class="font-semibold text-foreground">Authoritative facts</p>
      <p class="mt-1">Room {roomId.slice(0,8)}… · Mode {modeLabel} · Seed {draftState.seed.slice(0,16)}… · Settings rev {draftState.settingsRevision} · Draft cursor {snap.cursor} · Turn {draftState.currentTurn ?? 'complete'} — same for both clients via deterministic seed derivation + command stream.</p>
      <p class="mt-1">Every roll/offer/pick goes through room command stream with participant authorization, expected revision, deterministic seed, and idempotency. Neither client falls through to solo flows.</p>
    </div>
  {:else}
    <div class="rounded-xl bg-surface-1 p-6">
      <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Room phase: {snap?.phase}</h2>
      <p class="mt-2 text-sm text-muted-foreground">This draft view is for the multiplayer room. Current phase is {snap?.phase}. Return to lobby for next steps.</p>
      <a href={`/multiplayer/room/${roomId}`} class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Back to lobby →</a>
    </div>
  {/if}
</section>
