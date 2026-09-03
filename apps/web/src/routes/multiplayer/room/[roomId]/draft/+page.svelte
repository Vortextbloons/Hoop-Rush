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
    Clock,
    Wifi,
    WifiOff,
    Lock,
    Check,
    Loader2,
  } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import {
    createSupabaseSeasonTransport,
    isSupabaseConfigured,
  } from '$lib/season/supabase-season-transport';
  import { loadMembership, saveMembership } from '$lib/season/season-room-identity';
  import type {
    SeasonRoomPublicSnapshot,
    SeasonRoomMembership,
    SeasonMultiplayerTransport,
    SeasonDraftOffer,
    SeasonPublicCommandEnvelope,
    HoopRushManifest,
    SeasonDraftCatalog,
    SeasonDraftCandidate,
  } from '@hoop-rush/data-contracts';
  import { SEASON_DRAFT_OFFER_SIZE, SEASON_DRAFT_SAFE_MINIMUM } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import { formatPositions } from '$lib/player-positions';
  import { loadSeasonDraftCatalog } from '$lib/season/season-assets';
  import {
    buildVersionFaceIndex,
    eraIdentityOf,
    type SeasonFaceRef,
  } from '$lib/season/season-branding';
  import { RoomDraftController } from '$lib/season/room-draft-controller';
  import { catalogCandidateMap } from '$lib/season/season-catalog-index';

  let roomId = $derived($page.params.roomId as string);

  let snap = $state<SeasonRoomPublicSnapshot | null>(null);
  let membership = $state<SeasonRoomMembership | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let coordinator: ReturnType<typeof createInMemorySeasonRoomCoordinator> | null = null;
  let transport: ReturnType<typeof createSupabaseSeasonTransport> | null = null;
  let controller: RoomDraftController | null = $state(null);
  let draftState: import('@hoop-rush/data-contracts').SeasonDraftState | null = $state(null);
  let generation: import('@hoop-rush/data-contracts').SeasonLeagueGenerationResult | null =
    $state(null);
  let picking = $state(false);
  let drawing = $state(false);
  let autoPickAttemptKey: string | null = null;
  let pickError = $state<string | null>(null);
  let finalizeBusy = $state(false);
  let generateBusy = $state(false);
  let leagueDigest: string | null = $state(null);
  let verification: { ok: boolean; msg: string } | null = $state(null);
  let tick = $state(0);
  let manifest = $state<HoopRushManifest | null>(null);
  let catalog = $state<SeasonDraftCatalog | null>(null);
  let faces = $state<Map<string, SeasonFaceRef>>(new Map());
  let replayError = $derived.by(() => controller?.getLastReplayError() ?? null);
  let integrityFailed = $derived.by(() => controller?.hasIntegrityFailure() ?? false);

  async function loadCriticalAssets() {
    const [m, cat] = await Promise.all([getManifest(), loadSeasonDraftCatalog()]);
    manifest = m;
    catalog = cat;
  }

  async function loadFacesLazy() {
    try {
      const ix = await getPlayersIndex();
      if (!catalog) return;
      faces = buildVersionFaceIndex(
        ix.players,
        catalog.candidates.map((candidate) => ({
          playerVersionId: candidate.playerVersionId,
          playerId: candidate.playerId,
          franchiseId: candidate.franchiseId,
          eraId: candidate.eraId,
          seasonKey: candidate.seasonKey,
          displayName: candidate.displayName,
        })),
      );
    } catch {}
  }

  // legacy: kept for non-critical callers, but no longer blocks draft interactive
  async function loadDisplayAssets() {
    await loadCriticalAssets();
    await loadFacesLazy();
  }

  // Memoized O(1) lookup via WeakMap cache; previous find was O(C≈3k) per card/pick per render, magnified by tick
  let candidateMap = $derived.by(() => {
    if (!catalog) return new Map<string, SeasonDraftCandidate>();
    return catalogCandidateMap(catalog);
  });
  function candidateOf(playerVersionId: string): SeasonDraftCandidate | null {
    if (!catalog) return null;
    return candidateMap.get(playerVersionId) ?? null;
  }

  function faceOf(playerVersionId: string): SeasonFaceRef | null {
    return faces.get(playerVersionId) ?? null;
  }

  function playerLabel(playerVersionId: string): string {
    return candidateOf(playerVersionId)?.displayName ?? playerVersionId;
  }

  function eraLabel(eraId: string): string {
    return manifest?.eras.find((e) => e.eraId === eraId)?.label ?? eraId;
  }

  function franchiseLabel(franchiseId: string): string {
    return (
      manifest?.modernFranchiseSlots.find((s) => s.franchiseId === franchiseId)?.displayName ??
      franchiseId
    );
  }

  function syncDraftFromController(state: typeof draftState) {
    draftState = state ? ({ ...state } as typeof draftState) : null;
    generation = controller?.getGeneration() ?? null;
  }

  function maybeDrawOnTurn(state: typeof draftState) {
    if (
      state &&
      membership &&
      state.currentTurnParticipantId === membership.participantId &&
      !state.currentOffer &&
      state.status === 'drafting'
    ) {
      void handleDraw();
    }
  }

  function ensureCoordinator() {
    if (coordinator) return coordinator;
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
    coordinator = createInMemorySeasonRoomCoordinator({
      transport: t,
      commandCursor: () => controller?.getLastOrdinal() ?? -1,
      onSnapshot: (s) => {
        snap = s;
        if (!controller) return;
        controller.updateSnapshot(s);
      },
      onCommands: async (cmds: SeasonPublicCommandEnvelope[]) => {
        if (!controller) return;
        const state = await controller.applyIncomingCommands(cmds);
        syncDraftFromController(state);
        maybeDrawOnTurn(state);
        void maybeAutoAdvance();
      },
    });
    return coordinator;
  }

  function getCoordinator() {
    return ensureCoordinator();
  }

  function getTransport(): SeasonMultiplayerTransport {
    if (transport) return transport as unknown as SeasonMultiplayerTransport;
    const anyCoord = coordinator as unknown as { transport?: SeasonMultiplayerTransport };
    if (anyCoord?.transport) return anyCoord.transport;
    throw new Error('no transport available');
  }

  async function maybeAutoAdvance() {
    if (!draftState || !controller) return;
    if ((draftState as any).status === 'complete' && draftState && controller.getGeneration()) {
      generation = controller.getGeneration();
      leagueDigest = generation?.digest ?? null;
      if (leagueDigest) {
        const ok = controller.verifyLeagueDigest(leagueDigest);
        verification = ok
          ? {
              ok: true,
              msg: 'League digest attested — both clients derived identical 28 AI teams (DUO_BAND_QUOTAS)',
            }
          : { ok: false, msg: 'Digest mismatch — rerun required' };
      }
    }
  }

  async function load() {
    loading = true;
    error = null;
    // Start heartbeat/subscribe early so presence stays fresh during asset loads
    let earlyCoordinator: ReturnType<typeof getCoordinator> | null = null;
    try {
      // Ensure coordinator and heartbeat start before slow asset fetches
      earlyCoordinator = getCoordinator();
      coordinator = earlyCoordinator;
      try {
        coordinator.hydrateFromStorage(roomId);
      } catch {}
      // Subscribe early: will start heartbeat every 5s; onSnapshot will be ignored until controller exists
      try {
        coordinator.subscribe(roomId);
      } catch {}
      const stored = loadMembership(roomId);
      const t = transport as unknown as SeasonMultiplayerTransport | null;
      // Critical assets (manifest 0.2MB + catalog 16MB) + resume in parallel; faces (4.6MB) deferred
      const criticalAssetsPromise = loadCriticalAssets();
      // Use afterOrdinal:-1 to coalesce resume + commands in 1 RTT (saves 100-300ms double RTT)
      const resumePromise: Promise<
        SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership; commands?: SeasonPublicCommandEnvelope[] }
      > = t
        ? ((t as unknown as { resume: (id: string, after?: number) => Promise<unknown> }).resume(roomId, -1) as Promise<
            SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership; commands?: SeasonPublicCommandEnvelope[] }
          >)
        : coordinator
          ? (coordinator.refresh(roomId) as Promise<unknown> as Promise<
              SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership; commands?: SeasonPublicCommandEnvelope[] }
            >)
          : Promise.reject(new Error('Multiplayer not configured'));
      const [, res] = await Promise.all([criticalAssetsPromise, resumePromise]);
      // fire-and-forget faces (display-only) so draft board becomes interactive 150-400ms sooner
      void loadFacesLazy();
      snap = res as SeasonRoomPublicSnapshot;
      const prefetchedCommands = (res as unknown as { commands?: SeasonPublicCommandEnvelope[] }).commands ?? null;
      if ((res as unknown as { membership?: SeasonRoomMembership }).membership) {
        const m = (res as unknown as { membership: SeasonRoomMembership }).membership;
        saveMembership(m);
        membership = m;
      } else {
        membership = stored ?? loadMembership(roomId);
      }
      if (snap && membership) {
        const tr = getTransport();
        controller = new RoomDraftController({
          transport: tr,
          roomId,
          snapshot: snap,
          membership,
          catalog,
        });
        try {
          coordinator.subscribe(roomId);
        } catch {}
        // Use prefetched commands if resume already returned them (1 RTT), else fallback to controller's own refetch (parallelized with league/targets inside)
        let state: typeof draftState | null = null;
        if (prefetchedCommands && Array.isArray(prefetchedCommands)) {
          try {
            state = (await (controller as unknown as { restoreFromLogWithPrefetched: (cmds: unknown, opts: unknown) => Promise<unknown> }).restoreFromLogWithPrefetched(prefetchedCommands, { full: true })) as typeof draftState;
          } catch {
            state = await controller.restoreFromLog({ full: true });
          }
        } else {
          state = await controller.restoreFromLog({ full: true });
        }
        if (!state) {
          if (snap.phase === 'drafting') {
            // Guest race: host create-season-draft may not have replicated yet (50-400ms). Retry briefly before giving up.
            const created = await controller.ensureDraftCreated();
            draftState = created ? ({ ...created } as typeof draftState) : null;
            if (!draftState) {
              // retry restore 2-3 times with backoff; realtime will also push, but this covers poll gap without spinner flicker
              for (let attempt = 0; attempt < 3 && !draftState; attempt += 1) {
                await new Promise<void>((r) => setTimeout(r, 300 * (attempt + 1)));
                try {
                  const retryState = await controller.restoreFromLog({ full: true });
                  if (retryState) {
                    draftState = { ...retryState } as typeof draftState;
                    generation = controller.getGeneration();
                    break;
                  }
                } catch {}
              }
            } else if (
              draftState &&
              (draftState as any).currentTurnParticipantId === membership.participantId &&
              !(draftState as any).currentOffer
            ) {
              await handleDraw();
              draftState = controller.getState() as typeof draftState;
            }
          } else {
            draftState = state as typeof draftState;
          }
        } else {
          draftState = { ...state } as typeof draftState;
          generation = controller.getGeneration();
          if (
            draftState &&
            (draftState as any).currentTurnParticipantId === membership.participantId &&
            !(draftState as any).currentOffer &&
            (draftState as any).status === 'drafting'
          ) {
            await handleDraw();
            draftState = controller.getState() as typeof draftState;
          }
          void maybeAutoAdvance();
        }
        leagueDigest = generation?.digest ?? null;
        if (leagueDigest && controller.verifyLeagueDigest(leagueDigest)) {
          verification = { ok: true, msg: 'League digest verified' };
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
    const timerIv = setInterval(() => {
      tick++;
      if (
        controller &&
        membership &&
        snap?.settings.pace === 'live' &&
        draftState?.currentTurnParticipantId === membership.participantId
      ) {
        const remaining = controller.getSecondsRemaining(Date.now());
        if (remaining !== null && remaining <= 0) {
          const attemptKey = `${membership.participantId}:${String(draftState?.revision ?? 0)}`;
          if (autoPickAttemptKey === attemptKey) return;
          autoPickAttemptKey = attemptKey;
          void controller.autoPickSafe(membership.participantId as 'p1' | 'p2').then((ns) => {
            if (ns) syncDraftFromController(ns);
          });
        }
      }
    }, 1000);
    return () => {
      clearInterval(timerIv);
      coordinator?.destroy();
    };
  });

  async function handleDraw() {
    if (!controller || !membership || drawing) return;
    const pid = membership.participantId as 'p1' | 'p2';
    if ((draftState as any)?.currentTurnParticipantId !== pid) return;
    if ((draftState as any)?.currentOffer) return;
    drawing = true;
    pickError = null;
    try {
      const record = await controller.drawOffer(pid);
      draftState = controller.getState() as typeof draftState;
      void record;
    } catch (e) {
      const code =
        (e as { code?: string; errorCode?: string })?.code ??
        (e as { errorCode?: string })?.errorCode;
      if (code === 'WRONG_TURN') pickError = 'Not your turn.';
      else if (code === 'STALE_REVISION') {
        pickError = 'Stale revision — replaying log.';
        const s = await controller.restoreFromLog();
        draftState = s ? ({ ...s } as typeof draftState) : draftState;
      } else pickError = e instanceof Error ? e.message : String(e);
    } finally {
      drawing = false;
    }
  }

  async function handlePick(playerVersionId: string) {
    if (!controller || !membership) return;
    picking = true;
    pickError = null;
    try {
      const pid = membership.participantId as 'p1' | 'p2';
      const next = await controller.submitPick(pid, playerVersionId);
      draftState = { ...next } as typeof draftState;
      generation = controller.getGeneration();
      void maybeAutoAdvance();
    } catch (e) {
      const code =
        (e as { code?: string; errorCode?: string })?.code ??
        (e as { errorCode?: string })?.errorCode;
      if (code === 'WRONG_TURN') pickError = 'Not your turn — wait for opponent.';
      else if (code === 'OWNED_VERSION')
        pickError = 'That player is already owned — duplicate identity or version rejected.';
      else if (code === 'UNCOMPLETABLE_ROSTER')
        pickError = 'Unselectable: would make 4G/4F/3C unreachable.';
      else if (code === 'UNAVAILABLE_POOL') pickError = 'Not in current 8-card offer.';
      else if (code === 'STALE_REVISION') pickError = 'Stale revision — replaying and retry.';
      else pickError = e instanceof Error ? e.message : String(e);
      if (controller) {
        const state = await controller.restoreFromLog();
        draftState = state ? ({ ...state } as typeof draftState) : draftState;
      }
    } finally {
      picking = false;
    }
  }

  async function refreshDraft() {
    if (!controller) return;
    const state = await controller.restoreFromLog({ full: true });
    syncDraftFromController(state);
    void maybeAutoAdvance();
  }

  async function handleFinalize() {
    if (!controller || finalizeBusy) return;
    finalizeBusy = true;
    pickError = null;
    try {
      const rec = await controller.finalizeRosters();
      draftState = controller.getState() as typeof draftState;
      void rec;
    } catch (e) {
      pickError = e instanceof Error ? e.message : String(e);
      const s = await controller.restoreFromLog();
      draftState = s ? ({ ...s } as typeof draftState) : draftState;
    } finally {
      finalizeBusy = false;
    }
  }

  async function handleGenerate() {
    if (!controller || generateBusy) return;
    generateBusy = true;
    pickError = null;
    verification = null;
    try {
      const res = await controller.generateAiLeague();
      draftState = res.state ? ({ ...res.state } as typeof draftState) : draftState;
      generation = res.generation;
      leagueDigest = res.digest;
      if (res.digest && res.generation) {
        const ok = controller.verifyLeagueDigest(res.digest);
        verification = ok
          ? {
              ok: true,
              msg: `League verified — ${res.generation.aiPools.length} AI pools, 28 teams (DUO)`,
            }
          : { ok: false, msg: 'Digest mismatch' };
      }
    } catch (e) {
      const code =
        (e as { code?: string; errorCode?: string })?.code ??
        (e as { errorCode?: string })?.errorCode;
      if (code === 'GENERATION_EXHAUSTED')
        pickError = 'AI generation exhausted — retry with new seed.';
      else if (code === 'OWNED_VERSION')
        pickError =
          'Rosters claim the same player twice — create a new room and re-draft. Duplicate identities are no longer allowed.';
      else pickError = e instanceof Error ? e.message : String(e);
      const s = await controller.restoreFromLog();
      draftState = s ? ({ ...s } as typeof draftState) : draftState;
    } finally {
      generateBusy = false;
    }
  }

  let modeLabel = $derived.by(() => {
    const raw =
      (snap as unknown as { mode?: string })?.mode ??
      (snap?.settings as unknown as { mode?: string })?.mode ??
      'season';
    if (raw === 'classic') return 'Classic';
    if (raw === 'sandbox') return 'Sandbox';
    return 'Season Run';
  });
  let isMyTurn = $derived(
    (draftState as any)?.currentTurnParticipantId === membership?.participantId,
  );
  let opponentTurn = $derived(
    ((draftState as any)?.currentTurnParticipantId ?? null) !== null &&
      (draftState as any)?.currentTurnParticipantId !== membership?.participantId,
  );
  let picksByParticipant = $derived.by(() => {
    if (!draftState) return { p1: [], p2: [] } as Record<string, unknown[]>;
    return {
      p1: (draftState as any).picks.filter((p: any) => p.participantId === 'p1'),
      p2: (draftState as any).picks.filter((p: any) => p.participantId === 'p2'),
    };
  });
  let totalTarget = $derived(20);
  let progress = $derived(
    draftState
      ? `${String((draftState as any).picks.length)}/${String(totalTarget)} picks · ${String((draftState as any).picks.filter((p: unknown) => (p as { participantId: string }).participantId === membership?.participantId).length)}/10 you`
      : '',
  );
  let myOffer = $derived.by(() => {
    if (!controller || !membership || !draftState) return null;
    const viewer = membership.participantId;
    // No void tick: offer is derived from draftState/command stream, not timer. Removes 1s recomputations that triggered candidateOf scans.
    return controller.currentOfferFor(viewer) as SeasonDraftOffer | null;
  });
  let secondsRemaining = $derived.by(() => {
    void tick;
    if (!controller || !membership || !draftState) return null;
    if (snap?.settings.pace !== 'live') return null;
    if (!isMyTurn) return null;
    return controller.getSecondsRemaining(Date.now());
  });
  let opponentPresence = $derived.by(() => {
    if (!snap || !membership) return null;
    const opp = membership.participantId === 'p1' ? 'p2' : 'p1';
    return snap.presence?.find((p) => p.participantId === opp) ?? null;
  });
  let opponentOnline = $derived(opponentPresence?.online ?? (snap ? snap.memberCount >= 2 : false));
  let isLocked = $derived(
    (draftState as any)?.status === 'complete' || (draftState as any)?.status === 'finalized',
  );
  let canFinalize = $derived(
    (draftState as any)?.picks.length === 20 && (draftState as any)?.status === 'drafting',
  );
  let canGenerate = $derived((draftState as any)?.status === 'finalized');
  let canEnterRun = $derived((draftState as any)?.status === 'complete' && generation !== null);
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
      {#if draftState}<button
          type="button"
          onclick={refreshDraft}
          class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold"
          >Reload picks</button
        >{/if}
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
        No authenticated membership. Refresh restores via server (loadMembership + refresh), not
        localStorage trust. Re-join with 4-digit code.
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
        You are {membership.participantId === 'p1' ? 'Host · P1' : 'Guest · P2'} · {modeLabel} · {snap
          .settings.pace === 'live'
          ? 'Live 90s / 5m'
          : 'Async 24h'}. Host must Start draft in lobby. Authenticated membership restored via
        resume, not localStorage.
      </p>
      <a
        href={`/multiplayer/room/${roomId}`}
        class="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground"
        >Back to lobby →</a
      >
    </div>
  {:else if draftState}
    <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-label tracking-[0.16em] text-primary">
            Multiplayer draft · {roomId.slice(0, 8)}… · {modeLabel}
          </p>
          <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">
            {modeLabel} shared draft
          </h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {membership.participantId === 'p1' ? 'P1 · Host' : 'P2 · Guest'} · {membership.franchiseId}
            · {snap?.settings.pace === 'live' ? 'Live — 90s per pick' : 'Async — 24h per pick'} · {progress}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            Digest {controller?.getDigest()?.slice(0, 12) ?? '—'}… · rev {(draftState as any)
              .revision} · turn
            {(draftState as any).currentTurnParticipantId ?? '—'} · {isLocked
              ? 'locked'
              : isMyTurn
                ? 'your turn'
                : opponentTurn
                  ? 'opponent turn'
                  : '—'}
            {secondsRemaining !== null ? `· ${secondsRemaining}s remaining` : ''}
          </p>
          {#if !opponentOnline}
            <p
              class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700"
            >
              <WifiOff class="h-3 w-3" /> Opponent disconnected — waiting for reconnection · presence
              offline after 30s
            </p>
          {:else}
            <p
              class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-1 text-xs text-positive"
            >
              <Wifi class="h-3 w-3" /> Opponent online · both clients replay log on reconnect
            </p>
          {/if}
          {#if isLocked}
            <p
              class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2.5 py-1 text-xs"
            >
              <Lock class="h-3 w-3" /> Locked — private offers revealed after lock
            </p>
          {/if}
        </div>
        <div class="flex flex-col items-end gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-3 py-1 text-xs font-semibold text-positive"
            ><Users class="h-3 w-3" /> {snap?.memberCount ?? 2}/2 · live</span
          >
          {#if isMyTurn}<span
              class="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground"
              ><Clock class="h-3 w-3" /> Your turn {secondsRemaining !== null
                ? `· ${secondsRemaining}s`
                : ''}</span
            >{:else if opponentTurn}<span
              class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1 text-xs"
              >Opponent’s turn — private offer hidden</span
            >{/if}
          {#if (draftState as any).status === 'complete'}<span
              class="inline-flex items-center gap-1.5 rounded-full bg-positive px-3 py-1 text-xs font-bold text-white"
              ><Check class="h-3 w-3" /> Complete</span
            >{/if}
        </div>
      </div>

      {#if replayError}
        <div
          role="alert"
          class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
        >
          <div class="flex items-center gap-1.5 font-semibold text-destructive">
            <AlertTriangle class="h-3.5 w-3.5" /> Replay integrity issue {integrityFailed
              ? '· integrity-failed'
              : ''}
          </div>
          <p class="mt-1 font-mono break-all text-destructive/90">{replayError}</p>
          <p class="mt-1 text-muted-foreground">
            Log replay skipped invalid commands or failed to apply — check command stream. {controller?.getSkippedCommandCount()
              ? `Skipped ${controller?.getSkippedCommandCount()} invalid`
              : ''}
          </p>
          <button
            type="button"
            onclick={refreshDraft}
            class="mt-2 inline-flex rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold"
            >Reload picks · re-replay log</button
          >
        </div>
      {/if}
      {#if snap?.settings.pace === 'live' && isMyTurn && secondsRemaining !== null}
        <div class="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs">
          <p class="text-amber-700">
            Live turn clock · {secondsRemaining}s remaining. Reloading this tab keeps the same start
            time (session storage).
          </p>
        </div>
      {/if}

      <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
        <p class="font-semibold">
          Season Run: 10 rounds · snake order · 8 cards (≥3 safe) · 4G/4F/3C targets ·
          DUO_BAND_QUOTAS 4/8/9/7
        </p>
        <p class="mt-1 text-muted-foreground">
          Deterministic via room seed + settingsRevision + draft cursor. Offers drawn via
          drawGlobalOffer; picks via applySeasonDraftCommand with idempotent commandId +
          expectedRevision. Neither client uses solo /season flow.
        </p>
        <p class="mt-1 font-mono text-[11px]">
          Size {SEASON_DRAFT_OFFER_SIZE} · Safe min {SEASON_DRAFT_SAFE_MINIMUM} · Seed {(
            snap as unknown as { seed?: string | null }
          )?.seed?.slice(0, 12) ?? '—'}… · cursor {snap?.cursor} · digest {controller
            ?.getDigest()
            ?.slice(0, 16) ?? '—'}…
        </p>
      </div>

      <div class="mt-6 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Your seat</p>
          <p class="mt-1 text-sm font-bold">
            {membership.participantId === 'p1' ? 'P1 · Host' : 'P2 · Guest'}
          </p>
          <p class="mt-1 font-mono text-xs text-muted-foreground">{membership.franchiseId}</p>
          {#if isMyTurn}<p class="mt-1 text-xs font-bold text-primary">
              Your turn — pick {secondsRemaining !== null ? `· ${secondsRemaining}s` : ''}
            </p>{:else}<p class="mt-1 text-xs text-muted-foreground">Wait for opponent</p>{/if}
          {#if secondsRemaining !== null && isMyTurn}<div
              class="mt-2 h-1.5 w-full rounded-full bg-line-soft"
            >
              <div
                class="h-1.5 rounded-full bg-primary"
                style={`width:${(secondsRemaining / 90) * 100}%`}
              ></div>
            </div>{/if}
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Mode & pace (shared fact)</p>
          <p class="mt-1 text-sm font-semibold">{modeLabel} · {snap?.settings.pace}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Seed {(snap as unknown as { seed?: string | null })?.seed?.slice(0, 12) ?? '—'}… · rev {(
              draftState as any
            ).revision}
            · {snap?.settings.pace === 'live' ? '90s per pick' : '24h per pick'}
          </p>
          {#if opponentPresence}<p
              class="mt-1 text-xs {opponentOnline ? 'text-positive' : 'text-amber-600'}"
            >
              {opponentOnline
                ? 'Opponent online'
                : 'Opponent disconnected — timer paused? live still 90s'} · lastSeen {opponentPresence.lastSeenAt.slice(
                11,
                19,
              )}
            </p>{/if}
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">Picks</p>
          <p class="mt-1 text-sm font-bold">{(draftState as any).picks.length}/20 total</p>
          <p class="mt-1 text-xs text-muted-foreground">
            You {(picksByParticipant[membership.participantId] ?? []).length}/10 · Opp {(
              picksByParticipant[membership.participantId === 'p1' ? 'p2' : 'p1'] ?? []
            ).length}/10 · snake R{(draftState as any).round}
          </p>
          {#if (draftState as any).status === 'complete'}<p
              class="mt-1 text-xs font-semibold text-positive"
            >
              Draft complete
            </p>{:else if (draftState as any).status === 'finalized'}<p
              class="mt-1 text-xs font-semibold text-primary"
            >
              Rosters finalized — ready to generate AI league
            </p>{/if}
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-xl bg-surface-1 p-6">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">
          Draft board — {progress}
        </h2>
        <span class="text-xs text-muted-foreground"
          >{(draftState as any).currentTurnParticipantId
            ? `Turn: ${(draftState as any).currentTurnParticipantId} ${isMyTurn ? '(you)' : ''} · ${snap?.settings.pace === 'live' && isMyTurn && secondsRemaining !== null ? `${secondsRemaining}s left` : ''}`
            : 'Complete'}</span
        >
      </div>

      {#if (draftState as any).status === 'complete' && generation}
        <div class="mt-4 rounded-lg border border-positive/30 bg-positive/10 p-4">
          <p class="font-semibold text-positive flex items-center gap-1.5">
            <Trophy class="h-4 w-4" /> Draft complete — league verified
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            Both clients independently derived 28 AI teams (DUO_BAND_QUOTAS) and attested league
            digest. Duplicate ownership rejected. Identical local Season runs ready.
          </p>
          <p class="mt-2 font-mono text-xs break-all">
            Digest {leagueDigest?.slice(0, 32) ?? controller?.getDigest()?.slice(0, 32)}…
          </p>
          {#if verification}<p
              class="mt-1 text-xs {verification.ok ? 'text-positive' : 'text-destructive'}"
            >
              {verification.msg}
            </p>{/if}
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            {#each (draftState as any).picks as pick (pick.playerVersionId)}
              {@const candidate = candidateOf(pick.playerVersionId)}
              <div
                class="flex min-w-0 items-center gap-2 rounded-lg border border-line-soft bg-card p-2 text-xs"
              >
                {#if manifest && faceOf(pick.playerVersionId)}
                  <SeasonPlayerFace face={faceOf(pick.playerVersionId)!} {manifest} size="sm" />
                {/if}
                <div class="min-w-0">
                  <span class="block truncate font-semibold"
                    >{playerLabel(pick.playerVersionId)}</span
                  >
                  <span class="text-muted-foreground"
                    >{pick.participantId} · R{pick.round} P{pick.pickOrdinal}{candidate
                      ? ` · ${formatPositions(candidate.positions.playable)}`
                      : ''}</span
                  >
                </div>
              </div>
            {/each}
          </div>
          <div class="mt-4 flex gap-2">
            <a
              href={`/multiplayer/room/${roomId}/run`}
              class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground"
              ><Trophy class="h-4 w-4" /> Enter Season Run →</a
            >
            <a
              href={`/multiplayer/room/${roomId}`}
              class="rounded-xl border border-line-soft bg-card px-4 py-3 text-sm font-semibold"
              >Back to lobby</a
            >
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            Next: private-lock → simulation → hash-verification skeleton with worker (see run
            shell). No solo /season flow used.
          </p>
        </div>
      {:else if (draftState as any).status === 'finalized'}
        <div class="mt-4 rounded-lg border border-primary/30 bg-primary/10 p-4">
          <p class="font-semibold">Rosters finalized — 10 each, 4G/4F/3C satisfied</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Both participants have full legal rosters. Independently derive 28 AI teams and attest
            league digest. Duplicate version ownership will be rejected.
          </p>
          <button
            type="button"
            onclick={handleGenerate}
            disabled={generateBusy}
            class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >{generateBusy ? 'Generating…' : 'Generate AI league (28 teams) →'}</button
          >
          {#if pickError}<p role="alert" class="mt-2 text-xs text-destructive">{pickError}</p>{/if}
          {#if verification}<p
              class="mt-2 text-xs {verification.ok ? 'text-positive' : 'text-destructive'}"
            >
              {verification.msg}
            </p>{/if}
          {#if leagueDigest}<p class="mt-2 font-mono text-xs break-all">
              Digest {leagueDigest.slice(0, 32)}…
            </p>{/if}
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            {#each (draftState as any).picks as pick (pick.playerVersionId)}
              <div
                class="flex min-w-0 items-center gap-2 rounded-lg border border-line-soft bg-card p-2 text-xs"
              >
                {#if manifest && faceOf(pick.playerVersionId)}
                  <SeasonPlayerFace face={faceOf(pick.playerVersionId)!} {manifest} size="sm" />
                {/if}
                <div class="min-w-0">
                  <span class="block truncate font-semibold"
                    >{playerLabel(pick.playerVersionId)}</span
                  >
                  <span class="text-muted-foreground">{pick.participantId}</span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if canFinalize}
        <div class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p class="font-semibold">20 picks complete — finalize rosters</p>
          <p class="mt-1 text-xs text-muted-foreground">
            10 per participant, snake order verified. Finalize checks 4G/4F/3C and
            legalFiveAfterAnyRemoval.
          </p>
          <button
            type="button"
            onclick={handleFinalize}
            disabled={finalizeBusy}
            class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >{finalizeBusy ? 'Finalizing…' : 'Finalize rosters →'}</button
          >
          {#if pickError}<p role="alert" class="mt-2 text-xs text-destructive">{pickError}</p>{/if}
        </div>
      {:else if (draftState as any).status === 'drafting' && myOffer}
        <div class="mt-4">
          <p class="text-xs text-muted-foreground">
            Offer for {myOffer.participantId} · Round {myOffer.round} · Pick {myOffer.pickOrdinal} — {SEASON_DRAFT_OFFER_SIZE}
            cards, ≥{SEASON_DRAFT_SAFE_MINIMUM} safe (private until pick). {snap?.settings.pace ===
            'live'
              ? `· ${secondsRemaining ?? 90}s remaining`
              : '· Async 24h'}
          </p>
          {#if secondsRemaining !== null && secondsRemaining <= 15}<p
              class="mt-1 text-xs font-bold text-amber-600"
            >
              ⚠ {secondsRemaining}s left — auto-picks first safe on expiry
            </p>{/if}
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {#each myOffer.cards as card (card.playerVersionId)}
              {@const candidate = candidateOf(card.playerVersionId)}
              {@const identity =
                candidate && manifest
                  ? eraIdentityOf(manifest, candidate.franchiseId, candidate.eraId)
                  : { displayLabel: null, logoCandidates: [] }}
              <button
                type="button"
                onclick={() => handlePick(card.playerVersionId)}
                disabled={picking || drawing || !card.selectable}
                class="flex min-w-0 flex-col gap-2 rounded-xl border p-3 text-left transition {card.selectable
                  ? 'border-primary hover:bg-primary/10 bg-card'
                  : 'border-line-soft bg-card/50 opacity-60'} disabled:cursor-not-allowed"
              >
                <div class="flex min-w-0 items-start justify-between gap-2">
                  {#if manifest && faceOf(card.playerVersionId)}
                    <SeasonPlayerFace
                      face={faceOf(card.playerVersionId)!}
                      {manifest}
                      size="md"
                      eager={card.selectable}
                    />
                  {/if}
                  {#if manifest && candidate}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={candidate.franchiseId}
                      teamExternalId={manifest.modernFranchiseSlots.find(
                        (s) => s.franchiseId === candidate.franchiseId,
                      )?.teamExternalId ?? ''}
                      logoCandidates={identity.logoCandidates}
                      alt={identity.displayLabel ?? ''}
                      size="sm"
                    />
                  {/if}
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-bold">
                    {candidate?.displayName ?? card.playerVersionId}
                  </p>
                  {#if candidate}
                    <p class="truncate font-mono text-[10px] text-muted-foreground">
                      {candidate.seasonKey} · {formatPositions(candidate.positions.playable)}
                    </p>
                    <p class="truncate font-mono text-[10px] text-muted-foreground">
                      {identity.displayLabel ?? franchiseLabel(candidate.franchiseId)} · {eraLabel(
                        candidate.eraId,
                      )}
                    </p>
                  {/if}
                </div>
                <span class="text-xs {card.selectable ? 'text-positive' : 'text-destructive'}"
                  >{card.selectable
                    ? 'Safe — selectable'
                    : (card.coverageReason ?? 'Not selectable')}</span
                >
                <span
                  class="text-xs font-semibold {card.selectable
                    ? 'text-primary'
                    : 'text-muted-foreground'}"
                  >{picking ? 'Picking…' : card.selectable ? 'Pick →' : 'Locked'}</span
                >
              </button>
            {/each}
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            Private offer: opponent cannot see these 8 cards until you lock. Reconnect replays via
            refetch.
          </p>
          {#if pickError}<p role="alert" class="mt-3 text-xs text-destructive">{pickError}</p>{/if}
        </div>
      {:else if (draftState as any).status === 'drafting' && isMyTurn && !myOffer}
        <div class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p class="text-sm font-semibold">Your turn — drawing 8-card offer…</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Deterministic via drawGlobalOffer (seasonNamespaceSeed + createRng). ≥3 safe required.
          </p>
          <button
            type="button"
            onclick={handleDraw}
            disabled={drawing}
            class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >{drawing ? 'Drawing…' : 'Draw offer →'}</button
          >
          {#if pickError}<p role="alert" class="mt-2 text-xs text-destructive">{pickError}</p>{/if}
        </div>
      {:else if (draftState as any).status === 'drafting' && opponentTurn}
        <div class="mt-4 rounded-xl border border-line-soft bg-card p-6 text-center">
          <p class="text-label text-muted-foreground">Opponent’s turn — private offer hidden</p>
          <p class="mt-1 font-mono text-xs">
            Waiting for {(draftState as any).currentTurnParticipantId} · Round {(draftState as any)
              .round} · {draftState.picks.length}/20 picks · you see
            waiting/locked/opponent-disconnected clearly
          </p>
          {#if myOffer === null}<p class="mt-1 text-xs text-muted-foreground">
              You cannot see opponent’s 8 cards until they lock. This preserves private offers until
              lock.
            </p>{/if}
          {#if !opponentOnline}<p class="mt-2 text-xs font-semibold text-amber-700">
              <WifiOff class="h-3 w-3 inline" /> Opponent disconnected — presence offline
            </p>{/if}
          <div
            class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-line-soft px-3 py-1.5 text-xs"
          >
            <Loader2 class="h-3 w-3 animate-spin" /> Waiting for authoritative pick via command stream…
          </div>
          {#if (draftState as any).currentOffer}<p
              class="mt-2 font-mono text-xs text-muted-foreground"
            >
              Current turn holds a private 8-card offer (hidden from you)
            </p>{/if}
        </div>
      {:else}
        <p class="mt-4 text-xs text-muted-foreground">
          No offer — waiting for turn. Snake order: R{(draftState as any).round} · {(
            draftState as any
          ).currentTurnParticipantId ?? 'complete'}
        </p>
      {/if}

      <div class="mt-6">
        <h3 class="text-label tracking-[0.12em] text-muted-foreground">
          Accepted picks ({(draftState as any).picks.length}/20) — preserved through refresh · snake
          reversal each round
        </h3>
        {#if (draftState as any).picks.length === 0}
          <p class="mt-2 text-xs text-muted-foreground">
            No picks yet — draw will produce 8 cards, ≥3 safe.
          </p>
        {:else}
          <div class="mt-3 space-y-2">
            {#each (draftState as any).picks as pick, i (pick.playerVersionId + String(i))}
              <div
                class="flex items-center justify-between rounded-lg border border-line-soft bg-card p-2"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span
                    class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                    >{i + 1}</span
                  >
                  {#if manifest && faceOf(pick.playerVersionId)}
                    <SeasonPlayerFace face={faceOf(pick.playerVersionId)!} {manifest} size="sm" />
                  {/if}
                  <div class="min-w-0">
                    <span class="block truncate text-sm font-bold"
                      >{playerLabel(pick.playerVersionId)}</span
                    >
                    <span class="text-xs text-muted-foreground"
                      >{pick.participantId} · R{pick.round} P{pick.pickOrdinal}</span
                    >
                  </div>
                </div>
                <span
                  class="inline-flex shrink-0 items-center gap-1 text-xs {pick.participantId ===
                  membership.participantId
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground'}"
                  >{pick.participantId === membership.participantId ? 'You' : 'Opponent'}
                  {pick.participantId === membership.participantId ? '✓' : ''}</span
                >
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mt-6 flex flex-wrap gap-2">
        <a
          href={`/multiplayer/room/${roomId}`}
          class="rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
          >Back to lobby</a
        >
        {#if canEnterRun}
          <a
            href={`/multiplayer/room/${roomId}/run`}
            class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >Go to run →</a
          >
        {:else}
          <span
            aria-disabled="true"
            class="cursor-not-allowed rounded-lg border border-line-soft bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground"
            >Run unlocks after draft verification</span
          >
        {/if}
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-2 text-xs"
          ><Clock class="h-3 w-3" />
          {snap?.settings.pace === 'live' ? 'Live 90s' : 'Async 24h'} · timer {secondsRemaining ??
            '—'}s</span
        >
      </div>
    </div>

    <div
      class="mt-6 rounded-xl border border-line-soft bg-card p-4 text-xs leading-relaxed text-muted-foreground"
    >
      <p class="font-semibold text-foreground">Authoritative facts — replayable</p>
      <p class="mt-1">
        Room {roomId.slice(0, 8)}… · Mode {modeLabel} · Seed {(
          snap as unknown as { seed?: string | null }
        )?.seed?.slice(0, 16) ?? '—'}… · Rev {(draftState as any).revision} · Cursor {snap?.cursor} ·
        Turn {(draftState as any).currentTurnParticipantId ?? 'complete'} — same via deterministic seed
        + command stream.
      </p>
      <p class="mt-1">
        Uses real engine: applySeasonDraftCommand, drawGlobalOffer, seasonDraftStateDigest,
        seasonDigestHex, createRng/seasonNamespaceSeed. Enforces WRONG_TURN, OWNED_VERSION,
        UNCOMPLETABLE_ROSTER, idempotent commandId, expectedRevision via last ordinal. No solo
        /season flow.
      </p>
      <p class="mt-1">
        After both rosters finalize, independently derive 28 AI teams (DUO_BAND_QUOTAS), attest
        league digest, reject duplicate ownership, create identical local Season runs → /run shows
        both participants.
      </p>
    </div>
  {:else}
    <div class="rounded-xl bg-surface-1 p-6">
      <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">
        Room phase: {snap?.phase}
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        Phase {snap?.phase} — this draft view is for the multiplayer room. Return to lobby.
      </p>
      <a
        href={`/multiplayer/room/${roomId}`}
        class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >Back to lobby →</a
      >
    </div>
  {/if}
</section>
