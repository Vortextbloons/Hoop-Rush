<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import {
    BarChart3,
    CalendarDays,
    ClipboardList,
    Gavel,
    LayoutGrid,
    LogOut,
    RefreshCw,
    Trophy,
    X,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import {
    franchiseAbbreviation,
    humanTeamOf,
    type PlayersIndexEntry,
    type Position,
  } from '@hoop-rush/data-contracts';
  import { ordinal, provisionalRanking, recordLabel } from '$lib/season/season-presentation';
  import { loadSeasonLeague, loadSeasonSchedule } from '$lib/season/season-assets';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import { getSeasonBlockRunner, getSeasonRunRepository } from '$lib/season/season-repo';
  import { SeasonHubState } from '$lib/season/season-hub-state';
  import { SeasonRunShell } from '$lib/season/season-shell-state.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { buildVersionFaceIndex, versionTupleOfRosterEntry } from '$lib/season/season-branding';
  import { catalogCandidateMap } from '$lib/season/season-catalog-index';
  import {
    createRotationEditor,
    rotationEditorNeedsPositionRefresh,
  } from '$lib/season/season-rotation-editor';
  import {
    hasPostseasonHubMethods,
    idlePostseasonProgress,
    POSTSEASON_ORCHESTRATION_UNAVAILABLE,
  } from '$lib/season/season-postseason-presentation';
  import { isNavItemActive, type NavItem } from '$lib/nav-items';
  import {
    playablePositionsOfSlice,
    playerSliceOf,
    type SeasonRunPlayerSlice,
  } from '$lib/season/season-player-slice';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import SeasonMasthead from '$lib/components/season/SeasonMasthead.svelte';
  import type { RotationEditor } from '$lib/season/season-rotation-editor';
  import type { SeasonRunPlayerSliceEntry } from '@hoop-rush/persistence';

  let { children } = $props();

  /**
   * Season Run shell (M2.3.5, performance pass): owns the shared
   * `SeasonHubState` for the lifetime of the active run. The layout instance
   * survives tab navigation, so an in-flight block worker continues across
   * tabs; it is torn down only when the user leaves the run group.
   *
   * Performance pass: the shell becomes interactive with the MINIMAL run
   * shell only (manifest, league, schedule, active index/checkpoint, and the
   * compact per-run player slice). The ~17 MB draft catalog, the global
   * players index (faces), and the worker prewarm are deferred to an idle
   * callback after first paint, so nothing eager parses big JSON on the
   * critical path. Large immutable payloads live in `$state.raw` fields
   * (never deep-proxied); only session-changing fields stay reactive.
   */

  const seasonNavItems: NavItem[] = [
    { id: 'hub', label: 'Hub', href: '/season/run', icon: LayoutGrid },
    { id: 'team', label: 'Rotation', href: '/season/run/team', icon: ClipboardList },
    { id: 'schedule', label: 'Schedule', href: '/season/run/schedule', icon: CalendarDays },
    { id: 'league', label: 'League', href: '/season/run/league', icon: Trophy },
    { id: 'leaders', label: 'Leaders', href: '/season/run/leaders', icon: BarChart3 },
  ];

  /** The Free Agency tab appears once a market window has opened (windows
   * stay reachable after resolution so signings and traces stay readable).
   * The bracket tab appears once the postseason begins. */
  const freeAgencyNavItem: NavItem = {
    id: 'free-agency',
    label: 'Free Agency',
    href: '/season/run/free-agency',
    icon: Gavel,
  };

  /** The bracket tab appears once the postseason begins (Play-In
   * through the champion); the shell keeps the other tabs intact. */
  const navItems = $derived.by(() => {
    const stage = shell.run?.stage ?? null;
    const freeAgencyVisible = (shell.run?.freeAgency.windows.length ?? 0) > 0;
    const base = freeAgencyVisible ? [...seasonNavItems, freeAgencyNavItem] : seasonNavItems;
    return stage === 'play-in' || stage === 'playoffs' || stage === 'completed'
      ? [
          ...base,
          { id: 'postseason', label: 'Postseason', href: '/season/run/postseason', icon: Trophy },
        ]
      : base;
  });

  const shell = new SeasonRunShell();
  setContext(SEASON_RUN_SHELL_CONTEXT, shell);

  const routeId = $derived(page.route.id);

  /** Global players index (faces). Loaded lazily after first paint. */
  let playersIndex: PlayersIndexEntry[] | null = null;

  /** Identity key of the face index: run id + every roster's version list.
   * Rosters never change during a block run, so the full-index rebuild only
   * fires on an actual roster change (draft promotion or a trade). */
  let faceIndexKey = '';
  let rostersRef: unknown = null;
  let faceRunId = '';
  let catalogRef: SeasonRunShellData['catalog'] = null;

  function cloneTradeState(trade: NonNullable<SeasonRunShellData['trade']>) {
    return {
      ...trade,
      windows: trade.windows.map((window) => ({
        ...window,
        offers: window.offers.map((offer) => ({ ...offer })),
      })),
    };
  }

  function recomputeRunFacts(): void {
    const snapshot = shell.snapshot;
    const run = snapshot?.run ?? null;
    shell.run = run;
    const humanTeam = run === null ? null : humanTeamOf(run.league);
    shell.humanTeam = humanTeam;
    shell.humanFranchiseId = humanTeam?.franchiseId ?? null;
    shell.nextBlockIndex = snapshot === null ? null : snapshot.acceptedBlocks.length;
    shell.seasonComplete = (shell.nextBlockIndex ?? 0) >= 9;
    shell.health = run?.health ?? null;
    shell.influence = run?.influence ?? null;
    shell.trade =
      run?.trade !== null && run?.trade !== undefined ? cloneTradeState(run.trade) : null;
    shell.freeAgency = run?.freeAgency ?? null;
    shell.objectives = run?.objectives ?? null;

    if (run !== null) {
      rebuildFacesIfNeeded(run);
      const rebuilt = rebuildRotationEditor(run);
      shell.editor = rebuilt.editor;
      shell.editorKey = rebuilt.key;
    } else {
      shell.facesByVersion = new Map();
      faceIndexKey = '';
      shell.editor = null;
      shell.editorKey = null;
    }
  }

  /** Rebuilds the players-index face join when the index has loaded (lazy,
   * post-first-paint) and the run rosters or packaged catalog change. */
  function rebuildFacesIfNeeded(run: NonNullable<SeasonRunShellData['run']>): void {
    if (playersIndex === null) return;
    const catalog = shell.catalog;
    if (run.runId === faceRunId && run.rosters === rostersRef && catalog === catalogRef) {
      return;
    }
    faceRunId = run.runId;
    rostersRef = run.rosters;
    catalogRef = catalog;
    const key = `${run.runId}:${run.rosters
      .map(
        (roster) =>
          `${roster.franchiseId}:${roster.players.map((p) => p.playerVersionId).join(',')}`,
      )
      .join('|')}:${catalog === null ? 'no-catalog' : 'catalog'}`;
    if (key === faceIndexKey) return;
    const candidates = catalog === null ? null : catalogCandidateMap(catalog);
    const tuples = run.rosters.flatMap((roster) =>
      roster.players.map((entry) =>
        versionTupleOfRosterEntry(entry, candidates?.get(entry.playerVersionId) ?? null),
      ),
    );
    shell.facesByVersion = buildVersionFaceIndex(playersIndex, tuples);
    faceIndexKey = key;
  }

  /** Keeps the current editor (and its pending edits) across tab switches;
   * rebuilds only when the locked rotation changes after an accepted block.
   * Playable positions come from the compact player slice, never the full
   * catalog. */
  function rebuildRotationEditor(run: NonNullable<SeasonRunShellData['run']>): {
    editor: RotationEditor | null;
    key: string | null;
  } {
    const franchiseId = shell.humanFranchiseId;
    if (franchiseId === null) return { editor: null, key: null };
    const rotation = run.rotations.find((r) => r.franchiseId === franchiseId);
    const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
    if (rotation === undefined || roster === undefined) return { editor: null, key: null };
    const key = `${run.runId}:${rotation.starters.join(',')}:${rotation.closingFive.join(',')}`;
    const rosterIds = roster.players.map((entry) => entry.playerVersionId);
    if (
      shell.editorKey === key &&
      shell.editor !== null &&
      !rotationEditorNeedsPositionRefresh(
        shell.editor,
        rosterIds,
        (playerVersionId) =>
          playablePositionsOfSlice(shell.playerSlice, playerVersionId) as readonly Position[],
      )
    ) {
      return { editor: shell.editor, key };
    }
    const members = roster.players.map((entry) => ({
      playerVersionId: entry.playerVersionId,
      displayName: entry.displayName,
      playable: playablePositionsOfSlice(
        shell.playerSlice,
        entry.playerVersionId,
      ) as readonly Position[],
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      seasonKey: entry.seasonKey,
    }));
    return { editor: createRotationEditor(rotation, members), key };
  }

  function mirrorHub(): void {
    const hub = shell.hub;
    if (hub === null) return;
    shell.snapshot = hub.snapshot;
    shell.index = hub.index;
    shell.block = hub.block;
    // Postseason orchestration mirror (Track A's progress surface).
    shell.postseason = hasPostseasonHubMethods(hub) ? hub.postseason : shell.postseason;
    // Interruption/pending mirrors + the last typed command rejection.
    shell.pending = hub.pending;
    shell.interruption = hub.interruption;
    shell.commandError = hub.commandError;
    shell.hubError = hub.error;
    shell.externalChange = hub.externalChange;
    recomputeRunFacts();
  }

  let unsubscribeHub: (() => void) | null = null;

  let quitOpen = $state(false);
  let quitting = $state(false);
  let quitError: string | null = $state(null);

  let clearOpen = $state(false);
  let clearing = $state(false);
  let clearError: string | null = $state(null);

  async function confirmClearSeasonData(): Promise<void> {
    if (clearing) return;
    clearing = true;
    clearError = null;
    try {
      const result =
        shell.hub !== null
          ? await shell.hub.clearSeasonData()
          : await (async () => {
              const { clearAllSeasonData } = await import('$lib/season/season-data-recovery');
              await clearAllSeasonData();
              return { ok: true, error: null };
            })();
      if (!result.ok) {
        clearError = result.error;
        return;
      }
      clearOpen = false;
      shell.error = null;
      shell.hubError = null;
      mirrorHub();
      await goto(resolve('/season'));
    } catch (error) {
      clearError = error instanceof Error ? error.message : String(error);
    } finally {
      clearing = false;
    }
  }

  async function confirmQuit(): Promise<void> {
    if (quitting) return;
    quitting = true;
    quitError = null;
    try {
      const result = await shell.quitRun();
      if (!result.ok) {
        quitError = result.error;
        return;
      }
      quitOpen = false;
      await goto(resolve('/season'));
    } finally {
      quitting = false;
    }
  }

  $effect(() => {
    if (!import.meta.env.SSR) {
      void initShell();
    }
    return () => {
      unsubscribeHub?.();
      unsubscribeHub = null;
      const hub = shell.hub;
      if (hub !== null) {
        hub.destroy();
        shell.hub = null;
      }
    };
  });

  /**
   * Phase 1 (interactive): loads only the minimal run shell — manifest,
   * league, schedule, repository, runner, the active index/checkpoint, and
   * the compact per-run player slice. The heavy catalog and players index are
   * deferred to an idle callback (see `scheduleLazyWork`), so the shell is
   * interactive long before any big JSON parse.
   */
  async function initShell(): Promise<void> {
    try {
      const [manifest, league, schedule] = await Promise.all([
        getManifest(),
        loadSeasonLeague(),
        loadSeasonSchedule(),
      ]);
      shell.manifest = manifest;
      shell.league = league;
      shell.schedule = schedule;

      const repo = await getSeasonRunRepository(schedule);
      const runner = await getSeasonBlockRunner();
      const hub = new SeasonHubState(repo, runner);
      shell.hub = hub;
      unsubscribeHub = hub.subscribe(() => mirrorHub());
      await hub.refresh();
      mirrorHub();
      await loadPlayerSlice();
      mirrorHub();
      scheduleLazyWork();
    } catch (error) {
      shell.error = error instanceof Error ? error.message : String(error);
    } finally {
      shell.ready = true;
    }
  }

  /** Loads the compact per-run player presentation slice (fast IndexedDB
   * read) so the rotation editor and every view render without the catalog. */
  async function loadPlayerSlice(): Promise<void> {
    const runId = shell.snapshot?.run.runId ?? null;
    if (runId === null) {
      shell.playerSlice = new Map();
      shell.playerSliceReady = true;
      return;
    }
    try {
      const entries = await shell.hub?.loadPlayerSlice(runId);
      shell.playerSlice = playerSliceOf(entries ?? []);
    } catch {
      shell.playerSlice = new Map();
    } finally {
      shell.playerSliceReady = true;
    }
  }

  /**
   * Phase 2 (idle, after first paint): loads the packaged catalog, tops up
   * the player slice from it (traded-in players), loads the global players
   * index for faces, and prewarms the simulation worker so the first
   * "simulate block" click pays no catalog download/parse time.
   */
  function scheduleLazyWork(): void {
    const run = () => {
      void lazyLoadAssets();
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 0);
    }
  }

  async function lazyLoadAssets(): Promise<void> {
    if (import.meta.env.SSR) return;
    try {
      const [{ loadSeasonDraftCatalog }, index] = await Promise.all([
        import('$lib/season/season-assets'),
        getPlayersIndex(),
      ]);
      const catalog = await loadSeasonDraftCatalog();
      shell.catalog = catalog;
      if (shell.hub !== null) {
        shell.hub.catalog = catalog;
      }
      playersIndex = index.players;
      shell.facesReady = true;
      if (shell.run !== null) {
        rebuildFacesIfNeeded(shell.run);
      }
      await topUpPlayerSliceFromCatalog(catalog);
      mirrorHub();
      shell.hub?.prewarm();
    } catch {
      // Lazy assets are best effort: the slice keeps the shell usable; the
      // block worker retries catalog loads itself on the first block.
    }
  }

  /** Merges catalog facts for roster players missing from the slice (trades
   * move players after promotion) so the editor never loses positions. */
  async function topUpPlayerSliceFromCatalog(
    catalog: NonNullable<SeasonRunShellData['catalog']>,
  ): Promise<void> {
    const run = shell.run;
    const hub = shell.hub;
    if (run === null || hub === null) return;
    // Plain transient lookup map (never rendered); rebuilt per top-up.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byVersion = new Map<string, SeasonRunPlayerSliceEntry>();
    for (const entry of shell.playerSlice.values()) {
      byVersion.set(entry.playerVersionId, entry);
    }
    const candidates = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
    );
    const missing: SeasonRunPlayerSliceEntry[] = [];
    for (const roster of run.rosters) {
      for (const entry of roster.players) {
        if (byVersion.has(entry.playerVersionId)) continue;
        const candidate = candidates.get(entry.playerVersionId);
        if (candidate === undefined) continue;
        missing.push({
          playerVersionId: entry.playerVersionId,
          playerId: entry.playerId,
          franchiseId: candidate.franchiseId,
          eraId: candidate.eraId,
          seasonKey: candidate.seasonKey,
          displayName: entry.displayName,
          positionsPlayable: [...candidate.positions.playable],
          summaryRatings: { ...candidate.summaryRatings },
          staminaRating: candidate.stamina.rating,
          durabilityRating: candidate.durability.rating,
        });
      }
    }
    if (missing.length === 0) return;
    await hub.upsertPlayerSlice(run.runId, missing);
    const merged = playerSliceOf([...byVersion.values(), ...missing]);
    shell.playerSlice = merged;
  }

  shell.cancelBlock = () => shell.hub?.cancel();
  shell.retryBlock = () => void shell.hub?.retry();
  shell.acknowledgeExternalChange = () => {
    shell.hub?.acknowledgeExternalChange();
    shell.externalChange = null;
  };
  shell.prewarmWorker = () => shell.hub?.prewarm();
  shell.refresh = async () => {
    await shell.hub?.refresh();
    mirrorHub();
  };
  shell.quitRun = async () => {
    if (shell.hub === null) {
      return { ok: false, error: 'season hub is not ready' };
    }
    return shell.hub.quitRun();
  };
  shell.selectBlockObjective = async (input) => {
    await shell.hub?.selectBlockObjective(input);
    mirrorHub();
  };
  shell.spendInfluence = async (input) => {
    await shell.hub?.spendInfluence(input);
    mirrorHub();
  };
  shell.acceptTradeOffer = async (input) => {
    await shell.hub?.acceptTradeOffer(input);
    mirrorHub();
    if (shell.catalog !== null) {
      await topUpPlayerSliceFromCatalog(shell.catalog);
      mirrorHub();
    }
  };
  shell.declineTradeOffer = async (input) => {
    await shell.hub?.declineTradeOffer(input);
    mirrorHub();
  };
  shell.forfeitInterruptedGame = async () => {
    await shell.hub?.forfeitInterruptedGame();
    mirrorHub();
  };
  shell.resumeBlock = async () => {
    await shell.hub?.resumeBlock();
    mirrorHub();
  };

  /**
   * M2.6 postseason actions bound to the frozen Cross-track API contract.
   * Track A implements the hub surface; when it is not present in this
   * build the action surfaces a typed, actionable error instead of a silent
   * no-op (the run itself is untouched and safe).
   */
  function postseasonUnavailable(): void {
    shell.postseason = {
      ...idlePostseasonProgress(),
      phase: 'failed',
      error: { code: 'unavailable', message: POSTSEASON_ORCHESTRATION_UNAVAILABLE },
    };
  }
  shell.startPostseason = async () => {
    const hub = shell.hub;
    if (hub === null) return;
    if (!hasPostseasonHubMethods(hub)) {
      postseasonUnavailable();
      return;
    }
    await hub.startPostseason();
    mirrorHub();
  };
  shell.advancePostseason = async (input) => {
    const hub = shell.hub;
    if (hub === null) return;
    if (!hasPostseasonHubMethods(hub)) {
      postseasonUnavailable();
      return;
    }
    await hub.advancePostseason(input);
    mirrorHub();
  };
  shell.submitPostseasonRotation = async (input) => {
    const hub = shell.hub;
    if (hub === null) return;
    if (!hasPostseasonHubMethods(hub)) {
      postseasonUnavailable();
      return;
    }
    await hub.submitPostseasonRotation(input);
    mirrorHub();
  };
  shell.spectatePostseasonGame = async (input) => {
    const hub = shell.hub;
    if (hub === null) return;
    if (!hasPostseasonHubMethods(hub)) {
      postseasonUnavailable();
      return;
    }
    await hub.spectatePostseasonGame(input);
    mirrorHub();
  };
  shell.fastForwardPostseason = async (input) => {
    const hub = shell.hub;
    if (hub === null) return;
    if (!hasPostseasonHubMethods(hub)) {
      postseasonUnavailable();
      return;
    }
    await hub.fastForwardPostseason(input);
    mirrorHub();
  };
  shell.cancelPostseason = () => {
    const hub = shell.hub;
    if (hub !== null && hasPostseasonHubMethods(hub)) {
      hub.cancelPostseason();
    }
  };
  shell.playerName = (playerVersionId: string): string => {
    for (const roster of shell.run?.rosters ?? []) {
      const entry = roster.players.find((p) => p.playerVersionId === playerVersionId);
      if (entry !== undefined) return entry.displayName;
    }
    return '—';
  };
  shell.playablePositions = (playerVersionId: string): readonly string[] =>
    playablePositionsOfSlice(shell.playerSlice, playerVersionId);
  shell.franchiseName = (franchiseId: string): string => {
    return (
      shell.manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)
        ?.displayName ?? franchiseId
    );
  };
  shell.franchiseAbbrev = (franchiseId: string): string => {
    return franchiseAbbreviation(franchiseId);
  };

  const mastheadFacts = $derived.by(() => {
    const run = shell.run;
    const franchiseId = shell.humanFranchiseId;
    const manifest = shell.manifest;
    if (run === null || franchiseId === null || manifest === null) return null;
    const row = run.standings.rows.find((r) => r.franchiseId === franchiseId);
    if (row === undefined) return null;
    const ranked = provisionalRanking(run.standings, run.league).find(
      (entry) => entry.row.franchiseId === franchiseId,
    );
    return {
      franchiseId,
      record: recordLabel(row.wins, row.losses),
      position: ranked === undefined ? '—' : `${ordinal(ranked.rank)} in the ${ranked.conference}`,
    };
  });

  const seasonLoadError = $derived(shell.error ?? shell.hubError ?? null);

  const incompatible = $derived(shell.hub?.incompatible ?? null);

  /** History routes render without an active run (the champion was
   * promoted to completed history and the active-run pointer removed). */
  const isHistoryRoute = $derived(routeId?.startsWith('/season/run/history') ?? false);

  const showBrokenResume = $derived(
    shell.ready &&
      seasonLoadError === null &&
      incompatible === null &&
      shell.hub !== null &&
      shell.snapshot === null &&
      shell.index !== null,
  );

  const showEmptyState = $derived(
    shell.ready &&
      seasonLoadError === null &&
      incompatible === null &&
      shell.hub !== null &&
      shell.snapshot === null &&
      shell.index === null &&
      !showBrokenResume &&
      !isHistoryRoute,
  );

  let discardOpen = $state(false);
  let discarding = $state(false);
  let discardError: string | null = $state(null);

  async function confirmDiscard(): Promise<void> {
    if (discarding) return;
    discarding = true;
    discardError = null;
    try {
      await shell.hub?.discardIncompatibleRun();
      discardOpen = false;
      await goto(resolve('/season'));
    } catch (error) {
      discardError = error instanceof Error ? error.message : String(error);
    } finally {
      discarding = false;
    }
  }
