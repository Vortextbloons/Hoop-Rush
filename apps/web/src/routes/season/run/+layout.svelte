<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Briefcase, LogOut, RefreshCw, Trophy, Users, X, Zap } from '@lucide/svelte';
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
  import { seasonRunLoadDiagnosticOf, SeasonHubState } from '$lib/season/season-hub-state';
  import { SeasonRunShell } from '$lib/season/season-shell-state.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { catalogCandidateMap } from '$lib/season/season-catalog-index';
  import {
    buildVersionFaceIndex,
    freeAgencyVersionTuples,
    versionTupleOfRosterEntry,
  } from '$lib/season/season-branding';
  import {
    createRotationEditor,
    rotationEditorNeedsPositionRefresh,
  } from '$lib/season/season-rotation-editor';
  import {
    hasPostseasonHubMethods,
    idlePostseasonProgress,
    POSTSEASON_ORCHESTRATION_UNAVAILABLE,
  } from '$lib/season/season-postseason-presentation';
  import { isNavItemActive } from '$lib/nav-items';
  import {
    buildSeasonNavGroups,
    seasonMobileNavOf,
    type SeasonNavGroup,
  } from '$lib/season/season-nav';
  import {
    playablePositionsOfSlice,
    playerSliceOf,
    type SeasonRunPlayerSlice,
  } from '$lib/season/season-player-slice';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import SeasonMasthead from '$lib/components/season/SeasonMasthead.svelte';
  import type { RotationEditor } from '$lib/season/season-rotation-editor';
  import type { SeasonRunPlayerSliceEntry } from '@hoop-rush/persistence';
  import '$lib/season/season-theme.css';
  let { children } = $props();
  const groups: SeasonNavGroup[] = $derived.by(() => {
    const stage = (shell.run?.stage ?? null) as Parameters<typeof buildSeasonNavGroups>[1]['stage'];
    return buildSeasonNavGroups(
      {
        gameday: Zap,
        team: Users,
        league: Trophy,
        bracket: Trophy,
        frontOffice: Briefcase,
      },
      {
        stage,
        freeAgencyVisible: (shell.run?.freeAgency.windows.length ?? 0) > 0,
      },
    );
  });
  const { primary: mobilePrimary, overflow: mobileOverflow } = $derived(seasonMobileNavOf(groups));
  const activeSubGroup = $derived.by(
    () => groups.find((group) => group.children.some((c) => isNavItemActive(c, routeId))) ?? null,
  );
  const shell = new SeasonRunShell();
  setContext(SEASON_RUN_SHELL_CONTEXT, shell);
  const routeId = $derived(page.route.id);
  let playersIndex: PlayersIndexEntry[] | null = null;
  let faceIndexKey = '';
  let lastHeavyMirrorAt = 0;
  let lastHeavySnapshot: unknown = null;
  let lastHeavyBlockPhase: string | null = null;
  let tradeCacheSource: unknown = null;
  let tradeCacheClone: NonNullable<SeasonRunShellData['trade']> | null = null;
  function cloneTradeState(trade: NonNullable<SeasonRunShellData['trade']>) {
    if (trade === tradeCacheSource && tradeCacheClone !== null) return tradeCacheClone;
    const cloned = {
      ...trade,
      windows: trade.windows.map((window) => ({
        ...window,
        offers: window.offers.map((offer) => ({
          ...offer,
          seedPath: [...offer.seedPath],
          outgoingPlayerVersionIds: [...offer.outgoingPlayerVersionIds],
          incomingPlayerVersionIds: [...offer.incomingPlayerVersionIds],
          outgoingHealth: offer.outgoingHealth.map((entry) => ({
            ...entry,
            activeInjuryIds: [...entry.activeInjuryIds],
          })),
          incomingHealth: offer.incomingHealth.map((entry) => ({
            ...entry,
            activeInjuryIds: [...entry.activeInjuryIds],
          })),
          valueBand: { ...offer.valueBand },
          roleFit: {
            ...offer.roleFit,
            outgoingRoles: [...offer.roleFit.outgoingRoles],
            incomingRoles: [...offer.roleFit.incomingRoles],
          },
          rosterNeedFacts: { ...offer.rosterNeedFacts },
          projectedChemistryDisruption: { ...offer.projectedChemistryDisruption },
        })),
        boardProfiles: window.boardProfiles?.map((profile) => ({
          ...profile,
          needs: [...profile.needs],
          listedPlayerIds: [...profile.listedPlayerIds],
          discussablePlayerIds: [...profile.discussablePlayerIds],
          protectedPlayerIds: [...profile.protectedPlayerIds],
          hardConstraints: [...profile.hardConstraints],
          competitorInterest:
            profile.competitorInterest === undefined
              ? undefined
              : { ...profile.competitorInterest },
        })),
        canonicalTeamOrder:
          window.canonicalTeamOrder === undefined ? undefined : [...window.canonicalTeamOrder],
        negotiations: window.negotiations?.map((negotiation) => ({
          ...negotiation,
          exchanges: negotiation.exchanges.map((exchange) => ({ ...exchange })),
          rejectedPlayerVersionIds: [...negotiation.rejectedPlayerVersionIds],
          expressedInterests: [...negotiation.expressedInterests],
        })),
        valueTrends: window.valueTrends?.map((trend) => ({ ...trend })),
      })),
      humanDirectNegotiations: trade.humanDirectNegotiations?.map((negotiation) => ({
        ...negotiation,
        confirmations: { ...negotiation.confirmations },
        currentProposal:
          negotiation.currentProposal === null ? null : { ...negotiation.currentProposal },
        counterProposal:
          negotiation.counterProposal === null ? null : { ...negotiation.counterProposal },
      })),
    };
    tradeCacheSource = trade;
    tradeCacheClone = cloned;
    return cloned;
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
    shell.challenges =
      (run as unknown as { challenges?: SeasonRunShellData['challenges'] })?.challenges ?? null;
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
  function rebuildFacesIfNeeded(run: NonNullable<SeasonRunShellData['run']>): void {
    if (playersIndex === null) return;
    const catalog = shell.catalog;
    const freeAgencyKey =
      run.freeAgency === null || run.freeAgency === undefined
        ? 'no-fa'
        : run.freeAgency.windows
            .map((window) =>
              window.candidates.map((candidate) => candidate.playerVersionId).join(','),
            )
            .join('|');
    const key = `${run.runId}:${run.rosters
      .map(
        (roster) =>
          `${roster.franchiseId}:${roster.players.map((p) => p.playerVersionId).join(',')}`,
      )
      .join('|')}:${freeAgencyKey}:${catalog === null ? 'no-catalog' : 'catalog'}`;
    if (key === faceIndexKey) return;
    const candidates = catalog === null ? null : catalogCandidateMap(catalog);
    const tuples = [
      ...run.rosters.flatMap((roster) =>
        roster.players.map((entry) =>
          versionTupleOfRosterEntry(entry, candidates?.get(entry.playerVersionId) ?? null),
        ),
      ),
      ...freeAgencyVersionTuples(run.freeAgency, catalog),
    ];
    shell.facesByVersion = buildVersionFaceIndex(playersIndex, tuples);
    faceIndexKey = key;
  }
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
  function mirrorHub(forceHeavy = false): void {
    const hub = shell.hub;
    if (hub === null) return;
    shell.snapshot = hub.snapshot;
    shell.index = hub.index;
    shell.block = hub.block;
    shell.postseason = hasPostseasonHubMethods(hub) ? hub.postseason : shell.postseason;
    shell.pending = hub.pending;
    shell.interruption = hub.interruption;
    shell.commandError = hub.commandError;
    shell.commandReceipt = hub.commandReceipt;
    shell.hubError = hub.error;
    shell.externalChange = hub.externalChange;
    const phase = hub.block.phase;
    const snapshotChanged = shell.snapshot !== lastHeavySnapshot;
    const phaseChanged = phase !== lastHeavyBlockPhase;
    const now = Date.now();
    const isTerminal = phase !== 'running';
    if (
      !forceHeavy &&
      !snapshotChanged &&
      !phaseChanged &&
      !isTerminal &&
      now - lastHeavyMirrorAt < 1000
    )
      return;
    lastHeavyMirrorAt = now;
    lastHeavySnapshot = shell.snapshot;
    lastHeavyBlockPhase = phase;
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
      hub.prewarm();
      await hub.refresh();
      mirrorHub(true);
      await loadPlayerSlice();
      mirrorHub(true);
      scheduleLazyWork();
    } catch (error) {
      shell.error = seasonRunLoadDiagnosticOf(error, 'SEASON_RUN_INIT_FAILED');
    } finally {
      shell.ready = true;
    }
  }
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
      shell.playersIndex = index.players;
      shell.facesReady = true;
      if (shell.run !== null) {
        rebuildFacesIfNeeded(shell.run);
      }
      await topUpPlayerSliceFromCatalog(catalog);
      mirrorHub();
      shell.hub?.prewarm();
    } catch {}
  }
  async function topUpPlayerSliceFromCatalog(
    catalog: NonNullable<SeasonRunShellData['catalog']>,
  ): Promise<void> {
    const run = shell.run;
    const hub = shell.hub;
    if (run === null || hub === null) return;
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
  shell.declareFreeAgentInterest = async (input) => {
    await shell.hub?.declareFreeAgentInterest(input);
    mirrorHub();
  };
  shell.skipFreeAgentMarket = async (input) => {
    await shell.hub?.skipFreeAgentMarket(input);
    mirrorHub();
  };
  shell.resolveFreeAgentMarket = async (input) => {
    await shell.hub?.resolveFreeAgentMarket(input);
    mirrorHub();
    if (shell.catalog !== null) {
      await topUpPlayerSliceFromCatalog(shell.catalog);
      mirrorHub();
    }
  };
  shell.forfeitInterruptedGame = async () => {
    await shell.hub?.forfeitInterruptedGame();
    mirrorHub();
  };
  shell.resumeBlock = async () => {
    await shell.hub?.resumeBlock();
    mirrorHub();
  };
  shell.selectFrontOffice = async (input) => {
    await shell.hub?.selectFrontOffice(input);
    mirrorHub();
  };
  shell.selectCourtInnovation = async (input) => {
    await shell.hub?.selectCourtInnovation(input);
    mirrorHub();
  };
  shell.openTradeInquiry = async (input) => {
    await shell.hub?.openTradeInquiry(input);
    mirrorHub();
  };
  shell.submitTradeProposal = async (input) => {
    await shell.hub?.submitTradeProposal(input);
    mirrorHub();
  };
  shell.respondToTradeCounter = async (input) => {
    await shell.hub?.respondToTradeCounter(input);
    mirrorHub();
    if (shell.catalog !== null) {
      await topUpPlayerSliceFromCatalog(shell.catalog);
      mirrorHub();
    }
  };
  shell.walkAwayFromTrade = async (input) => {
    await shell.hub?.walkAwayFromTrade(input);
    mirrorHub();
  };
  shell.purchaseTradeInquiry = async (input) => {
    await shell.hub?.purchaseTradeInquiry(input);
    mirrorHub();
  };
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
  shell.forfeitPostseasonGame = async (input) => {
    const hub = shell.hub;
    if (hub === null) return;
    if (!hasPostseasonHubMethods(hub)) {
      postseasonUnavailable();
      return;
    }
    await hub.forfeitPostseasonGame(input);
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
    return '';
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
  const rankingWeak = new WeakMap<object, ReturnType<typeof provisionalRanking>>();
  const rankingByDigest = new Map<string, ReturnType<typeof provisionalRanking>>();
  function standingsDigest(
    rows: readonly {
      franchiseId: string;
      wins: number;
      losses: number;
      pointsFor: number;
      pointsAgainst: number;
    }[],
  ): string {
    let hash = 2166136261;
    const sorted = [...rows].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
    for (const row of sorted) {
      for (let i = 0; i < row.franchiseId.length; i += 1)
        hash = Math.imul(hash ^ row.franchiseId.charCodeAt(i), 16777619);
      hash = Math.imul(hash ^ row.wins, 16777619);
      hash = Math.imul(hash ^ row.losses, 16777619);
      hash = Math.imul(hash ^ row.pointsFor, 16777619);
      hash = Math.imul(hash ^ row.pointsAgainst, 16777619);
    }
    return `${String(rows.length)}:${String(hash >>> 0)}`;
  }
  function memoizedRanking(
    standings: Parameters<typeof provisionalRanking>[0],
    league: Parameters<typeof provisionalRanking>[1],
  ): ReturnType<typeof provisionalRanking> {
    const weakHit = rankingWeak.get(standings);
    if (weakHit !== undefined) return weakHit;
    const digest = standingsDigest(standings.rows);
    const digestHit = rankingByDigest.get(digest);
    if (digestHit !== undefined) {
      rankingWeak.set(standings, digestHit);
      return digestHit;
    }
    const ranked = provisionalRanking(standings, league);
    rankingWeak.set(standings, ranked);
    rankingByDigest.set(digest, ranked);
    if (rankingByDigest.size > 4) {
      const oldest = rankingByDigest.keys().next().value;
      if (oldest !== undefined) rankingByDigest.delete(oldest);
    }
    return ranked;
  }
  const mastheadFacts = $derived.by(() => {
    const run = shell.run;
    const franchiseId = shell.humanFranchiseId;
    const manifest = shell.manifest;
    if (run === null || franchiseId === null || manifest === null) return null;
    const row = run.standings.rows.find((r) => r.franchiseId === franchiseId);
    if (row === undefined) return null;
    const ranked = memoizedRanking(run.standings, run.league).find(
      (entry) => entry.row.franchiseId === franchiseId,
    );
    if (run.stage === 'play-in' || run.stage === 'playoffs' || run.stage === 'completed') {
      const stageWord =
        run.stage === 'play-in' ? 'Play-In' : run.stage === 'playoffs' ? 'Playoffs' : 'Finals';
      return {
        franchiseId,
        record: recordLabel(row.wins, row.losses),
        position: ranked === undefined ? stageWord : `${ordinal(ranked.rank)} seed · ${stageWord}`,
      };
    }
    return {
      franchiseId,
      record: recordLabel(row.wins, row.losses),
      position: ranked === undefined ? '' : `${ordinal(ranked.rank)} in the ${ranked.conference}`,
    };
  });
  const seasonLoadError = $derived(shell.error ?? shell.hubError ?? null);
  const isHistoryRoute = $derived(routeId?.startsWith('/season/run/history') ?? false);
  const showBrokenResume = $derived(
    shell.ready &&
      seasonLoadError === null &&
      shell.hub !== null &&
      shell.snapshot === null &&
      shell.index !== null,
  );
  const showEmptyState = $derived(
    shell.ready &&
      seasonLoadError === null &&
      shell.hub !== null &&
      shell.snapshot === null &&
      shell.index === null &&
      !showBrokenResume &&
      !isHistoryRoute,
  );
</script>

<svelte:head>
  <title>Season Run · Hoop Rush</title>
  <meta name="theme-color" content="#0C1015" />
</svelte:head>

<div class="season-root">
  {#if seasonLoadError !== null || showBrokenResume}
    <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
      <div class="sr-panel sr-arrive p-6">
        <p class="sr-eyebrow">Season Run</p>
        <h1 class="sr-page-title mt-1">Season data unavailable</h1>
        <p class="mt-3 text-sm text-muted-foreground">
          {#if seasonLoadError !== null}
            {seasonLoadError.message}
          {:else}
            The saved season checkpoint is missing or incomplete. Restart to clear the broken save
            and start fresh.
          {/if}
        </p>
        {#if seasonLoadError !== null}
          <div class="sr-panel-quiet mt-4 p-3">
            <p class="sr-section-label">Diagnostic code</p>
            <code class="mt-1 block break-all text-xs text-foreground">{seasonLoadError.code}</code>
            {#if seasonLoadError.failures.length > 0}
              <details class="mt-3">
                <summary class="sr-section-label cursor-pointer"
                  >Validation details ({seasonLoadError.failures.length})</summary
                >
                <ul class="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {#each seasonLoadError.failures as failure (failure)}
                    <li class="break-words">{failure}</li>
                  {/each}
                </ul>
              </details>
            {/if}
          </div>
        {/if}
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onclick={() => (clearOpen = true)} class="sr-btn-danger">
            Restart season
          </button>
          <a href={resolve('/season')} class="sr-btn-ghost">Back to Season setup</a>
        </div>
        {#if clearError !== null}
          <p class="mt-3 text-sm text-destructive" role="alert">{clearError}</p>
        {/if}
      </div>
    </div>
    <Dialog.Root bind:open={clearOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="sr-dialog-overlay" />
        <Dialog.Content class="sr-dialog w-[min(28rem,calc(100vw-2rem))] p-6">
          <Dialog.Title class="sr-page-title text-2xl">Restart season?</Dialog.Title>
          <Dialog.Description class="mt-2 text-sm text-muted-foreground">
            This permanently deletes your saved Season Run and any in-progress draft from this
            browser. You will start a new season from the setup screen.
          </Dialog.Description>
          <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close class="sr-btn-ghost">Cancel</Dialog.Close>
            <button
              type="button"
              onclick={() => void confirmClearSeasonData()}
              disabled={clearing}
              class="sr-btn-danger"
            >
              {clearing ? 'Restarting…' : 'Clear save and restart'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  {:else if !shell.ready}
    <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
      <div class="sr-panel p-6" aria-live="polite">
        <p class="sr-section-label">Loading your season…</p>
      </div>
    </div>
  {:else if showEmptyState}
    <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
      <div class="sr-panel p-6">
        <p class="sr-eyebrow">Season Run</p>
        <h1 class="sr-page-title mt-1">No active Season Run</h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Create a franchise, draft ten players, and generate the league to open your command
          center.
        </p>
        <a href={resolve('/season')} class="sr-btn mt-5">Start a Season Run</a>
      </div>
    </div>
  {:else}
    <div
      class="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip sm:px-6 xl:max-w-7xl 2xl:max-w-[88rem]"
    >
      {#if shell.externalChange !== null}
        <div
          role="status"
          class="flex flex-wrap items-center justify-between gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-sm sm:rounded-b-xl"
          style="border-color: rgb(224 177 94 / 40%); background: rgb(224 177 94 / 8%)"
        >
          <span class="min-w-0 flex-1 font-medium" style="color: var(--sr-warn)">
            {shell.externalChange.message}
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onclick={() => void shell.refresh()}
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold outline-none"
              style="border: 1px solid rgb(224 177 94 / 45%); color: var(--sr-warn)"
            >
              <RefreshCw class="h-3.5 w-3.5" />
              Reload season
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onclick={() => shell.acknowledgeExternalChange()}
              class="grid h-7 w-7 place-items-center rounded-lg outline-none"
              style="color: var(--sr-warn)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      {/if}
      <div class="px-3 pt-6 sm:px-0">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
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
            class="sr-btn-ghost inline-flex w-fit shrink-0 px-3 py-2 text-xs"
          >
            <LogOut class="h-4 w-4 shrink-0" />
            Quit run
          </button>
        </div>
      </div>
      <nav aria-label="Season navigation" class="sr-nav-primary mt-5 hidden md:block">
        <div
          class="mx-auto flex min-w-max w-full max-w-6xl items-center gap-1 px-4 sm:px-6 xl:max-w-7xl 2xl:max-w-[88rem]"
        >
          {#each groups as group (group.id)}
            {@const groupActive = group.children.some((c) => isNavItemActive(c, routeId))}
            <a href={resolve(group.href as any)} aria-current={groupActive ? 'page' : undefined}>
              <group.icon class="h-4 w-4 shrink-0" />
              {group.label}
            </a>
          {/each}
        </div>
      </nav>
      {#if activeSubGroup !== null && activeSubGroup.children.length > 1}
        <div
          class="mx-auto hidden w-full max-w-6xl px-4 sm:px-6 md:block xl:max-w-7xl 2xl:max-w-[88rem]"
        >
          <nav aria-label={`${activeSubGroup.label} sections`} class="sr-nav-sub">
            {#each activeSubGroup.children as child (child.id)}
              <a
                href={resolve(child.href as any)}
                aria-current={isNavItemActive(child, routeId) ? 'page' : undefined}
              >
                {child.label}
              </a>
            {/each}
          </nav>
        </div>
      {/if}
      <main class="min-w-0 overflow-x-clip pb-[max(6.5rem,env(safe-area-inset-bottom))] md:pb-14">
        <div class="mx-auto w-full max-w-6xl px-3 sm:px-6 xl:max-w-7xl 2xl:max-w-[88rem]">
          {@render children()}
        </div>
      </main>
    </div>
    <BottomNav items={mobilePrimary} overflowItems={mobileOverflow} label="Season navigation" />
    <Dialog.Root
      open={quitOpen}
      onOpenChange={(open) => {
        if (!open && !quitting) quitOpen = false;
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="sr-dialog-overlay" />
        <Dialog.Content class="sr-dialog w-[min(28rem,calc(100vw-2rem))] p-6">
          <div class="flex items-start justify-between gap-3">
            <Dialog.Title class="sr-page-title text-2xl">Quit this run?</Dialog.Title>
            <Dialog.Close
              aria-label="Cancel"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong text-muted-foreground"
            >
              <X class="h-4 w-4" />
            </Dialog.Close>
          </div>
          <p class="mt-3 text-sm text-muted-foreground">
            Quitting ends this Season Run and deletes its progress from this browser. You can start
            a new Season Run from the Season setup screen.
          </p>
          {#if quitError}
            <p
              role="alert"
              class="mt-3 rounded-lg p-3 text-sm"
              style="border: 1px solid rgb(229 100 110 / 40%); background: rgb(229 100 110 / 10%); color: var(--sr-loss)"
            >
              {quitError}
            </p>
          {/if}
          <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onclick={() => (quitOpen = false)}
              disabled={quitting}
              class="sr-btn-ghost"
            >
              Stay
            </button>
            <button
              type="button"
              onclick={() => void confirmQuit()}
              disabled={quitting}
              class="sr-btn-danger"
            >
              {quitting ? 'Quitting…' : 'Quit and delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  {/if}
</div>
