<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    Users,
    Crown,
    Clock,
    Trophy,
    Zap,
    Swords,
    Copy,
    Check,
    RefreshCw,
    Wifi,
    WifiOff,
    AlertTriangle,
    Link as LinkIcon,
    LogOut,
    UserMinus,
  } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import {
    createSupabaseSeasonTransport,
    isSupabaseConfigured,
  } from '$lib/season/supabase-season-transport';
  import { loadMembership, loadCode, inviteLinkForCode, clearMembership, clearCode } from '$lib/season/season-room-identity';
  import { friendlyJoinError } from '$lib/season/season-room-identity';
  import type { SeasonRoomPublicSnapshot, SeasonRoomMembership } from '@hoop-rush/data-contracts';

  let roomId = $derived($page.params.roomId as string);

  let snap = $state<SeasonRoomPublicSnapshot | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let outdated = $state(false);
  let copiedInvite = $state(false);
  let copiedCode = $state(false);
  let tick = $state(0);
  let coordinator: ReturnType<typeof createInMemorySeasonRoomCoordinator> | null = null;
  let unsubscribe: (() => void) | null = null;
  let storedMembership = $state<SeasonRoomMembership | null>(null);
  let storedCode = $state<string | null>(null);
  let starting = $state(false);
  let startError = $state<string | null>(null);
  let readyBusy = $state(false);
  let readyError = $state<string | null>(null);
  let settingsBusy = $state(false);
  let settingsError = $state<string | null>(null);
  let showLeaveConfirm = $state(false);
  let showRemoveConfirm = $state(false);
  let lastSettingsRevision = $state<number | null>(null);
  let settingsChangedBanner = $state(false);
  let liveMessage = $state('');

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
    isHost ? 'You · Host' : isGuest ? 'You · Guest' : 'Viewing lobby',
  );

  let modeLabel = $derived.by(() => {
    const raw = (snap?.settings as unknown as { mode?: string })?.mode ?? snap?.mode ?? 'season';
    if (raw === 'classic') return 'Classic';
    if (raw === 'sandbox') return 'Sandbox';
    return 'Season Run';
  });
  let paceLabel = $derived.by(() => {
    if (!snap) return '';
    return snap.settings.pace === 'live'
      ? 'Live — 90s draft · 5 min decisions'
      : 'Async — 24h draft · 12h decisions';
  });
  let paceShort = $derived(snap?.settings.pace === 'live' ? 'Live' : 'Async');

  // presence helpers
  let hostPresence = $derived(snap?.presence?.find((p) => p.participantId === 'p1') ?? null);
  let guestPresence = $derived(snap?.presence?.find((p) => p.participantId === 'p2') ?? null);
  let hostOnline = $derived(hostPresence?.online ?? (snap ? snap.memberCount >= 1 : false));
  let guestOnline = $derived(guestPresence?.online ?? (snap ? snap.memberCount >= 2 : false));
  let bothPresent = $derived(hostOnline && guestOnline);
  let guestReady = $derived(snap?.guestReady ?? false);
  let settingsRevision = $derived(snap?.settingsRevision ?? 0);

  let disableReason = $derived.by(() => {
    if (starting) return 'Request in progress…';
    if (!snap) return null;
    if (snap.phase !== 'waiting') return null;
    if (snap.memberCount < 2) return 'Waiting for opponent to join';
    if (!guestReady) return 'Waiting for Ready — guest must confirm settings';
    if (!bothPresent) return 'Opponent disconnected — waiting for reconnection';
    return null;
  });
  let canStart = $derived(disableReason === null && isHost && snap?.phase === 'waiting');

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
      onSnapshot: (s) => {
        const prevRev = lastSettingsRevision;
        snap = s;
        if (prevRev !== null && s.settingsRevision !== prevRev && isGuest) {
          // settings changed by host, require readiness again
          settingsChangedBanner = true;
          liveMessage = 'Host changed settings — please Ready again';
          setTimeout(() => (settingsChangedBanner = false), 6000);
        }
        lastSettingsRevision = s.settingsRevision;
        if (s.guestReady && isGuest) liveMessage = 'You are Ready';
        if (s.phase === 'drafting') {
          liveMessage = 'Draft starting — entering arena';
          // auto-navigate both clients to draft with brief transition
          setTimeout(() => goto(`/multiplayer/room/${roomId}/draft`), 400);
        }
        // update stored code presence: codeActive indicates still visible
        if (s.codeActive) {
          // keep storedCode if exists
        } else {
          // code cleared after 2 join, keep until start? per spec keep visible until 2nd joins (codeActive false means cleared)
        }
        if (s.isOutdated) outdated = true;
      },
      onCommands: () => {},
    });
  }

  async function load() {
    loading = true;
    error = null;
    outdated = false;
    startError = null;
    readyError = null;
    settingsError = null;
    try {
      coordinator = getCoordinator();
      storedMembership = loadMembership(roomId);
      storedCode = loadCode(roomId);
      try {
        coordinator.hydrateFromStorage(roomId);
      } catch {}
      storedMembership = loadMembership(roomId) ?? storedMembership;
      const t = transport as unknown as
        import('@hoop-rush/data-contracts').SeasonMultiplayerTransport | null;
      let res: SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
      if (t) {
        res = await t.resume(roomId);
      } else if (coordinator) {
        // fallback to coordinator refresh which retains membership
        res = await coordinator.refresh(roomId) as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
      } else {
        throw new Error('Multiplayer not configured');
      }
      snap = res as SeasonRoomPublicSnapshot;
      if ((res as unknown as { membership?: SeasonRoomMembership }).membership) {
        const m = (res as unknown as { membership: SeasonRoomMembership }).membership;
        // retain private membership per spec
        const { saveMembership } = await import('$lib/season/season-room-identity');
        saveMembership(m);
        storedMembership = m;
      }
      // if codeActive and we have storedCode, keep it; else try to read from snapshot extra
      if (snap && snap.codeActive && !storedCode) {
        const extra = snap as unknown as { code?: string };
        if (extra.code) storedCode = extra.code;
      }
      if ((snap as unknown as { isOutdated?: boolean }).isOutdated) outdated = true;
      lastSettingsRevision = (snap as unknown as { settingsRevision?: number }).settingsRevision ?? null;
      // treat resume as refresh for presence
      coordinator.subscribe(roomId);
      unsubscribe = () => coordinator?.disconnect();
      // if already drafting, auto-navigate (reconnecting client resumes there)
      if (snap.phase === 'drafting') {
        setTimeout(() => goto(`/multiplayer/room/${roomId}/draft`), 400);
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'outdated-room') {
        outdated = true;
        error = null;
      } else {
        error = e instanceof Error ? friendlyJoinError(e) : String(e);
      }
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
    const codeToCopy = storedCode ?? (snap as unknown as { code?: string })?.code ?? null;
    const link = codeToCopy ? inviteLinkForCode(codeToCopy) : null;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      copiedInvite = true;
      setTimeout(() => (copiedInvite = false), 1500);
    } catch {}
  }
  async function copyCodeOnly() {
    const toCopy = storedCode ?? (snap as unknown as { code?: string })?.code ?? null;
    if (!toCopy) return;
    try {
      await navigator.clipboard.writeText(toCopy);
      copiedCode = true;
      setTimeout(() => (copiedCode = false), 1500);
    } catch {}
  }

  async function handleStartDraft() {
    if (!coordinator) return;
    starting = true;
    startError = null;
    try {
      const res = await coordinator.startDraft(roomId);
      snap = res;
      liveMessage = 'Draft starting';
      setTimeout(() => goto(`/multiplayer/room/${roomId}/draft`), 400);
    } catch (e) {
      startError = friendlyJoinError(e);
    } finally {
      starting = false;
    }
  }

  async function handleSetReady(ready: boolean) {
    if (!coordinator) return;
    readyBusy = true;
    readyError = null;
    try {
      const res = await coordinator.setReady(roomId, ready);
      snap = res;
      settingsChangedBanner = false;
      liveMessage = ready ? 'You are Ready' : 'Ready cleared';
    } catch (e) {
      readyError = friendlyJoinError(e);
    } finally {
      readyBusy = false;
    }
  }

  async function handleUpdateSettings(newMode: 'season'|'classic'|'sandbox', newPace: 'live'|'async') {
    if (!coordinator || !isHost) return;
    settingsBusy = true;
    settingsError = null;
    try {
      const res = await coordinator.updateSettings(roomId, newMode, newPace);
      snap = res;
      liveMessage = `Settings updated to ${newMode} · ${newPace}`;
    } catch (e) {
      settingsError = friendlyJoinError(e);
    } finally {
      settingsBusy = false;
    }
  }

  async function handleRemoveGuest() {
    if (!coordinator) return;
    try {
      // host removes guest before Start, regenerating invite code
      const t = transport as unknown as { preDraftRemoval?: (id: string, pid: 'p1'|'p2') => Promise<string> } | null;
      let newCode: string | null = null;
      if (t?.preDraftRemoval) {
        newCode = await t.preDraftRemoval(roomId, 'p2');
      } else {
        // in-memory fallback via coordinator's transport
        const anyTransport = (coordinator as unknown as { transport?: { preDraftRemoval: (id: string, pid: string) => Promise<string> } });
        // @ts-ignore
        newCode = await (coordinator as unknown as { transport: { preDraftRemoval: (id: string, pid: string) => Promise<string> } }).transport.preDraftRemoval(roomId, 'p2');
      }
      if (newCode) {
        const { saveCode } = await import('$lib/season/season-room-identity');
        saveCode(roomId, newCode as unknown as import('@hoop-rush/data-contracts').SeasonRoomCode);
        storedCode = newCode;
        // refresh snapshot
        await load();
      }
      showRemoveConfirm = false;
    } catch (e) {
      startError = friendlyJoinError(e);
      showRemoveConfirm = false;
    }
  }

  async function handleLeave() {
    if (!coordinator) return;
    try {
      await coordinator.leave(roomId);
      clearMembership(roomId);
      clearCode(roomId);
      await goto(resolve('/multiplayer'));
    } catch (e) {
      error = friendlyJoinError(e);
    }
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

  <div aria-live="polite" aria-atomic="true" class="sr-only">{liveMessage}</div>

  {#if loading}
    <div class="rounded-xl bg-surface-1 p-10 text-center">
      <p class="font-mono text-sm text-muted-foreground">Loading room…</p>
      <p class="mt-2 font-mono text-xs text-muted-foreground/60">{roomId.slice(0, 8)}…</p>
    </div>
  {:else if outdated}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <div class="flex items-center gap-2 font-semibold text-amber-700">
        <AlertTriangle class="h-4 w-4" />Outdated room — create a new one
      </div>
      <p class="mt-2 text-sm text-muted-foreground">This room was created with an old protocol (v1). Rooms are temporary — please create a new room. Your draft progress is still saved locally if you started.</p>
      <div class="mt-4 flex gap-2">
        <a href={resolve('/multiplayer')} class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Create new room</a>
        <button type="button" onclick={handleLeave} class="rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Leave room</button>
      </div>
    </div>
  {:else if error}
    <div class="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
      <div class="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle class="h-4 w-4" />Could not load room
      </div>
      <p class="mt-2 text-sm text-muted-foreground">{error}</p>
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
    {#if storedCode && snap.codeActive}
      <div class="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-label tracking-[0.16em] text-primary">Invite — share with opponent</p>
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
                class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {#if copiedInvite}<Check class="h-4 w-4" /> Copied link!{:else}<LinkIcon class="h-4 w-4" /> Copy invite link{/if}
              </button>
              <button
                type="button"
                onclick={copyCodeOnly}
                class="inline-flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-surface-2"
              >
                {#if copiedCode}<Check class="h-4 w-4 text-positive" /> Copied!{:else}<Copy class="h-4 w-4" /> Copy code{/if}
              </button>
            </div>
            <p class="mt-2 text-xs text-muted-foreground">Invite link: <code class="font-mono">/multiplayer?code={storedCode}</code> — prefill & preview for guest.</p>
            <p class="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock class="h-3.5 w-3.5" />
              {#if countdown && countdown !== 'expired'}expires in {countdown}{:else if countdown === 'expired'}expired
                — create a new room{:else}expires in 15 minutes{/if}
              · visible until opponent joins
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-bold tracking-widest uppercase text-primary">{snap.phase}</span>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 text-xs">
              <Wifi class="h-3 w-3 text-positive" /> code live
            </span>
          </div>
        </div>
      </div>
    {:else}
      <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-bold tracking-widest uppercase text-primary">{snap.phase}</span>
              <span class="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-medium">{snap.memberCount}/2 players</span>
              {#if snap.codeActive}<span class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 text-xs"><Wifi class="h-3 w-3 text-positive" /> code live</span>{:else}<span class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 text-xs"><WifiOff class="h-3 w-3 text-muted-foreground" /> code cleared</span>{/if}
            </div>
            <h1 class="font-display mt-3 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">Room lobby</h1>
            <p class="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {modeLabel} · {paceLabel} · You: {youLabel}
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            {#if storedCode && !snap.codeActive}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-mono">Code cleared — both joined</span>
            {:else if snap.codeActive && !storedCode}
              <span class="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs">Code active — ask host</span>
            {/if}
            {#if snap.expiresAt && snap.codeActive}
              <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock class="h-3 w-3" />expires {countdown}</span>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if settingsChangedBanner && isGuest}
      <div role="status" class="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800">
        Host changed {modeLabel} / {paceShort} — please Ready again. <span class="font-semibold">Ready required again.</span>
      </div>
    {/if}

    <!-- shared room facts -->
    <div class="mt-4 grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg border border-line-soft bg-card p-4">
        <p class="text-label text-muted-foreground">Mode</p>
        {#if isHost && snap && snap.phase === 'waiting'}
          <div class="mt-2 grid gap-1.5">
            {#each ['season','classic','sandbox'] as m (m)}
              <button type="button" onclick={() => handleUpdateSettings(m as 'season'|'classic'|'sandbox', snap!.settings.pace)} disabled={settingsBusy} class="rounded-lg border px-3 py-2 text-left text-sm font-semibold {snap!.mode === m ? 'border-primary bg-primary/10' : 'border-line-soft bg-surface-1 hover:border-line-strong'} disabled:opacity-50">{m === 'season' ? 'Season Run' : m === 'classic' ? 'Classic' : 'Sandbox'} {snap!.mode === m ? '✓' : ''}</button>
            {/each}
          </div>
          {#if settingsError}<p role="alert" class="mt-2 text-xs text-destructive">{settingsError}</p>{/if}
        {:else}
          <p class="mt-1 text-sm font-bold">{modeLabel}</p>
          <p class="mt-1 text-xs text-muted-foreground">Host chose before creation — both see same.</p>
        {/if}
      </div>
      <div class="rounded-lg border border-line-soft bg-card p-4">
        <p class="text-label text-muted-foreground">Pace</p>
        {#if isHost && snap && snap.phase === 'waiting'}
          <div class="mt-2 grid gap-1.5">
            {#each ['live','async'] as p (p)}
              <button type="button" onclick={() => handleUpdateSettings(snap!.mode as 'season'|'classic'|'sandbox', p as 'live'|'async')} disabled={settingsBusy} class="rounded-lg border px-3 py-2 text-left text-sm font-semibold {snap!.settings.pace === p ? 'border-primary bg-primary/10' : 'border-line-soft bg-surface-1 hover:border-line-strong'} disabled:opacity-50">{p === 'live' ? 'Live — 90s / 5m' : 'Async — 24h / 12h'} {snap!.settings.pace === p ? '✓' : ''}</button>
            {/each}
          </div>
          {#if settingsBusy}<p class="mt-2 text-xs text-muted-foreground">Updating…</p>{/if}
        {:else}
          <p class="mt-1 text-sm font-bold">{paceLabel}</p>
          <p class="mt-1 text-xs text-muted-foreground">{paceShort === 'Live' ? '90s draft · 5m decisions' : '24h draft · 12h decisions'}</p>
        {/if}
      </div>
      <div class="rounded-lg border border-line-soft bg-card p-4">
        <p class="text-label text-muted-foreground">You</p>
        <p class="mt-1 text-sm font-bold">{youLabel}</p>
        <p class="mt-1 text-xs {isHost ? 'text-primary font-semibold' : isGuest ? 'text-positive font-semibold' : 'text-muted-foreground'}">{isHost ? 'Host controls Start' : isGuest ? 'Guest — Ready to confirm' : 'Spectator'}</p>
        {#if (snap as unknown as { settingsRevision?: number }).settingsRevision !== undefined}<p class="mt-1 text-xs text-muted-foreground">Settings rev {(snap as unknown as { settingsRevision?: number }).settingsRevision}</p>{/if}
      </div>
    </div>

    <div class="mt-6 grid gap-6 lg:grid-cols-5">
      <div class="space-y-6 lg:col-span-3">
        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Players</h2>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <!-- Host card -->
            <div class="rounded-xl border p-4 {isHost ? 'border-primary/40 bg-primary/10 ring-1 ring-primary' : 'border-line-soft bg-card'}">
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs font-bold tracking-widest uppercase flex items-center gap-1.5"><Crown class="h-3.5 w-3.5 text-primary" />P1 · Host {#if isHost}<span class="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">YOU</span>{/if}</span>
                <span class="inline-flex items-center gap-1 text-xs {hostOnline ? 'text-positive' : 'text-amber-600'}">{#if hostOnline}<Wifi class="h-3 w-3" /> connected{:else}<WifiOff class="h-3 w-3" /> offline{/if}</span>
              </div>
              <p class="mt-2 font-display text-base font-extrabold uppercase">Host</p>
              <p class="text-xs text-muted-foreground">{snap.memberCount >= 1 ? 'Joined' : 'Waiting'}</p>
              <p class="mt-1 inline-flex items-center gap-1.5 text-xs"><span class="h-2 w-2 rounded-full {hostOnline ? 'bg-positive' : 'bg-amber-500'}"></span> {hostOnline ? 'Heartbeat fresh' : 'No heartbeat — 15s offline'}</p>
            </div>
            <!-- Guest card -->
            <div class="rounded-xl border p-4 {isGuest ? 'border-primary/40 bg-primary/10 ring-1 ring-primary' : snap.memberCount >= 2 ? 'border-positive/30 bg-positive/10' : 'border-dashed border-line-soft bg-card/50'}">
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs font-bold tracking-widest uppercase">P2 · Guest {#if isGuest}<span class="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">YOU</span>{/if}</span>
                <span class="inline-flex items-center gap-1 text-xs {snap.memberCount >=2 ? (guestOnline ? 'text-positive' : 'text-amber-600') : 'text-muted-foreground'}">{#if snap.memberCount >=2}{#if guestOnline}<Wifi class="h-3 w-3" /> connected{:else}<WifiOff class="h-3 w-3" /> offline{/if}{:else}waiting{/if}</span>
              </div>
              <p class="mt-2 font-display text-base font-extrabold uppercase">{snap.memberCount >=2 ? 'Guest' : 'Open'}</p>
              <p class="text-xs text-muted-foreground">{snap.memberCount >=2 ? (guestReady ? 'Ready ✓' : 'Not ready') : 'Share invite link to fill'}</p>
              {#if snap.memberCount >=2}
                <p class="mt-1 inline-flex items-center gap-1.5 text-xs"><span class="h-2 w-2 rounded-full {guestOnline ? 'bg-positive' : 'bg-amber-500'}"></span> {guestOnline ? 'Heartbeat fresh' : 'Offline — waiting for reconnection'}</p>
                <p class="mt-1 text-xs font-semibold {guestReady ? 'text-positive' : 'text-amber-600'}">{guestReady ? 'Confirmed current settings' : 'Must Ready before Start'}</p>
              {/if}
            </div>
          </div>

          {#if snap.phase === 'waiting' && snap.memberCount < 2}
            <div class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-muted-foreground">
              Waiting for opponent — share the invite link (<code class="font-mono">/multiplayer?code={storedCode ?? '----'}</code>) or 4-digit code. Code stays visible until they join. Keep this lobby open — it updates live.
            </div>
          {:else if snap.phase === 'waiting' && snap.memberCount === 2 && !guestReady}
            <div class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              Guest must press Ready to confirm <span class="font-semibold">{modeLabel} · {paceShort}</span>. If host changes mode/pace, Ready resets.
            </div>
          {:else if snap.phase === 'waiting' && snap.memberCount === 2 && guestReady && bothPresent}
            <div class="mt-4 rounded-lg border border-positive/30 bg-positive/10 p-3 text-xs">
              Both players here and Ready. Host can Start.
            </div>
          {:else if snap.phase === 'waiting' && !bothPresent}
            <div class="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              Opponent disconnected — presence offline after 15s without heartbeat. Preserving membership; Start unavailable until reconnection.
            </div>
          {:else if snap.phase === 'drafting'}
            <div class="mt-4 rounded-lg border border-positive/30 bg-positive/10 p-3 text-xs">
              Draft is live — redirecting to shared draft…
            </div>
          {/if}

          {#if isHost && snap.phase === 'waiting' && snap.memberCount === 2}
            <div class="mt-4 flex gap-2">
              <button type="button" onclick={() => showRemoveConfirm = true} class="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20"><UserMinus class="h-3.5 w-3.5" /> Remove guest & regenerate code</button>
            </div>
          {/if}
        </div>

        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Invite</h2>
          {#if storedCode}
            <div class="mt-3 flex gap-2">
              <button type="button" onclick={copyInvite} class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><LinkIcon class="h-4 w-4" /> {#if copiedInvite}Copied!{:else}Copy invite link{/if}</button>
              <button type="button" onclick={copyCodeOnly} class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold hover:border-line-strong"><Copy class="h-4 w-4" /> {#if copiedCode}Copied!{:else}Copy code{/if}</button>
            </div>
            <p class="mt-2 text-xs text-muted-foreground">Link pre-fills code via <code class="font-mono">/multiplayer?code={storedCode}</code> and shows preview before join.</p>
          {:else}
            <p class="mt-3 text-xs text-muted-foreground">Code cleared after both joined. Invite regenerates if host removes guest.</p>
          {/if}
        </div>
      </div>

      <div class="space-y-6 lg:col-span-2">
        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Next step</h2>
          {#if snap.phase === 'waiting' && snap.memberCount < 2}
            <p class="mt-2 text-sm text-muted-foreground">
              Waiting for opponent. {storedCode ? 'Your invite link is above — share it.' : 'Ask host for invite.'} Lobby updates live.
            </p>
            <div class="mt-4 flex gap-2">
              <a href={resolve('/multiplayer')} class="flex-1 rounded-lg border border-line-soft bg-card px-4 py-2 text-center text-sm font-semibold hover:border-line-strong">Back</a>
              <button type="button" onclick={load} class="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Refresh</button>
            </div>
          {:else if snap.phase === 'waiting' && snap.memberCount === 2}
            {#if isHost}
              <p class="mt-2 text-sm text-muted-foreground">Both players in. You’re host — Start when Ready and presence are green.</p>
              <button type="button" onclick={handleStartDraft} disabled={!canStart} class="mt-4 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">{starting ? 'Starting…' : 'Start draft →'}</button>
              {#if disableReason}<p class="mt-2 text-xs font-medium {canStart ? 'text-positive' : 'text-amber-700'}">{disableReason}</p>{/if}
              {#if startError}<p role="alert" class="mt-2 text-xs text-destructive">{startError}</p>{/if}
              <p class="mt-2 text-xs text-muted-foreground">Guest sees waiting for host. Changing mode/pace clears Ready.</p>
            {:else if isGuest}
              <p class="mt-2 text-sm text-muted-foreground">Host will Start when both are Ready and connected.</p>
              <button type="button" onclick={() => handleSetReady(!guestReady)} disabled={readyBusy} class="mt-4 w-full rounded-xl border-2 px-4 py-3 text-sm font-extrabold tracking-wide uppercase {guestReady ? 'border-positive bg-positive/10 text-positive' : 'border-primary bg-primary text-primary-foreground hover:opacity-90'} disabled:opacity-50">
                {readyBusy ? 'Updating…' : guestReady ? '✓ Ready — tap to unready' : 'Ready → confirm settings'}
              </button>
              {#if readyError}<p role="alert" class="mt-2 text-xs text-destructive">{readyError}</p>{/if}
              <p class="mt-2 text-xs text-muted-foreground">Visible to host. Host changing {modeLabel}/{paceShort} requires Ready again.</p>
            {:else}
              <p class="mt-2 text-sm text-muted-foreground">Waiting for host to start.</p>
              <button type="button" onclick={load} class="mt-4 w-full rounded-lg border border-line-soft bg-card px-4 py-3 text-sm font-semibold">Refresh status</button>
            {/if}
          {:else if snap.phase === 'drafting'}
            <p class="mt-2 text-sm text-muted-foreground">Draft is live — both clients auto-navigate to <code class="font-mono text-xs">/multiplayer/room/{roomId.slice(0,8)}…/draft</code>.</p>
            <button type="button" onclick={() => goto(`/multiplayer/room/${roomId}/draft`)} class="mt-4 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Enter draft →</button>
            <p class="mt-2 text-xs text-muted-foreground">Reconnecting clients resume there. Mode: {modeLabel} · {paceShort}</p>
          {:else if snap.phase === 'integrity-failed'}
            <div class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Integrity failed — hashes diverged twice. Room frozen. Create new room.</div>
            <a href={resolve('/multiplayer')} class="mt-3 inline-flex w-full justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">New room</a>
          {:else if snap.phase === 'expired'}
            <div class="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Expired — 24h grace without verified fallback.</div>
          {:else}
            <p class="mt-2 text-sm text-muted-foreground">Phase <code class="font-mono text-xs">{snap.phase}</code></p>
            <button type="button" onclick={load} class="mt-3 w-full rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Refresh lobby</button>
          {/if}

          <div class="mt-6 flex gap-2">
            <button type="button" onclick={() => showLeaveConfirm = true} class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-2 text-xs font-semibold hover:border-line-strong"><LogOut class="h-3.5 w-3.5" /> Leave room</button>
            <a href={resolve('/multiplayer')} class="flex-1 rounded-lg bg-card border border-line-soft px-3 py-2 text-xs font-semibold text-center hover:border-line-strong">Multiplayer entry</a>
          </div>
        </div>

        <div class="rounded-xl border border-line-soft bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p class="font-semibold text-foreground">Room fact summary</p>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between"><span>mode</span><span class="font-medium text-foreground">{modeLabel}</span></div>
            <div class="flex justify-between"><span>pace</span><span class="font-medium text-foreground">{paceShort}</span></div>
            <div class="flex justify-between"><span>members</span><span>{snap.memberCount}/2</span></div>
            <div class="flex justify-between"><span>ready</span><span class="{guestReady ? 'text-positive font-semibold' : 'text-amber-600'}">{guestReady ? 'Guest ready ✓' : 'Not ready'}</span></div>
            <div class="flex justify-between"><span>presence</span><span class="{bothPresent ? 'text-positive' : 'text-amber-600'}">{bothPresent ? 'Both online' : 'Offline'}</span></div>
          </div>
        </div>

        {#if isHost || isGuest}
          <!-- dev-only diagnostics -->
          {#if typeof window !== 'undefined' && (window as unknown as { __HOOP_RUSH_DEV?: boolean }).__HOOP_RUSH_DEV}
            <details class="rounded-xl border border-line-soft bg-card p-4">
              <summary class="cursor-pointer text-xs font-semibold">Diagnostics (dev only)</summary>
              <div class="mt-3 space-y-1 font-mono text-xs break-all">
                <div>room {roomId}</div>
                <div>revision {snap.revision} · digest {snap.digest.slice(0,12)}…</div>
                <div>cursor {snap.cursor} · settings rev {(snap as unknown as { settingsRevision?: number }).settingsRevision}</div>
                <div>protocol v{snap.settings.roomProtocolVersion} · multiplayer {snap.settings.multiplayerVersion}</div>
                <div>presence {JSON.stringify((snap as unknown as { presence?: unknown }).presence)}</div>
                <div>seed {(snap as unknown as { seed?: string | null }).seed ? (snap as unknown as { seed?: string | null }).seed!.slice(0,12)+'…' : 'null'}</div>
              </div>
            </details>
          {:else}
            <details class="rounded-xl border border-line-soft bg-card p-4">
              <summary class="cursor-pointer text-xs font-semibold">Details</summary>
              <div class="mt-3 space-y-1 text-xs">
                <div>Room {roomId.slice(0,8)}… · {modeLabel} · {paceShort}</div>
                <div>{snap.memberCount}/2 players · {guestReady ? 'Ready' : 'Not ready'} · {bothPresent ? 'Both connected' : 'Reconnecting'}</div>
              </div>
            </details>
          {/if}
        {/if}
      </div>
    </div>

    {#if showLeaveConfirm}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="w-full max-w-sm rounded-xl bg-card p-6">
          <h3 class="font-display text-sm font-extrabold tracking-widest uppercase">Leave room?</h3>
          <p class="mt-2 text-sm text-muted-foreground">You’ll be removed from this room. Your draft progress (if any) stays local. You’ll need a new invite to rejoin before Start.</p>
          <div class="mt-4 flex gap-2">
            <button type="button" onclick={() => showLeaveConfirm=false} class="flex-1 rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" onclick={handleLeave} class="flex-1 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground">Leave</button>
          </div>
        </div>
      </div>
    {/if}
    {#if showRemoveConfirm}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="w-full max-w-sm rounded-xl bg-card p-6">
          <h3 class="font-display text-sm font-extrabold tracking-widest uppercase">Remove guest?</h3>
          <p class="mt-2 text-sm text-muted-foreground">Host will remove guest and regenerate invite code. New invite link required.</p>
          <div class="mt-4 flex gap-2">
            <button type="button" onclick={() => showRemoveConfirm=false} class="flex-1 rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" onclick={handleRemoveGuest} class="flex-1 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground">Remove & regen code</button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</section>
