<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    Users,
    Crown,
    Clock,
    Shield,
    Trophy,
    Zap,
    Copy,
    Check,
    RefreshCw,
    Wifi,
    WifiOff,
    AlertTriangle,
    Lock,
    Unlock,
  } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import {
    createSupabaseSeasonTransport,
    isSupabaseConfigured,
  } from '$lib/season/supabase-season-transport';
  import { loadMembership, loadCode } from '$lib/season/season-room-identity';
  import type { SeasonRoomPublicSnapshot, SeasonRoomMembership } from '@hoop-rush/data-contracts';

  let roomId = $derived($page.params.roomId as string);

  let snap = $state<SeasonRoomPublicSnapshot | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let copiedCode = $state(false);
  let copiedInvite = $state(false);
  let tick = $state(0);
  let coordinator: ReturnType<typeof createInMemorySeasonRoomCoordinator> | null = null;
  let unsubscribe: (() => void) | null = null;
  let storedMembership = $state<SeasonRoomMembership | null>(null);
  let storedCode = $state<string | null>(null);
  let starting = $state(false);
  let startError = $state<string | null>(null);

  let countdown = $derived.by(() => {
    if (!snap?.expiresAt) return null;
    void tick;
    const ms = new Date(snap.expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  let isHost = $derived(storedMembership?.participantId === 'p1');
  let isGuest = $derived(storedMembership?.participantId === 'p2');
  let youLabel = $derived(
    isHost ? 'You are Host · P1' : isGuest ? 'You joined as Guest · P2' : 'Viewing lobby',
  );
  let youFranchise = $derived(storedMembership?.franchiseId ?? null);
  let opponentFranchise = $derived(isHost ? 'franchise-p2' : isGuest ? 'franchise-p1' : null);

  let modeLabel = $derived.by(() => {
    const raw = (snap?.settings as unknown as { mode?: string })?.mode ?? 'season';
    if (raw === 'classic') return 'Classic';
    if (raw === 'sandbox') return 'Sandbox';
    return 'Season Run';
  });
  let paceDetail = $derived.by(() => {
    if (!snap) return '';
    return snap.settings.pace === 'live'
      ? 'Live — 90s draft · 5 min decisions'
      : 'Async — 24h draft · 12h decisions';
  });

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
    startError = null;
    try {
      coordinator = getCoordinator();
      // restore identity from localStorage first so "You" badge shows immediately
      storedMembership = loadMembership(roomId);
      storedCode = loadCode(roomId);
      // if coordinator can hydrate, let it
      try {
        coordinator.hydrateFromStorage(roomId);
      } catch {}
      storedMembership = loadMembership(roomId) ?? storedMembership;
      const t = transport as unknown as
        import('@hoop-rush/data-contracts').SeasonMultiplayerTransport | null;
      if (t) {
        const res = await t.resume(roomId);
        snap = res;
      } else if (coordinator) {
        const anyCoord = coordinator as unknown as {
          transport?: { resume: (id: string) => Promise<SeasonRoomPublicSnapshot> };
        };
        if (anyCoord.transport) {
          const res = await anyCoord.transport.resume(roomId);
          snap = res;
        } else {
          throw new Error('Multiplayer not configured');
        }
      }
      // refresh stored membership after resume (in case it was missing)
      storedMembership = loadMembership(roomId) ?? storedMembership;
      if (!storedMembership) {
        // try to hydrate again from coordinator state if it now has identity
        const stateMem = coordinator.state.participantId
          ? {
              participantId: coordinator.state.participantId,
              franchiseId: coordinator.state.franchiseId,
            }
          : null;
        if (stateMem?.participantId) {
          storedMembership = loadMembership(roomId);
        }
      }
      coordinator.subscribe(roomId);
      unsubscribe = () => coordinator?.disconnect();
      // if code is active but we have no stored code, keep snap.expiresAt for countdown
      if (snap && snap.codeActive && !storedCode) {
        // try to read code from snapshot extra field if transport returned it (in-memory)
        const extra = snap as unknown as { code?: string };
        if (extra.code) storedCode = extra.code;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    const iv = setInterval(() => tick++, 1000);
    return () => {
      clearInterval(iv);
      unsubscribe?.();
      coordinator?.destroy();
    };
  });

  async function copyInvite() {
    const toCopy = storedCode ?? (snap as unknown as { code?: string })?.code ?? null;
    if (!toCopy) return;
    try {
      await navigator.clipboard.writeText(toCopy);
      copiedInvite = true;
      setTimeout(() => (copiedInvite = false), 1500);
    } catch {}
  }

  async function handleStartDraft() {
    if (!coordinator) return;
    starting = true;
    startError = null;
    try {
      const res = await coordinator.startDraft(roomId);
      snap = res;
    } catch (e) {
      startError = e instanceof Error ? e.message : String(e);
    } finally {
      starting = false;
    }
  }

  function phaseBadge(p: string) {
    const isBad = p === 'integrity-failed' || p === 'expired';
    const isGood = p === 'completed' || p === 'drafting';
    return isBad
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : isGood
        ? 'border-positive/40 bg-positive/10 text-positive'
        : 'border-primary/40 bg-primary/10 text-primary';
  }
</script>

<svelte:head><title>Room {roomId.slice(0, 8)} — Hoop Rush</title></svelte:head>

<section class="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex items-center justify-between gap-3 py-6">
    <a
      href={resolve('/multiplayer')}
      class="text-label inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      >← Multiplayer</a
    >
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={load}
        class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold hover:border-line-strong"
        ><RefreshCw class="h-3.5 w-3.5" />Refresh</button
      >
      <a
        href={resolve('/')}
        class="hidden text-xs text-muted-foreground underline-offset-4 hover:underline sm:inline"
        >Home</a
      >
    </div>
  </div>

  {#if loading}
    <div class="rounded-xl bg-surface-1 p-10 text-center">
      <p class="font-mono text-sm text-muted-foreground">Loading room…</p>
      <p class="mt-2 font-mono text-xs text-muted-foreground/60">{roomId.slice(0, 8)}…</p>
    </div>
  {:else if error}
    <div class="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
      <div class="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle class="h-4 w-4" />Could not load room
      </div>
      <p class="mt-2 text-sm text-muted-foreground">{error}</p>
      <p class="mt-1 font-mono text-xs break-all text-muted-foreground/60">{roomId}</p>
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          onclick={load}
          class="rounded-lg bg-card px-4 py-2 text-sm font-semibold">Retry</button
        >
        <a
          href={resolve('/multiplayer')}
          class="rounded-lg border border-line-soft px-4 py-2 text-sm font-semibold"
          >Back to lobby</a
        >
      </div>
    </div>
  {:else if snap}
    <!-- hero: code prominently if you are host -->
    {#if storedCode && snap.codeActive}
      <div class="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-label tracking-[0.16em] text-primary">Invite code — share it</p>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <div class="flex gap-1.5">
                {#each storedCode.split('') as d, i (i)}
                  <span
                    class="inline-flex h-14 w-12 items-center justify-center rounded-xl border-2 border-primary/40 bg-card font-mono text-3xl font-black tracking-widest sm:h-16 sm:w-14 sm:text-4xl"
                    >{d}</span
                  >
                {/each}
              </div>
              <button
                type="button"
                onclick={copyInvite}
                class="inline-flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-surface-2"
              >
                {#if copiedInvite}<Check class="h-4 w-4 text-positive" /> Copied!{:else}<Copy
                    class="h-4 w-4"
                  /> Copy invite{/if}
              </button>
            </div>
            <p class="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock class="h-3.5 w-3.5" />
              {#if countdown && countdown !== 'expired'}expires in {countdown}{:else if countdown === 'expired'}expired
                — create a new room{:else}expires in 15 minutes{/if}
              · cleared after 2nd player joins · share this, not the URL
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tracking-widest uppercase {phaseBadge(
                snap.phase,
              )}"
            >
              {#if snap.phase === 'waiting'}<Users class="h-3 w-3" />{/if}{snap.phase}
            </span>
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 text-xs"
            >
              {#if snap.codeActive}<Wifi class="h-3 w-3 text-positive" /> code live{:else}<WifiOff
                  class="h-3 w-3 text-muted-foreground"
                /> code cleared{/if}
            </span>
          </div>
        </div>
      </div>
    {:else}
      <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tracking-widest uppercase {phaseBadge(
                  snap.phase,
                )}"
              >
                {#if snap.phase === 'waiting'}<Users
                    class="h-3 w-3"
                  />{:else if snap.phase === 'integrity-failed'}<AlertTriangle
                    class="h-3 w-3"
                  />{:else}<Trophy class="h-3 w-3" />{/if}
                {snap.phase}
              </span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 text-xs"
              >
                {#if snap.codeActive}<Wifi class="h-3 w-3 text-positive" /> code live{:else}<WifiOff
                    class="h-3 w-3 text-muted-foreground"
                  /> code {snap.phase === 'drafting' ? 'cleared (2/2 joined)' : 'inactive'}{/if}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-medium"
                >{snap.memberCount}/2 players</span
              >
            </div>
            <h1
              class="font-display mt-3 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
            >
              Room lobby
            </h1>
            <p class="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {modeLabel} · {paceDetail} · You: {youLabel}
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            {#if storedCode && !snap.codeActive}
              <span
                class="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-mono"
                >Code cleared — both joined</span
              >
            {:else if snap.codeActive && !storedCode}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs"
                >Code active — ask host</span
              >
            {/if}
            {#if snap.expiresAt && snap.codeActive}
              <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                ><Clock class="h-3 w-3" />expires {countdown}</span
              >
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- identity + mode -->
    <div class="mt-4 grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg border border-line-soft bg-card p-3">
        <p class="text-label text-muted-foreground">Mode</p>
        <p class="mt-1 text-sm font-semibold">{modeLabel}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Host chose before creation — both see same.
        </p>
      </div>
      <div class="rounded-lg border border-line-soft bg-card p-3">
        <p class="text-label text-muted-foreground">Pace</p>
        <p class="mt-1 text-sm font-semibold">{paceDetail}</p>
      </div>
      <div class="rounded-lg border border-line-soft bg-card p-3">
        <p class="text-label text-muted-foreground">You</p>
        <p class="mt-1 text-sm font-semibold">{youLabel}</p>
        {#if youFranchise}<p class="mt-1 font-mono text-xs text-muted-foreground">
            {youFranchise}
          </p>{/if}
      </div>
    </div>

    <!-- two columns: players / next steps -->
    <div class="mt-6 grid gap-6 lg:grid-cols-5">
      <div class="space-y-6 lg:col-span-3">
        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Players</h2>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            {#each [0, 1] as i (i)}
              {@const filled = i < snap.memberCount}
              {@const isYou = (i === 0 && isHost) || (i === 1 && isGuest)}
              {@const seatLabel = i === 0 ? 'P1 · Host' : 'P2 · Guest'}
              <div
                class="rounded-xl border p-4 {filled
                  ? isYou
                    ? 'border-primary/40 bg-primary/10 ring-1 ring-primary'
                    : 'border-positive/30 bg-positive/10'
                  : 'border-dashed border-line-soft bg-card/50'}"
              >
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs font-bold tracking-widest uppercase"
                    >{seatLabel}
                    {#if isYou}<span
                        class="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground"
                        >YOU</span
                      >{/if}</span
                  >
                  <span
                    class="inline-flex items-center gap-1 text-xs {filled
                      ? 'text-positive'
                      : 'text-muted-foreground'}"
                  >
                    {#if filled}<Lock class="h-3 w-3" /> joined{:else}<Unlock class="h-3 w-3" /> waiting{/if}
                  </span>
                </div>
                <p class="mt-2 font-display text-base font-extrabold uppercase">
                  {filled ? (i === 0 ? 'Host' : 'Guest') : 'Open'}
                </p>
                <p class="text-xs text-muted-foreground">
                  {filled
                    ? isYou
                      ? (youFranchise ?? 'Your franchise assigned')
                      : (opponentFranchise ?? 'Franchise assigned')
                    : 'Share the 4-digit invite to fill'}
                </p>
                {#if filled && isYou}<p class="mt-1 text-xs font-semibold text-primary">You</p>{/if}
              </div>
            {/each}
          </div>

          {#if snap.phase === 'waiting' && snap.memberCount < 2}
            <div
              class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-muted-foreground"
            >
              Waiting for opponent — code is 4 digits, leading zeros allowed (<code
                class="font-mono">0042</code
              >), expires in 15 min and is cleared after 2/2 join. Keep this lobby open — it updates
              live.
            </div>
          {:else if snap.phase === 'waiting' && snap.memberCount === 2}
            <div class="mt-4 rounded-lg border border-positive/30 bg-positive/10 p-3 text-xs">
              Both players here. Host can start the draft when ready.
            </div>
          {:else if snap.phase === 'drafting'}
            <div class="mt-4 rounded-lg border border-positive/30 bg-positive/10 p-3 text-xs">
              Draft is ready — 8 cards × 10 rounds, alternating picks, private until lock.
            </div>
          {/if}
        </div>

        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">
            What stays private
          </h2>
          <div class="mt-3 grid gap-3 text-xs leading-relaxed sm:grid-cols-2">
            <div class="rounded-lg border border-line-soft bg-card p-3">
              <p class="font-semibold text-foreground">Public now</p>
              <p class="mt-1 text-muted-foreground">
                Mode, pace, who’s in, draft offers & picks, results.
              </p>
            </div>
            <div class="rounded-lg border border-line-soft bg-card p-3">
              <p class="font-semibold text-foreground">Private until both lock</p>
              <p class="mt-1 text-muted-foreground">Rotations and upcoming block choices.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-6 lg:col-span-2">
        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Next step</h2>
          {#if snap.phase === 'waiting' && snap.memberCount < 2}
            <p class="mt-2 text-sm text-muted-foreground">
              Room is waiting for the second player. {storedCode
                ? 'Your invite code is shown above — share it.'
                : 'Ask the host for the 4-digit invite.'} This lobby updates live.
            </p>
            <div class="mt-4 flex gap-2">
              <a
                href={resolve('/multiplayer')}
                class="flex-1 rounded-lg border border-line-soft bg-card px-4 py-2 text-center text-sm font-semibold hover:border-line-strong"
                >Back to entry</a
              >
              <button
                type="button"
                onclick={load}
                class="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >Refresh</button
              >
            </div>
          {:else if snap.phase === 'waiting' && snap.memberCount === 2}
            {#if isHost}
              <p class="mt-2 text-sm text-muted-foreground">
                Both players are in. You’re the host — start the draft when you’re ready.
              </p>
              <button
                type="button"
                onclick={handleStartDraft}
                disabled={starting}
                class="mt-4 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {starting ? 'Starting…' : 'Start draft →'}
              </button>
              {#if startError}<p role="alert" class="mt-2 text-xs text-destructive">
                  {startError}
                </p>{/if}
              <p class="mt-2 text-xs text-muted-foreground">
                Guest sees “Waiting for host to start” until you press this.
              </p>
            {:else}
              <p class="mt-2 text-sm text-muted-foreground">
                Both players are in — waiting for host to start the draft.
              </p>
              <button
                type="button"
                onclick={load}
                class="mt-4 w-full rounded-lg border border-line-soft bg-card px-4 py-3 text-sm font-semibold"
                >Refresh status</button
              >
              <p class="mt-2 text-xs text-muted-foreground">
                You’re {youLabel}. Host will start when ready.
              </p>
            {/if}
          {:else if snap.phase === 'drafting'}
            <p class="mt-2 text-sm text-muted-foreground">
              Draft is live — you’ll pick alternately for 10 rounds. Each turn shows 8 cards with at
              least 3 safe picks.
            </p>
            <button
              type="button"
              onclick={() => goto(`/multiplayer/room/${roomId}/draft`)}
              class="mt-4 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >Enter draft →</button
            >
            <p class="mt-2 text-xs text-muted-foreground">
              Room-scoped draft — not the solo Season page. Your seat: {youLabel}.
            </p>
          {:else if snap.phase === 'integrity-failed'}
            <div
              class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              Integrity failed — hashes diverged twice. Room is frozen. Create a new room.
            </div>
            <a
              href={resolve('/multiplayer')}
              class="mt-3 inline-flex w-full justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >New room</a
            >
          {:else if snap.phase === 'expired'}
            <div
              class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              Expired — 24h grace without verified fallback.
            </div>
          {:else}
            <p class="mt-2 text-sm text-muted-foreground">
              Phase <code class="font-mono text-xs">{snap.phase}</code> — waiting for league setup.
            </p>
            <button
              type="button"
              onclick={load}
              class="mt-3 w-full rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
              >Refresh lobby</button
            >
          {/if}
        </div>

        <div
          class="rounded-xl border border-line-soft bg-card p-4 text-xs leading-relaxed text-muted-foreground"
        >
          <p class="font-semibold text-foreground">Room</p>
          <div class="mt-2 space-y-1 font-mono text-xs">
            <div class="flex justify-between">
              <span>members</span><span>{snap.memberCount}/2</span>
            </div>
            <div class="flex justify-between"><span>mode</span><span>{modeLabel}</span></div>
            <div class="flex justify-between">
              <span>pace</span><span>{snap.settings.pace}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
