<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import {
    ArrowLeft,
    RefreshCw,
    AlertTriangle,
    Trophy,
    Users,
    Lock,
    Check,
    Clock,
    Wifi,
    WifiOff,
    Play,
  } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import {
    createSupabaseSeasonTransport,
    isSupabaseConfigured,
  } from '$lib/season/supabase-season-transport';
  import { loadMembership, saveMembership } from '$lib/season/season-room-identity';
  import { RoomDraftController } from '$lib/season/room-draft-controller';
  import { createGameplayTransport } from '$lib/season/season-gameplay-transport';
  import {
    deriveGameplayState,
    type MultiplayerGameplayState,
  } from '$lib/season/season-gameplay-state';
  import type {
    SeasonRoomPublicSnapshot,
    SeasonRoomMembership,
    SeasonMultiplayerTransport,
    SeasonRun,
    SeasonDraftState,
    SeasonLeagueGenerationResult,
  } from '@hoop-rush/data-contracts';

  let roomId = $derived($page.params.roomId as string);

  let snap = $state<SeasonRoomPublicSnapshot | null>(null);
  let membership = $state<SeasonRoomMembership | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let coordinator: ReturnType<typeof createInMemorySeasonRoomCoordinator> | null = null;
  let transport: ReturnType<typeof createSupabaseSeasonTransport> | null = null;
  let controller: RoomDraftController | null = $state(null);
  let draftState: SeasonDraftState | null = $state(null);
  let generation: SeasonLeagueGenerationResult | null = $state(null);
  let gameplay: MultiplayerGameplayState | null = $state(null);
  let run: SeasonRun | null = $state(null);
  let bootstrapping = $state(false);
  let phase: MultiplayerGameplayState['phase'] | null = $state(null);

  const FRANCHISE_DISPLAY: Record<string, string> = {
    hawks: 'Atlanta Hawks',
    celtics: 'Boston Celtics',
    nets: 'Brooklyn Nets',
    hornets: 'Charlotte Hornets',
    bulls: 'Chicago Bulls',
    cavaliers: 'Cleveland Cavaliers',
    mavericks: 'Dallas Mavericks',
    nuggets: 'Denver Nuggets',
    pistons: 'Detroit Pistons',
    warriors: 'Golden State Warriors',
    rockets: 'Houston Rockets',
    pacers: 'Indiana Pacers',
    clippers: 'LA Clippers',
    lakers: 'Los Angeles Lakers',
    grizzlies: 'Memphis Grizzlies',
    heat: 'Miami Heat',
    bucks: 'Milwaukee Bucks',
    timberwolves: 'Minnesota Timberwolves',
    pelicans: 'New Orleans Pelicans',
    knicks: 'New York Knicks',
    thunder: 'Oklahoma City Thunder',
    magic: 'Orlando Magic',
    sixers: 'Philadelphia 76ers',
    suns: 'Phoenix Suns',
    blazers: 'Portland Trail Blazers',
    kings: 'Sacramento Kings',
    spurs: 'San Antonio Spurs',
    raptors: 'Toronto Raptors',
    jazz: 'Utah Jazz',
    wizards: 'Washington Wizards',
  };

  function franchiseDisplayName(id: string | null | undefined): string {
    if (!id) return '—';
    return FRANCHISE_DISPLAY[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
  }

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
      commandCursor: () => controller?.getLastOrdinal() ?? -1,
      onSnapshot: (s) => {
        snap = s;
      },
      onCommands: () => {},
    });
  }

  function getTransport(): SeasonMultiplayerTransport {
    if (transport) return transport as unknown as SeasonMultiplayerTransport;
    const anyCoord = coordinator as unknown as { transport?: SeasonMultiplayerTransport };
    if (anyCoord?.transport) return anyCoord.transport;
    throw new Error('no transport');
  }

  async function load() {
    loading = true;
    error = null;
    try {
      coordinator = getCoordinator();
      const stored = loadMembership(roomId);
      try {
        coordinator.hydrateFromStorage(roomId);
      } catch {}
      const t = transport as unknown as SeasonMultiplayerTransport | null;
      let res: SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
      if (t) {
        res = (await t.resume(roomId)) as SeasonRoomPublicSnapshot & {
          membership?: SeasonRoomMembership;
        };
      } else if (coordinator) {
        res = (await coordinator.refresh(roomId)) as unknown as SeasonRoomPublicSnapshot & {
          membership?: SeasonRoomMembership;
        };
      } else throw new Error('Multiplayer not configured');
      snap = res as SeasonRoomPublicSnapshot;
      if ((res as unknown as { membership?: SeasonRoomMembership }).membership) {
        const m = (res as unknown as { membership: SeasonRoomMembership }).membership;
        saveMembership(m);
        membership = m;
      } else {
        membership = stored ?? loadMembership(roomId);
      }
      if (snap && membership) {
        coordinator.subscribe(roomId);
        const tr = getTransport();
        // Warm Dexie-cached season assets in parallel with log replay. The draft page
        // already cached the 16.36MB catalog via readCachedAsset; warming here ensures
        // controller.ensureAssets hits the memoized/Dexie cache and avoids a second
        // synchronous parse blocking on the main thread. Hash verification is retained
        // (season-assets verifies contentHash, bootstrap uses cached path, no 'no-store').
        const warmAssets = import('$lib/season/season-assets')
          .then(async (m) => {
            try {
              await m.loadSeasonDraftCatalog();
            } catch {}
            try {
              await m.loadSeasonLeague();
            } catch {}
            try {
              await m.loadSeasonRosterTargets();
            } catch {}
          })
          .catch(() => {});
        controller = new RoomDraftController({
          transport: tr,
          roomId,
          snapshot: snap,
          membership,
        });
        const [, state] = await Promise.all([warmAssets, controller.restoreFromLog()]);
        draftState = state ? ({ ...state } as SeasonDraftState) : null;
        generation = controller.getGeneration();
        if (!draftState) {
          if (snap.phase === 'drafting') {
            await controller.ensureDraftCreated();
            draftState = controller.getState();
            generation = controller.getGeneration();
          }
        }
        if (draftState && generation) {
          await bootstrapRun();
        } else if (draftState && (draftState as any).status === 'complete' && !generation) {
          generation = controller.getGeneration();
          if (generation) await bootstrapRun();
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function bootstrapRun() {
    if (!draftState || !generation || !controller) return;
    bootstrapping = true;
    try {
      const gt = createGameplayTransport();
      const result = await gt.loadBootstrap(roomId, getTransport(), draftState, generation);
      run = result.run;
      gameplay = deriveGameplayState(draftState, generation, result);
      phase = gameplay.phase;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      bootstrapping = false;
    }
  }

  onMount(() => {
    load();
    return () => coordinator?.destroy();
  });

  let modeLabel = $derived.by(() => {
    const raw =
      (snap as unknown as { mode?: string })?.mode ??
      (snap?.settings as unknown as { mode?: string })?.mode ??
      'season';
    if (raw === 'classic') return 'Classic';
    if (raw === 'sandbox') return 'Sandbox';
    return 'Season Run';
  });

  let myFranchiseId = $derived(membership?.franchiseId ?? null);
  let oppFranchiseId = $derived(
    (draftState as any)?.participants.find(
      (p: any) => p.participantId !== membership?.participantId,
    )?.franchiseId ?? null,
  );
  let myFranchiseName = $derived(franchiseDisplayName(myFranchiseId));
  let oppFranchiseName = $derived(franchiseDisplayName(oppFranchiseId));
  let p1FranchiseName = $derived.by(() => {
    const p1 =
      (draftState as any)?.participants.find((p: any) => p.participantId === 'p1')?.franchiseId ??
      null;
    return franchiseDisplayName(p1);
  });
  let p2FranchiseName = $derived.by(() => {
    const p2 =
      (draftState as any)?.participants.find((p: any) => p.participantId === 'p2')?.franchiseId ??
      null;
    return franchiseDisplayName(p2);
  });
  let opponentOnline = $derived.by(() => {
    if (!snap || !membership) return false;
    const opp = membership.participantId === 'p1' ? 'p2' : 'p1';
    return (
      snap.presence?.find((p: any) => p.participantId === opp)?.online ?? snap.memberCount >= 2
    );
  });
  let isPrivateLock = $derived(phase === 'private-lock');
  let isSimulation = $derived(phase === 'simulation');
  let isHashVerification = $derived(phase === 'hash-verification');
  let isComplete = $derived(phase === 'complete');

  // Roster helpers for basketball-forward display
  let playerNameLookup = $derived.by(() => {
    const map = new Map<string, string>();
    if (!run) return map;
    for (const roster of run.rosters) {
      for (const p of roster.players) {
        map.set(p.playerVersionId, p.displayName);
      }
    }
    return map;
  });
  let myRoster = $derived.by(() => {
    if (!run || !myFranchiseId) return null;
    return run.rosters.find((r) => r.franchiseId === myFranchiseId) ?? null;
  });
  let oppRoster = $derived.by(() => {
    if (!run || !oppFranchiseId) return null;
    return run.rosters.find((r) => r.franchiseId === oppFranchiseId) ?? null;
  });
  let myNextOpponentName = $derived.by(() => {
    if (!run || !myRoster) return 'TBD';
    // Find next scheduled game for my franchise that hasn't been played (standings 0-0 so all future)
    const next = run.games.find(
      (g) => g.homeFranchiseId === myFranchiseId || g.awayFranchiseId === myFranchiseId,
    );
    if (!next) return 'TBD';
    const oppId =
      next.homeFranchiseId === myFranchiseId ? next.awayFranchiseId : next.homeFranchiseId;
    return franchiseDisplayName(oppId);
  });

  function picksFor(participantId: string) {
    return (draftState as any)?.picks.filter((p: any) => p.participantId === participantId) ?? [];
  }
  function displayPlayerName(versionId: string): string {
    return playerNameLookup.get(versionId) ?? versionId;
  }
</script>

<svelte:head
  ><title>Season Hub — {myFranchiseName} vs {oppFranchiseName} — Hoop Rush</title></svelte:head
>

<section class="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex items-center justify-between gap-3 py-6">
    <a
      href={`/multiplayer/room/${roomId}/draft`}
      class="text-label inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      ><ArrowLeft class="h-3.5 w-3.5" /> Back to draft</a
    >
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={load}
        class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold hover:border-line-strong"
        ><RefreshCw class="h-3.5 w-3.5" />Refresh</button
      >
      <a
        href={resolve('/multiplayer')}
        class="hidden text-xs text-muted-foreground underline-offset-4 hover:underline sm:inline"
        >Multiplayer</a
      >
    </div>
  </div>

  {#if loading}
    <div class="rounded-xl bg-surface-1 p-10 text-center">
      <p class="font-mono text-sm text-muted-foreground">Loading Season Hub…</p>
      <p class="mt-2 text-xs text-muted-foreground">Preparing your franchise for Block 1</p>
    </div>
  {:else if error}
    <div class="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
      <div class="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle class="h-4 w-4" />Could not load Season Hub
      </div>
      <p class="mt-2 text-sm text-muted-foreground">{error}</p>
      <div class="mt-4 flex gap-2">
        <button
          type="button"
          onclick={load}
          class="rounded-lg bg-card px-4 py-2 text-sm font-semibold">Retry</button
        >
        <a
          href={`/multiplayer/room/${roomId}/draft`}
          class="rounded-lg border border-line-soft px-4 py-2 text-sm font-semibold"
          >Back to draft</a
        >
      </div>
    </div>
  {:else if !membership}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 class="font-display text-lg font-extrabold uppercase">No seat found</h2>
      <p class="mt-2 text-sm text-muted-foreground">
        We couldn't find your franchise seat for this room. Return to the lobby to rejoin.
      </p>
      <a
        href={resolve('/multiplayer')}
        class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >Go to Multiplayer entry</a
      >
    </div>
  {:else if !draftState}
    <div class="rounded-xl bg-surface-1 p-8 text-center">
      <p class="text-label text-primary">No draft state</p>
      <h2 class="font-display mt-2 text-2xl font-extrabold uppercase">Draft not complete</h2>
      <p class="mt-2 text-sm text-muted-foreground">
        {modeLabel} · Finish the snake draft (10 picks each, balanced 4G / 4F / 3C coverage) to unlock
        your Season Hub.
      </p>
      <a
        href={`/multiplayer/room/${roomId}/draft`}
        class="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
        >Go to draft →</a
      >
    </div>
  {:else if (draftState as any).status !== 'complete' && !generation}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 class="font-display text-lg font-extrabold uppercase">League verification pending</h2>
      <p class="mt-2 text-sm text-muted-foreground">
        Draft picks {(draftState as any).picks.length}/20 · Finalize your board (10 each, covering
        guards, forwards and centers) and the league will generate 28 AI opponents. Opponent needs
        to finalize before Block 1 can start.
      </p>
      <div class="mt-4 flex gap-2">
        <a
          href={`/multiplayer/room/${roomId}/draft`}
          class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >Finalize in draft →</a
        >
        <button
          type="button"
          onclick={load}
          class="rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
          >Reload</button
        >
      </div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-primary">
            {p1FranchiseName} — {picksFor('p1').length}/10 picks
          </p>
          <div class="mt-2 space-y-1">
            {#each picksFor('p1') as pick (pick.playerVersionId)}<div
                class="flex items-center justify-between rounded bg-surface-1 px-2 py-1 text-xs"
              >
                <span class="font-medium">{displayPlayerName(pick.playerVersionId)}</span><span
                  class="text-muted-foreground">R{pick.round}</span
                >
              </div>{/each}
            {#if picksFor('p1').length === 0}<p class="text-xs text-muted-foreground">
                No picks yet
              </p>{/if}
          </div>
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">
            {p2FranchiseName} — {picksFor('p2').length}/10 picks
          </p>
          <div class="mt-2 space-y-1">
            {#each picksFor('p2') as pick (pick.playerVersionId)}<div
                class="flex items-center justify-between rounded bg-surface-1 px-2 py-1 text-xs"
              >
                <span class="font-medium">{displayPlayerName(pick.playerVersionId)}</span><span
                  class="text-muted-foreground">R{pick.round}</span
                >
              </div>{/each}
            {#if picksFor('p2').length === 0}<p class="text-xs text-muted-foreground">
                No picks yet
              </p>{/if}
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-label tracking-[0.16em] text-primary">
            {modeLabel} · {myFranchiseName} vs {oppFranchiseName}
          </p>
          <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">
            Season Hub — Draft Complete, Awaiting Block Simulation
          </h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {myFranchiseName} ({myRoster?.players.length ?? 10} players) vs {oppFranchiseName} ({oppRoster
              ?.players.length ?? 10} players) · 0–0 provisional · Next opponent: {myNextOpponentName}
          </p>
          <p class="mt-1 text-sm font-medium text-foreground">
            Next: Lock your rotation and objectives to simulate Block 1
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            {#if opponentOnline}<span
                class="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-1 text-xs text-positive"
                ><Wifi class="h-3 w-3" /> Opponent online</span
              >{:else}<span
                class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700"
                ><WifiOff class="h-3 w-3" /> Opponent away</span
              >{/if}
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
              ><Users class="h-3 w-3" />
              {myFranchiseName} & {oppFranchiseName} · 2 humans + 28 AI</span
            >
            {#if isComplete}<span
                class="inline-flex items-center gap-1.5 rounded-full bg-positive px-3 py-1 text-xs font-bold text-white"
                ><Check class="h-3 w-3" /> Complete</span
              >{/if}
          </div>
        </div>
        <div class="flex flex-col items-end gap-2">
          {#if run}<span
              class="inline-flex items-center gap-1.5 rounded-full bg-card border border-line-soft px-3 py-1 text-xs"
              ><Trophy class="h-3 w-3" /> Stage {run.stage} · Block {run.cursor.completedRounds} of 9</span
            >{/if}
          <span
            class="inline-flex items-center gap-1.5 rounded-full bg-card border border-line-soft px-3 py-1 text-xs"
            ><Clock class="h-3 w-3" />
            {snap?.settings.pace === 'live'
              ? 'Live — short clocks'
              : 'Async — daily deadlines'}</span
          >
        </div>
      </div>

      <div class="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <p class="text-sm font-semibold text-foreground">
          Draft complete — league verified. Choose your basketball decisions to start Block 1.
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          Both franchises are set (0–0). Set your rotation and minutes, pick your season objective,
          review your campaign opportunity, and declare free agency before you lock. Both teams lock
          privately, then the block simulates together.
        </p>
        <div class="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <button
            type="button"
            disabled
            class="rounded-lg border border-line-soft bg-card px-3 py-2.5 text-left opacity-60"
          >
            <span class="block text-xs font-bold uppercase tracking-wide">Set Rotation</span>
            <span class="mt-1 block text-xs text-muted-foreground">Minutes & health</span>
            <span class="mt-1 block text-[11px] font-semibold text-muted-foreground"
              >Coming in next update</span
            >
          </button>
          <button
            type="button"
            disabled
            class="rounded-lg border border-line-soft bg-card px-3 py-2.5 text-left opacity-60"
          >
            <span class="block text-xs font-bold uppercase tracking-wide">Season Objective</span>
            <span class="mt-1 block text-xs text-muted-foreground">Choose your goal</span>
            <span class="mt-1 block text-[11px] font-semibold text-muted-foreground"
              >Coming in next update</span
            >
          </button>
          <button
            type="button"
            disabled
            class="rounded-lg border border-line-soft bg-card px-3 py-2.5 text-left opacity-60"
          >
            <span class="block text-xs font-bold uppercase tracking-wide">Campaign</span>
            <span class="mt-1 block text-xs text-muted-foreground">Review opportunity</span>
            <span class="mt-1 block text-[11px] font-semibold text-muted-foreground"
              >Coming in next update</span
            >
          </button>
          <button
            type="button"
            disabled
            class="rounded-lg border border-line-soft bg-card px-3 py-2.5 text-left opacity-60"
          >
            <span class="block text-xs font-bold uppercase tracking-wide">Free Agency</span>
            <span class="mt-1 block text-xs text-muted-foreground">Declare or skip</span>
            <span class="mt-1 block text-[11px] font-semibold text-muted-foreground"
              >Coming in next update</span
            >
          </button>
          <button
            type="button"
            disabled
            class="flex flex-col items-center justify-center rounded-lg bg-primary px-3 py-2.5 text-primary-foreground opacity-60"
          >
            <span class="flex items-center gap-1 text-xs font-bold uppercase tracking-wide"
              ><Lock class="h-3.5 w-3.5" /> Lock for Block 1</span
            >
            <span class="mt-1 text-[11px]">Coming in next update</span>
          </button>
        </div>
        <p class="mt-3 text-xs text-muted-foreground">
          No games have been simulated yet — standings are provisional 0–0. Locking requires both
          teams; results are verified before they count.
        </p>
      </div>
    </div>

    <div class="mt-6 grid gap-3 sm:grid-cols-3">
      <div
        class="rounded-xl border p-4 {isPrivateLock
          ? 'border-primary/40 bg-primary/5'
          : 'border-line-soft bg-card'}"
      >
        <div class="flex items-center gap-1.5 font-semibold text-xs tracking-widest uppercase">
          <Lock class="h-3.5 w-3.5" /> Lock decisions
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          Rotation, objective, campaign choice and free-agency plan. Both teams lock privately, then
          reveal together.
        </p>
        <p
          class="mt-2 text-xs font-semibold {gameplay?.p1Locked && gameplay?.p2Locked
            ? 'text-positive'
            : 'text-amber-600'}"
        >
          {gameplay?.p1Locked && gameplay?.p2Locked
            ? 'Both teams locked ✓'
            : 'Waiting for both teams to lock'}
        </p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span
            class="inline-flex rounded-full border px-2 py-1 text-xs {gameplay?.p1Locked
              ? 'border-positive bg-positive/10 text-positive'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700'}"
            >{p1FranchiseName} {gameplay?.p1Locked ? '✓' : '…'}</span
          >
          <span
            class="inline-flex rounded-full border px-2 py-1 text-xs {gameplay?.p2Locked
              ? 'border-positive bg-positive/10 text-positive'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700'}"
            >{p2FranchiseName} {gameplay?.p2Locked ? '✓' : '…'}</span
          >
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          Your franchise: <span class="font-semibold text-foreground">{myFranchiseName}</span> · Waiting
          on honest lock state.
        </p>
      </div>
      <div
        class="rounded-xl border p-4 {isSimulation
          ? 'border-primary bg-primary/10'
          : 'border-line-soft bg-card'}"
      >
        <div class="flex items-center gap-1.5 font-semibold text-xs tracking-widest uppercase">
          <Play class="h-3.5 w-3.5" /> Simulate Block 1
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          Once both teams lock, the league simulates. You'll see live progress here.
        </p>
        {#if gameplay?.simulationProgress}
          <p class="mt-2 text-xs">
            {gameplay.simulationProgress.completed}/{gameplay.simulationProgress.total} games · {gameplay
              .simulationProgress.latestGameId ?? ''}
          </p>
          <div class="mt-2 h-1.5 w-full rounded-full bg-line-soft">
            <div
              class="h-1.5 rounded-full bg-primary"
              style={`width:${(gameplay.simulationProgress.completed / Math.max(1, gameplay.simulationProgress.total)) * 100}%`}
            ></div>
          </div>
        {:else}
          <p class="mt-2 text-xs text-muted-foreground">Awaiting locks — no games simulated yet.</p>
        {/if}
      </div>
      <div
        class="rounded-xl border p-4 {isHashVerification
          ? 'border-primary bg-primary/10'
          : 'border-line-soft bg-card'}"
      >
        <div class="flex items-center gap-1.5 font-semibold text-xs tracking-widest uppercase">
          <Trophy class="h-3.5 w-3.5" /> Results & verification
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          Results are verified before standings update. Both sides confirm the same outcome before
          it counts.
        </p>
        {#if gameplay?.attestation}
          <p
            class="mt-2 text-xs {gameplay.attestation.verified
              ? 'text-positive font-semibold'
              : 'text-destructive'}"
          >
            {gameplay.attestation.verified ? 'Verified ✓' : 'Awaiting verification'}
          </p>
        {:else}
          <p class="mt-2 text-xs text-muted-foreground">No results yet — awaiting simulation.</p>
        {/if}
        <p class="mt-2 text-xs text-muted-foreground">
          Standings stay 0–0 until Block 1 is verified.
        </p>
      </div>
    </div>

    {#if bootstrapping}
      <div class="mt-6 rounded-xl bg-surface-1 p-10 text-center">
        <p class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
          <RefreshCw class="h-4 w-4 animate-spin" /> Preparing Season Hub…
        </p>
        <p class="mt-2 text-xs text-muted-foreground">Loading rosters and schedule</p>
      </div>
    {:else if run}
      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">
            Your franchise & opponent
          </h2>
          <p class="mt-1 text-xs text-muted-foreground">
            Roster health, minutes needs and matchup context — decide your rotation before locking.
          </p>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p class="text-label text-primary">You — {myFranchiseName}</p>
              <p class="mt-1 font-display text-sm font-extrabold uppercase">{myFranchiseName}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {myRoster?.players.length ??
                  picksFor(membership!.participantId as string).length}/10 draft picks · Next: set
                rotation
              </p>
              <div class="mt-2 space-y-1">
                {#each myRoster?.players ?? [] as player (player.playerVersionId)}
                  <div class="flex items-center justify-between rounded bg-card px-2 py-1.5">
                    <span class="truncate text-xs font-medium">{player.displayName}</span>
                    <span class="ml-2 shrink-0 text-[11px] text-muted-foreground"
                      >{player.eraId} · {player.seasonKey}</span
                    >
                  </div>
                {:else}
                  {#each picksFor(membership!.participantId as string) as pick (pick.playerVersionId)}
                    <div class="flex items-center justify-between rounded bg-card px-2 py-1.5">
                      <span class="truncate text-xs font-medium"
                        >{displayPlayerName(pick.playerVersionId)}</span
                      >
                      <span class="ml-2 shrink-0 text-xs text-muted-foreground">R{pick.round}</span>
                    </div>
                  {/each}
                {/each}
              </div>
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled
                  class="flex-1 rounded-lg border border-line-soft bg-card px-3 py-2 text-xs font-semibold opacity-60"
                  >Review Rotation</button
                >
                <button
                  type="button"
                  disabled
                  class="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground opacity-60"
                  >Set Minutes</button
                >
              </div>
              <p class="mt-2 text-[11px] text-muted-foreground">
                Minutes & health checks live here next update.
              </p>
            </div>
            <div class="rounded-lg border border-line-soft bg-card p-3">
              <p class="text-label text-muted-foreground">Opponent — {oppFranchiseName}</p>
              <p class="mt-1 font-display text-sm font-extrabold uppercase">{oppFranchiseName}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {oppRoster?.players.length ??
                  picksFor(membership.participantId === 'p1' ? 'p2' : 'p1').length}/10 draft picks
              </p>
              <div class="mt-2 space-y-1">
                {#each oppRoster?.players ?? [] as player (player.playerVersionId)}
                  <div
                    class="flex items-center justify-between rounded bg-surface-1 border border-line-soft px-2 py-1.5"
                  >
                    <span class="truncate text-xs font-medium">{player.displayName}</span>
                    <span class="ml-2 shrink-0 text-[11px] text-muted-foreground"
                      >{player.eraId} · {player.seasonKey}</span
                    >
                  </div>
                {:else}
                  {#each picksFor(membership.participantId === 'p1' ? 'p2' : 'p1') as pick (pick.playerVersionId)}
                    <div
                      class="flex items-center justify-between rounded bg-surface-1 border border-line-soft px-2 py-1.5"
                    >
                      <span class="truncate text-xs font-medium"
                        >{displayPlayerName(pick.playerVersionId)}</span
                      >
                      <span class="ml-2 shrink-0 text-xs text-muted-foreground">R{pick.round}</span>
                    </div>
                  {/each}
                {/each}
              </div>
              <p class="mt-2 text-xs text-muted-foreground">
                Opponent rotation hidden until both lock.
              </p>
            </div>
          </div>
          <div class="mt-4 rounded-lg border border-line-soft bg-card p-3 text-xs">
            <p class="font-semibold text-foreground">Season matchup</p>
            <p class="mt-1 text-muted-foreground">
              Your next head-to-head vs <span class="font-semibold text-foreground"
                >{oppFranchiseName}</span
              > is scheduled in Block 1. Rivalry record is provisional 0–0 until games are simulated.
            </p>
            <p class="mt-1 text-muted-foreground">
              Health & minutes needs will surface here once rotation tooling ships — keep your
              starters fresh for the opening block.
            </p>
          </div>
        </div>

        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">
            Season Run preview
          </h2>
          <p class="mt-1 text-xs text-muted-foreground">
            Provisional standings — 0–0 before Block 1 · 30 teams · Regular season 9 blocks
          </p>
          <div class="mt-3 rounded-lg border border-line-soft bg-card p-3">
            <p class="text-label text-muted-foreground">Rosters (30 teams)</p>
            <p class="mt-1 text-xs">
              <span class="font-semibold">{myFranchiseName}</span>
              {myRoster?.players.length ?? 0} players ·
              <span class="font-semibold">{oppFranchiseName}</span>
              {oppRoster?.players.length ?? 0} players · 28 AI opponents complete the league
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              Each franchise carries 10 draft picks plus 28 AI-built rosters.
            </p>
          </div>
          <div class="mt-3 rounded-lg border border-line-soft bg-card p-3">
            <p class="text-label text-muted-foreground">Standings — provisional 0–0</p>
            <p class="mt-1 text-xs text-muted-foreground">
              No games simulated yet. Preseason rank shown until Block 1 verifies.
            </p>
            <div class="mt-2 space-y-1 max-h-48 overflow-auto">
              {#each run.standings.rows.slice(0, 8) as row (row.franchiseId)}
                <div class="flex justify-between text-xs">
                  <span class="font-medium">{franchiseDisplayName(row.franchiseId)}</span><span
                    class="font-mono text-muted-foreground"
                    >{row.wins}-{row.losses} · {row.gamesPlayed > 0
                      ? Math.round((row.wins / row.gamesPlayed) * 100)
                      : 0}%</span
                  >
                </div>
              {/each}
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              Next games: vs {myNextOpponentName} and 6 more in Block 1. Full schedule unlocks after lock.
            </p>
          </div>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              onclick={() => goto(`/multiplayer/room/${roomId}/draft`)}
              class="flex-1 rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
              >Back to draft</button
            >
            <button
              type="button"
              disabled
              class="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground opacity-60"
              >Lock for Block 1</button
            >
          </div>
          <p class="mt-2 text-center text-[11px] text-muted-foreground">
            Locking opens with rotation & objective tools — coming in next update.
          </p>
        </div>
      </div>

      <details class="mt-6 rounded-xl border border-line-soft bg-card">
        <summary
          class="cursor-pointer list-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >Debug — digests & transport details</summary
        >
        <div
          class="border-t border-line-soft px-4 py-3 text-xs leading-relaxed text-muted-foreground"
        >
          <p class="font-mono break-all">Run {run.runId} · stateRevision {run.stateRevision}</p>
          <p class="font-mono break-all">League digest {generation?.digest ?? '—'}</p>
          <p class="font-mono break-all">State digest {run.stateDigest}</p>
          <p class="mt-1">Phase {phase} · room phase {snap?.phase} · pace {snap?.settings.pace}</p>
          <p class="mt-1">
            Stage {run.stage} · completedRounds {run.cursor.completedRounds} · AI pools {generation
              ?.aiPools.length ?? 0}
          </p>
          <p class="mt-1">
            Transport: Supabase room coordination (discovery, presence, locks, attestations) —
            simulation stays local.
          </p>
        </div>
      </details>
    {:else}
      <div class="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
        <p class="text-sm font-semibold">Run not yet bootstrapped</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Draft status {(draftState as any).status} · Generation {generation ? 'ready' : 'pending'} ·
          Run will appear once league verification completes.
        </p>
        <button
          type="button"
          onclick={bootstrapRun}
          class="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >Prepare Season Hub →</button
        >
      </div>
    {/if}
  {/if}
</section>
