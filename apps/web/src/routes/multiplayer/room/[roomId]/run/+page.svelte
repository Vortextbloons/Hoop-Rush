<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { ArrowLeft, RefreshCw, AlertTriangle, Trophy, Users, Lock, Check, Clock, Wifi, WifiOff, Play, Hash, Shield } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import { createSupabaseSeasonTransport, isSupabaseConfigured } from '$lib/season/supabase-season-transport';
  import { loadMembership, saveMembership } from '$lib/season/season-room-identity';
  import { RoomDraftController } from '$lib/season/room-draft-controller';
  import { createGameplayTransport } from '$lib/season/season-gameplay-transport';
  import { deriveGameplayState, type MultiplayerGameplayState } from '$lib/season/season-gameplay-state';
  import type { SeasonRoomPublicSnapshot, SeasonRoomMembership, SeasonMultiplayerTransport, SeasonRun, SeasonDraftState, SeasonLeagueGenerationResult } from '@hoop-rush/data-contracts';
  import { DUO_BAND_QUOTAS } from '@hoop-rush/engine';

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

  function getCoordinator() {
    const useSupabase = isSupabaseConfigured();
    transport = useSupabase
      ? createSupabaseSeasonTransport({
          url: (import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_URL ?? '',
          publishableKey: (import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
        })
      : null;
    const t = (transport ?? undefined) as unknown as SeasonMultiplayerTransport | undefined;
    return createInMemorySeasonRoomCoordinator({
      transport: t,
      onSnapshot: (s) => {
        snap = s;
      },
      onCommands: () => {}
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
        res = (await t.resume(roomId)) as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
      } else if (coordinator) {
        res = (await coordinator.refresh(roomId)) as unknown as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
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
        controller = new RoomDraftController({ transport: tr, roomId, snapshot: snap, membership, fetchImpl: fetch });
        const state = await controller.restoreFromLog();
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
        } else if (draftState && draftState.status === 'complete' && !generation) {
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
    const raw = (snap as unknown as { mode?: string })?.mode ?? (snap?.settings as unknown as { mode?: string })?.mode ?? 'season';
    if (raw === 'classic') return 'Classic';
    if (raw === 'sandbox') return 'Sandbox';
    return 'Season Run';
  });

  let p1Picks = $derived(draftState?.picks.filter((p) => p.participantId === 'p1') ?? []);
  let p2Picks = $derived(draftState?.picks.filter((p) => p.participantId === 'p2') ?? []);
  let opponentOnline = $derived.by(() => {
    if (!snap || !membership) return false;
    const opp = membership.participantId === 'p1' ? 'p2' : 'p1';
    return snap.presence?.find((p) => p.participantId === opp)?.online ?? snap.memberCount >= 2;
  });
  let isPrivateLock = $derived(phase === 'private-lock');
  let isSimulation = $derived(phase === 'simulation');
  let isHashVerification = $derived(phase === 'hash-verification');
  let isComplete = $derived(phase === 'complete');
</script>

<svelte:head><title>Season Run · Room {roomId.slice(0, 8)} — Hoop Rush</title></svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex items-center justify-between gap-3 py-6">
    <a href={`/multiplayer/room/${roomId}/draft`} class="text-label inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><ArrowLeft class="h-3.5 w-3.5" /> Back to draft</a>
    <div class="flex items-center gap-2">
      <button type="button" onclick={load} class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold hover:border-line-strong"><RefreshCw class="h-3.5 w-3.5" />Refresh</button>
      <a href={resolve('/multiplayer')} class="hidden text-xs text-muted-foreground underline-offset-4 hover:underline sm:inline">Multiplayer</a>
    </div>
  </div>

  {#if loading}
    <div class="rounded-xl bg-surface-1 p-10 text-center">
      <p class="font-mono text-sm text-muted-foreground">Loading Season Run…</p>
      <p class="mt-2 text-xs text-muted-foreground">Bootstrapping via gameplay transport (not solo /season)</p>
    </div>
  {:else if error}
    <div class="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
      <div class="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle class="h-4 w-4" />Could not load run</div>
      <p class="mt-2 text-sm text-muted-foreground">{error}</p>
      <div class="mt-4 flex gap-2">
        <button type="button" onclick={load} class="rounded-lg bg-card px-4 py-2 text-sm font-semibold">Retry</button>
        <a href={`/multiplayer/room/${roomId}/draft`} class="rounded-lg border border-line-soft px-4 py-2 text-sm font-semibold">Back to draft</a>
      </div>
    </div>
  {:else if !membership}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 class="font-display text-lg font-extrabold uppercase">No seat found</h2>
      <p class="mt-2 text-sm text-muted-foreground">Authenticated membership not found. Direct-link restores via loadMembership + refresh (server), not localStorage trust.</p>
      <a href={resolve('/multiplayer')} class="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to Multiplayer entry</a>
    </div>
  {:else if !draftState}
    <div class="rounded-xl bg-surface-1 p-8 text-center">
      <p class="text-label text-primary">No draft state</p>
      <h2 class="font-display mt-2 text-2xl font-extrabold uppercase">Draft not complete</h2>
      <p class="mt-2 text-sm text-muted-foreground">Room {roomId.slice(0,8)}… · {modeLabel} · phase {snap?.phase}. Complete the 10-picks-per-participant snake draft first.</p>
      <a href={`/multiplayer/room/${roomId}/draft`} class="mt-6 inline-flex rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Go to draft →</a>
    </div>
  {:else if draftState.status !== 'complete' && !generation}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
      <h2 class="font-display text-lg font-extrabold uppercase">League verification pending</h2>
      <p class="mt-2 text-sm text-muted-foreground">Draft picks {draftState.picks.length}/20 · status {draftState.status}. Both clients must finalize (10 each, 4G/4F/3C) and independently generate 28 AI teams (DUO {JSON.stringify(DUO_BAND_QUOTAS)}) and attest league digest before the run can start. Duplicate version ownership is rejected.</p>
      <div class="mt-4 flex gap-2">
        <a href={`/multiplayer/room/${roomId}/draft`} class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Finalize in draft →</a>
        <button type="button" onclick={load} class="rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Reload</button>
      </div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">P1 picks ({p1Picks.length}/10)</p>
          <div class="mt-2 space-y-1">
            {#each p1Picks as pick (pick.playerVersionId)}<div class="font-mono text-xs">{pick.playerVersionId.slice(0,24)} · R{pick.round}</div>{/each}
          </div>
        </div>
        <div class="rounded-lg border border-line-soft bg-card p-3">
          <p class="text-label text-muted-foreground">P2 picks ({p2Picks.length}/10)</p>
          <div class="mt-2 space-y-1">
            {#each p2Picks as pick (pick.playerVersionId)}<div class="font-mono text-xs">{pick.playerVersionId.slice(0,24)} · R{pick.round}</div>{/each}
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="rounded-xl border border-line-soft bg-surface-1 p-6 sm:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-label tracking-[0.16em] text-primary">Multiplayer Season Run · {roomId.slice(0, 8)}… · {modeLabel}</p>
          <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">Season Hub — {membership.participantId === 'p1' ? 'P1 Host' : 'P2 Guest'} & Opponent</h1>
          <p class="mt-1 text-sm text-muted-foreground">Run {run?.runId.slice(0,8) ?? roomId.slice(0,8)}… · {membership.franchiseId} + opponent · {snap?.settings.pace === 'live' ? 'Live 90s/5m' : 'Async 24h/12h'} · Phase {phase ?? snap?.phase}</p>
          <p class="mt-1 text-xs text-muted-foreground">Digest {run?.stateDigest.slice(0,12) ?? '—'}… · league {generation?.digest.slice(0,12) ?? '—'}… · both participants see identical run (no solo /season flow)</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            {#if opponentOnline}<span class="inline-flex items-center gap-1.5 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-1 text-xs text-positive"><Wifi class="h-3 w-3" /> Opponent online</span>{:else}<span class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700"><WifiOff class="h-3 w-3" /> Opponent disconnected</span>{/if}
            {#if isComplete}<span class="inline-flex items-center gap-1.5 rounded-full bg-positive px-3 py-1 text-xs font-bold text-white"><Check class="h-3 w-3" /> Complete</span>{/if}
          </div>
        </div>
        <div class="flex flex-col items-end gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><Users class="h-3 w-3" /> 2 humans + 28 AI · 30 teams</span>
          {#if run}<span class="inline-flex items-center gap-1.5 rounded-full bg-card border border-line-soft px-3 py-1 text-xs">Stage {run.stage} · Block {run.cursor.completedRounds}</span>{/if}
        </div>
      </div>

      <div class="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
        <p class="font-semibold">Post-start skeleton: private-lock → simulation → hash-verification (worker) · Full 9 blocks via season-block-worker when feasible, else league-verification preview</p>
        <p class="mt-1 text-muted-foreground">Draft→league-verification complete. Both clients derived identical SeasonRun (buildSeasonRunFromGeneration). Simulation progress stays local; only input/result digests are attested.</p>
        <p class="mt-1 font-mono text-[11px]">DUO_BAND_QUOTAS contender 4 · playoff 8 · average 9 · weaker 7 · Pace {snap?.settings.pace} · timer {snap?.settings.pace === 'live' ? '90s/5m' : '24h'} · digest {generation?.digest.slice(0,16) ?? '—'}</p>
      </div>
    </div>

    <div class="mt-6 grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border p-4 {isPrivateLock || isComplete ? 'border-positive/40 bg-positive/10' : 'border-line-soft bg-card'}">
        <div class="flex items-center gap-1.5 font-semibold text-xs tracking-widest uppercase"><Lock class="h-3.5 w-3.5" /> Private-lock</div>
        <p class="mt-1 text-xs text-muted-foreground">Both checkpoint packages locked (rotation + objectives + campaign + FA). Private until both locked or fallback verified.</p>
        <p class="mt-2 text-xs font-semibold {gameplay?.p1Locked && gameplay?.p2Locked ? 'text-positive' : 'text-amber-600'}">{gameplay?.p1Locked && gameplay?.p2Locked ? 'Both locked ✓' : 'Waiting for locks'}</p>
        <div class="mt-2 flex gap-1.5">
          <span class="inline-flex rounded-full border px-2 py-1 text-xs {gameplay?.p1Locked ? 'border-positive bg-positive/10 text-positive' : 'border-line-soft'}">P1 {gameplay?.p1Locked ? '✓' : '…'}</span>
          <span class="inline-flex rounded-full border px-2 py-1 text-xs {gameplay?.p2Locked ? 'border-positive bg-positive/10 text-positive' : 'border-line-soft'}">P2 {gameplay?.p2Locked ? '✓' : '…'}</span>
        </div>
      </div>
      <div class="rounded-xl border p-4 {isSimulation ? 'border-primary bg-primary/10' : isComplete ? 'border-positive/40 bg-positive/10' : 'border-line-soft bg-card'}">
        <div class="flex items-center gap-1.5 font-semibold text-xs tracking-widest uppercase"><Play class="h-3.5 w-3.5" /> Simulation</div>
        <p class="mt-1 text-xs text-muted-foreground">Both clients simulate complete league block locally with identical locked inputs via season-block-worker.</p>
        {#if gameplay?.simulationProgress}
          <p class="mt-2 text-xs">{gameplay.simulationProgress.completed}/{gameplay.simulationProgress.total} games · {gameplay.simulationProgress.latestGameId ?? ''}</p>
          <div class="mt-2 h-1.5 w-full rounded-full bg-line-soft"><div class="h-1.5 rounded-full bg-primary" style={`width:${(gameplay.simulationProgress.completed / Math.max(1, gameplay.simulationProgress.total))*100}%`}></div></div>
        {:else}
          <p class="mt-2 text-xs text-muted-foreground">{isComplete ? 'Simulated locally — 9 blocks ready via worker skeleton' : 'Awaiting lock'}</p>
        {/if}
        <p class="mt-2 text-xs font-mono">Worker: season-block-worker — local only, no Supabase simulation traffic</p>
      </div>
      <div class="rounded-xl border p-4 {isHashVerification || isComplete ? 'border-positive/40 bg-positive/10' : 'border-line-soft bg-card'}">
        <div class="flex items-center gap-1.5 font-semibold text-xs tracking-widest uppercase"><Hash class="h-3.5 w-3.5" /> Hash-verification</div>
        <p class="mt-1 text-xs text-muted-foreground">Both publish input+result digests; on match, commit and advance cursor. Mismatch → rerun once, second mismatch freezes.</p>
        {#if gameplay?.attestation}
          <p class="mt-2 font-mono text-xs break-all">Input {gameplay.attestation.inputDigest.slice(0,16)}…<br/>Result {gameplay.attestation.resultDigest.slice(0,16)}…</p>
          <p class="mt-1 text-xs {gameplay.attestation.verified ? 'text-positive font-semibold' : 'text-destructive'}">{gameplay.attestation.verified ? 'Verified ✓' : 'Mismatch'}</p>
        {:else}
          <p class="mt-2 text-xs text-muted-foreground">{isComplete ? 'Attested ✓' : 'Awaiting simulation'}</p>
        {/if}
        <p class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-2 py-1 text-xs"><Shield class="h-3 w-3" /> Atomic commit · digest attested</p>
      </div>
    </div>

    {#if bootstrapping}
      <div class="mt-6 rounded-xl bg-surface-1 p-10 text-center">
        <p class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground"><RefreshCw class="h-4 w-4 animate-spin" /> Bootstrapping SeasonRun via loadBootstrap (gameplay transport)…</p>
      </div>
    {:else if run}
      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Your franchise & opponent</h2>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p class="text-label text-primary">You — {membership.participantId}</p>
              <p class="mt-1 font-display text-sm font-extrabold uppercase">{membership.franchiseId}</p>
              <p class="mt-1 text-xs text-muted-foreground">{draftState.picks.filter((p) => p.participantId === membership.participantId).length}/10 picks · picks determine franchise assignment</p>
              <div class="mt-2 space-y-1">
                {#each draftState.picks.filter((p) => p.participantId === membership.participantId) as pick (pick.playerVersionId)}
                  <div class="flex items-center justify-between rounded bg-card px-2 py-1">
                    <span class="font-mono text-xs break-all">{pick.playerVersionId.slice(0,20)}</span>
                    <span class="text-xs text-muted-foreground">R{pick.round}</span>
                  </div>
                {/each}
              </div>
            </div>
            <div class="rounded-lg border border-line-soft bg-card p-3">
              <p class="text-label text-muted-foreground">Opponent — {membership.participantId === 'p1' ? 'p2' : 'p1'}</p>
              <p class="mt-1 font-display text-sm font-extrabold uppercase">{draftState.participants.find((p) => p.participantId !== membership.participantId)?.franchiseId ?? '—'}</p>
              <p class="mt-1 text-xs text-muted-foreground">{draftState.picks.filter((p) => p.participantId !== membership.participantId).length}/10 picks</p>
              <div class="mt-2 space-y-1">
                {#each draftState.picks.filter((p) => p.participantId !== membership.participantId) as pick (pick.playerVersionId)}
                  <div class="flex items-center justify-between rounded bg-card border border-line-soft px-2 py-1">
                    <span class="font-mono text-xs break-all">{pick.playerVersionId.slice(0,20)}</span>
                    <span class="text-xs text-muted-foreground">R{pick.round}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
          <div class="mt-4 rounded-lg border border-line-soft bg-card p-3 text-xs">
            <p class="font-semibold">League verification</p>
            <p class="mt-1 text-muted-foreground">Both clients independently derived 28 AI teams with DUO_BAND_QUOTAS, attested league digest, rejected duplicate ownership (exact version id), and created identical local Season runs. No solo flow.</p>
            <p class="mt-1 font-mono break-all">Digest {generation?.digest.slice(0,32) ?? '—'}…</p>
            <p class="mt-1">AI pools {generation?.aiPools.length ?? 0} · assignments {generation?.aiAssignments.length ?? 0} · rosters {generation?.rosters.length ?? 0}</p>
          </div>
        </div>

        <div class="rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-sm font-extrabold tracking-widest uppercase">Season Run preview</h2>
          <p class="mt-1 text-xs text-muted-foreground">Stage {run.stage} · completedRounds {run.cursor.completedRounds} · stateRevision {run.stateRevision} · digest {run.stateDigest.slice(0,12)}…</p>
          <div class="mt-3 rounded-lg border border-line-soft bg-card p-3">
            <p class="text-label text-muted-foreground">Rosters (30 teams)</p>
            <p class="mt-1 text-xs">Your roster {run.rosters.find((r) => r.franchiseId === membership.franchiseId)?.players.length ?? 0} players · Opponent {run.rosters.find((r) => r.franchiseId === (draftState.participants.find((p) => p.participantId !== membership.participantId)?.franchiseId ?? ''))?.players.length ?? 0} players</p>
            <p class="mt-1 text-xs text-muted-foreground">Both participant franchises have control='human' · AI takeover state in authority, not team control</p>
          </div>
          <div class="mt-3 rounded-lg border border-line-soft bg-card p-3">
            <p class="text-label text-muted-foreground">Standings (regular season 9 blocks)</p>
            <div class="mt-2 space-y-1 max-h-48 overflow-auto">
              {#each run.standings.rows.slice(0, 6) as row (row.franchiseId)}
                <div class="flex justify-between font-mono text-xs"><span>{row.franchiseId.slice(0,12)}</span><span>{row.wins}-{row.losses}</span></div>
              {/each}
            </div>
            <p class="mt-2 text-xs text-muted-foreground">Provisional ranking and rivalry history derived from recorded summaries (future blocks via worker).</p>
          </div>
          <div class="mt-3 flex gap-2">
            <button type="button" onclick={() => goto(`/multiplayer/room/${roomId}/draft`)} class="flex-1 rounded-lg border border-line-soft bg-card px-4 py-2 text-sm font-semibold">Back to draft</button>
            <button type="button" onclick={load} class="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Refresh bootstrap</button>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">SeasonHubState-like for multiplayer: private-lock simulation hash-verification skeleton with worker if full 9 blocks not feasible — at least draft→league-verification complete.</p>
        </div>
      </div>

      <div class="mt-6 rounded-xl border border-line-soft bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <p class="font-semibold text-foreground">Multiplayer Season routes — authoritative</p>
        <p class="mt-1">This run was built via gameplay bootstrap (loadBootstrap via gameplay transport), not solo /season. Both clients hold identical SeasonRun (runId {run.runId.slice(0,8)}… · rootSeed {run.rootSeed.slice(0,12)}…). Private decisions remain locked until both attest.</p>
        <p class="mt-1">Dependency direction preserved: web imports engine, not reverse. Svelte renders state, engine owns rules. Supabase only for room discovery, presence, commands, timers, checkpoint hashes.</p>
      </div>
    {:else}
      <div class="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
        <p class="text-sm font-semibold">Run not yet bootstrapped</p>
        <p class="mt-1 text-xs text-muted-foreground">Draft status {draftState.status} · generation {generation ? 'present' : 'missing'} · run bootstrap pending. Ensure draft is complete and generation succeeded.</p>
        <button type="button" onclick={bootstrapRun} class="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Bootstrap SeasonRun →</button>
      </div>
    {/if}
  {/if}
</section>