</script>

<svelte:head>
  <title>Season Run — Hoop Rush</title>
</svelte:head>

{#if seasonLoadError !== null || showBrokenResume}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6">
      <h1 class="font-display text-3xl font-extrabold">
        {seasonLoadError !== null ? 'Season data unavailable' : 'Saved season could not load'}
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        {#if seasonLoadError !== null}
          {seasonLoadError}
        {:else}
          A resume marker exists in this browser, but the saved season checkpoint is missing or
          incomplete. You can clear the broken save and start fresh.
        {/if}
      </p>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={() => (clearOpen = true)}
          class="inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear saved data
        </button>
        <a
          href={resolve('/season')}
          class="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Back to Season setup
        </a>
      </div>
      {#if clearError !== null}
        <p class="mt-3 text-sm text-destructive" role="alert">{clearError}</p>
      {/if}
    </div>
  </div>
  <Dialog.Root bind:open={clearOpen}>
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-xl outline-none"
    >
      <Dialog.Title class="font-display text-2xl font-extrabold">Clear season data?</Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted-foreground">
        This permanently deletes your saved Season Run and any in-progress draft from this browser.
        It cannot be recovered.
      </Dialog.Description>
      <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Dialog.Close
          class="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Cancel
        </Dialog.Close>
        <button
          type="button"
          onclick={() => void confirmClearSeasonData()}
          disabled={clearing}
          class="inline-flex items-center justify-center rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Yes, clear everything'}
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{:else if !shell.ready}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6" aria-live="polite">
      <p class="font-mono text-sm text-muted-foreground">Loading your season…</p>
    </div>
  </div>
{:else if incompatible !== null}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6">
      <p class="text-label uppercase text-muted-foreground">Season rules changed</p>
      <h1 class="mt-1 font-display text-3xl font-extrabold">
        This saved season was made with the old rules
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
        Season Run now simulates stamina, workload, and pair chemistry, so runs started under the
        previous rules (schema {incompatible.storedRunSchemaVersion}) cannot continue. Nothing has
        been deleted: the saved season stays in your browser until you decide.
      </p>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={() => (discardOpen = true)}
          class="inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          Discard run and restart
        </button>
        <a
          href={resolve('/season')}
          class="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Keep it and go back
        </a>
      </div>
      {#if discardError !== null}
        <p class="mt-3 text-sm text-destructive" role="alert">{discardError}</p>
      {/if}
    </div>
  </div>
  <Dialog.Root bind:open={discardOpen}>
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-xl outline-none"
    >
      <Dialog.Title class="font-display text-2xl font-extrabold">Discard this season?</Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted-foreground">
        This permanently deletes the saved season (schema {incompatible.storedRunSchemaVersion})
        from this browser. It cannot be recovered. Your next run starts fresh under the current
        rules.
      </Dialog.Description>
      <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Dialog.Close
          class="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Cancel
        </Dialog.Close>
        <button
          type="button"
          onclick={confirmDiscard}
          disabled={discarding}
          class="inline-flex items-center justify-center rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          {discarding ? 'Discarding…' : 'Yes, discard the season'}
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{:else if showEmptyState}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6">
      <h1 class="font-display text-3xl font-extrabold">No active Season Run</h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Create a franchise, draft ten players, and generate the league to open your command center.
      </p>
      <a
        href={resolve('/season')}
        class="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold"
      >
        Start a Season Run
      </a>
    </div>
  </div>
{:else}
  <div class="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip sm:px-6">
    {#if shell.externalChange !== null}
      <div
        role="status"
        class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm sm:rounded-b-xl"
      >
        <span class="min-w-0 flex-1 font-medium text-amber-700 dark:text-amber-300">
          {shell.externalChange.message}
        </span>
        <span class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onclick={() => void shell.refresh()}
            class="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1 text-xs font-semibold text-amber-700 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-amber-500/10 dark:text-amber-300"
          >
            <RefreshCw class="h-3.5 w-3.5" />
            Reload season
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onclick={() => shell.acknowledgeExternalChange()}
            class="grid h-7 w-7 place-items-center rounded-lg text-amber-700 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-amber-500/10 dark:text-amber-300"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    {/if}
    <div class="px-3 pt-6 sm:px-0">
      <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        <div class="min-w-0 flex-1">
          {#if mastheadFacts}
            <SeasonMasthead
              manifest={shell.manifest}
              franchiseId={mastheadFacts.franchiseId}
              recordLabel={mastheadFacts.record}
              positionLabel={mastheadFacts.position}
            />
          {/if}
        </div>
        <button
          type="button"
          onclick={() => (quitOpen = true)}
          disabled={quitting}
          class="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
        >
          <LogOut class="h-4 w-4 shrink-0" />
          Quit run
        </button>
      </div>
    </div>

    <nav
      aria-label="Season navigation"
      class="sticky top-0 z-30 mt-4 hidden border-y border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:block"
    >
      <div class="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 sm:px-6">
        {#each navItems as item (item.id)}
          {@const active = isNavItemActive(item, routeId)}
          <a
            href={resolve(item.href as RouteId)}
            aria-current={active ? 'page' : undefined}
            class="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold outline-none transition-colors focus-visible:bg-surface-2 focus-visible:text-foreground {active
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
          >
            <item.icon class="h-4 w-4 shrink-0" />
            {item.label}
          </a>
        {/each}
      </div>
    </nav>

    <main class="min-w-0 overflow-x-clip pb-[max(6.5rem,env(safe-area-inset-bottom))] md:pb-14">
      {@render children()}
    </main>
  </div>

  <BottomNav items={navItems} label="Season navigation" />

  <Dialog.Root
    open={quitOpen}
    onOpenChange={(open) => {
      if (!open && !quitting) quitOpen = false;
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content
        class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
      >
        <div class="flex items-start justify-between gap-3">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            Quit this run?
          </Dialog.Title>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          Quitting ends this Season Run and deletes its progress from this browser. You can start a
          new Season Run from the Season setup screen.
        </p>
        {#if quitError}
          <p
            role="alert"
            class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {quitError}
          </p>
        {/if}
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (quitOpen = false)}
            disabled={quitting}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stay
          </button>
          <button
            type="button"
            onclick={() => void confirmQuit()}
            disabled={quitting}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {quitting ? 'Quitting…' : 'Quit and delete'}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
