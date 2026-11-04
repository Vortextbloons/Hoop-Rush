<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight } from '@lucide/svelte';
  import type {
    HoopRushManifest,
    PeakPlayerSeason,
    PlayersIndex,
    PlayersIndexEntry,
    Seed,
  } from '@hoop-rush/data-contracts';
  import {
    franchiseAbbreviation,
    resolveEraTeamIdentity,
    LINEUP_STRUCTURE,
  } from '@hoop-rush/data-contracts';
  import { validateLineup } from '@hoop-rush/engine';
  import { errorMessageOf } from '#lib/errors.js';
  import { clearDataLoaderCaches, getManifest, getPlayersIndex, getPool } from '#lib/data.js';
  import { resolvePlayerRefs } from '#lib/player-refs.js';
  import { generateSeed, parseSandboxUrl } from '#lib/sandbox-url.js';
  import { startSandboxRun } from '#lib/features/challenge/start-challenge-run.js';
  import { leaguePrecompute } from '#lib/features/challenge/league-precompute.js';
  import { sortDraftRows } from '#lib/draft-presentation.js';
  import {
    heuristicDraftPoolReport,
    DRAFT_FIT_SLOT_ORDER,
    loadDraftFitContext,
    nextPageWindow,
    poolRowKey,
    scoreDraftPoolMemo,
    type DraftFitContext,
    type DraftFitScore,
    type DraftFitNeed,
    type DraftFitTier,
  } from '#lib/draft-fit.js';
  import RosterFilters from '#lib/components/RosterFilters.svelte';
  import LineupCourt from '#lib/components/LineupCourt.svelte';
  import LineupSummaryNav from '#lib/components/LineupSummaryNav.svelte';
  import DraftValuePanel from '#lib/components/DraftValuePanel.svelte';
  import DraftPoolBrowser from '#lib/components/draft/DraftPoolBrowser.svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import { lazyModule } from '#lib/lazy-module.js';
  const loadSlotPickerDialog = lazyModule(
    () => import('#lib/components/draft/SlotPickerDialog.svelte'),
  );
  import { planPlayerMove } from '#lib/draft-slots.js';
  type IndexRow = PlayersIndexEntry;
  type SlotRef = {
    playerId: string;
    franchiseId: string;
    eraId: string;
  };
  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);
  let runError: string | null = $state(null);
  let starting = $state(false);
  let mounted = true;
  $effect(() => {
    mounted = true;
    return () => {
      mounted = false;
    };
  });
  let slots = $state<(IndexRow | null)[]>([null, null, null, null, null]);
  let runSeed = $state<Seed | null>(null);
  $effect(() => {
    if (runSeed !== null) return;
    const seed = generateSeed();
    runSeed = seed;
    leaguePrecompute.prime(seed);
  });
  let resolvedDraftPlayers = $state.raw<PeakPlayerSeason[]>([]);
  let sandboxFitContext = $state.raw<DraftFitContext | null>(null);
  let pageDots = $state.raw<ReadonlyMap<
    string,
    {
      tier: DraftFitTier;
      need: DraftFitNeed;
      netDelta: number | null;
      worstNetDelta: number | null;
      warningLabel: string | null;
      recommendedSlot: DraftFitScore['recommendedSlot'];
    }
  > | null>(null);
  let pageScores = $state.raw<DraftFitScore[] | null>(null);
  let pageRefinedCount = $state(0);
  let pageNeeds = $state.raw<DraftFitNeed[]>([]);
  const detailCache = new Map<string, PeakPlayerSeason>();
  let lastVisible: IndexRow[] = [];
  let lastVisibleKey = '';
  let pageScoreGen = 0;
  let dataGen = 0;
  let pickerPlayer = $state<IndexRow | null>(null);
  let pickerTrigger = $state<HTMLElement | null>(null);
  let pickerFallbackId = $state<string | null>(null);
  let franchiseFilter = $state('');
  let eraFilter = $state('');
  function loadSandboxData() {
    manifestError = null;
    indexError = null;
    manifest = null;
    index = null;
    const gen = ++dataGen;
    let cancelled = false;
    let restored = false;
    function maybeRestore(): void {
      if (restored || cancelled || gen !== dataGen || manifest === null || index === null) return;
      restored = true;
      restoreUrlState(manifest, index);
    }
    getManifest().then(
      (m) => {
        if (cancelled || gen !== dataGen) return;
        manifest = m;
        maybeRestore();
      },
      (error: unknown) => {
        if (!cancelled && gen === dataGen) manifestError = errorMessageOf(error);
      },
    );
    getPlayersIndex().then(
      (ix) => {
        if (cancelled || gen !== dataGen) return;
        index = ix;
        maybeRestore();
      },
      (error: unknown) => {
        if (!cancelled && gen === dataGen) indexError = errorMessageOf(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }
  $effect(() => loadSandboxData());
  $effect(() => {
    const m = manifest;
    const refs = slots
      .filter((player): player is IndexRow => player !== null)
      .map((player) => ({
        playerId: player.playerId,
        franchiseId: player.franchiseId,
        eraId: player.eraId,
      }));
    if (!m || refs.length === 0) {
      resolvedDraftPlayers = [];
      return;
    }
    let cancelled = false;
    resolvePlayerRefs(refs, m).then(
      (players) => {
        if (!cancelled) resolvedDraftPlayers = players;
      },
      () => {
        if (!cancelled) resolvedDraftPlayers = [];
      },
    );
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    const m = manifest;
    const eraId = eraFilter;
    if (!m || eraId === '') {
      sandboxFitContext = null;
      return;
    }
    let cancelled = false;
    loadDraftFitContext(m, eraId).then(
      (context) => {
        if (!cancelled) sandboxFitContext = context;
      },
      () => {
        if (!cancelled) sandboxFitContext = null;
      },
    );
    return () => {
      cancelled = true;
    };
  });
  async function ensureDetails(rows: readonly IndexRow[]): Promise<void> {
    const m = manifest;
    if (!m) return;
    const missing = rows.filter((row) => !detailCache.has(poolRowKey(row)));
    if (missing.length === 0) return;
    try {
      const resolved = await resolvePlayerRefs(
        missing.map((row) => ({
          playerId: row.playerId,
          franchiseId: row.franchiseId,
          eraId: row.eraId,
        })),
        m,
      );
      resolved.forEach((player, offset) => {
        const row = missing[offset];
        if (row) detailCache.set(poolRowKey(row), player);
      });
    } catch {
      return;
    }
  }
  function detailsFor(rows: readonly IndexRow[]): PeakPlayerSeason[] {
    const seen = new Set<string>();
    const details: PeakPlayerSeason[] = [];
    for (const row of rows) {
      if (seen.has(row.playerId)) continue;
      seen.add(row.playerId);
      const detail = detailCache.get(poolRowKey(row));
      if (detail) details.push(detail);
    }
    return details;
  }
  async function refreshPageFit(): Promise<void> {
    const gen = ++pageScoreGen;
    if (lastVisible.length === 0) {
      pageScores = null;
      pageRefinedCount = 0;
      return;
    }
    await ensureDetails(lastVisible);
    if (gen !== pageScoreGen || !mounted) return;
    const details = detailsFor(lastVisible);
    if (details.length === 0) return;
    try {
      const context =
        sandboxFitContext !== null &&
        details.every((player) => player.eraId === sandboxFitContext?.eraProfile.eraId)
          ? sandboxFitContext
          : null;
      const report =
        context === null
          ? heuristicDraftPoolReport({
              pool: details,
              locked: resolvedDraftPlayers,
              lockedSlots: slots.flatMap((player, index) =>
                player ? [DRAFT_FIT_SLOT_ORDER[index]!] : [],
              ),
            })
          : scoreDraftPoolMemo({
              pool: details,
              locked: resolvedDraftPlayers,
              lockedSlots: slots.flatMap((player, index) =>
                player ? [DRAFT_FIT_SLOT_ORDER[index]!] : [],
              ),
              context,
            });
      if (gen !== pageScoreGen || !mounted) return;
      const keyById = new Map<string, string>(
        details.map((player) => [player.playerId, poolRowKey(player)]),
      );
      pageDots = new Map(
        report.scores.map((entry) => [
          keyById.get(entry.playerId) ?? entry.playerId,
          {
            tier: entry.tier,
            need: entry.primaryNeed,
            netDelta: entry.netDelta,
            worstNetDelta: entry.worstNetDelta,
            warningLabel: entry.warningLabel,
            recommendedSlot: entry.recommendedSlot,
          },
        ]),
      );
      pageScores = report.scores;
      pageRefinedCount = report.refinedCount;
      pageNeeds = report.missingNeeds;
    } catch {
      if (gen === pageScoreGen && mounted) {
        pageDots = null;
        pageScores = null;
        pageRefinedCount = 0;
        pageNeeds = [];
      }
    }
  }
  function handleVisiblePage(rows: IndexRow[]) {
    const key = rows.map((row) => poolRowKey(row)).join(',');
    if (key === lastVisibleKey) return;
    lastVisibleKey = key;
    lastVisible = rows;
    pageDots = null;
    pageScores = null;
    pageRefinedCount = 0;
    pageNeeds = [];
    void refreshPageFit();
    const upcoming = nextPageWindow(sortedRows, rows);
    if (upcoming.length > 0) void ensureDetails(upcoming).catch(() => {});
  }
  $effect(() => {
    void resolvedDraftPlayers;
    void sandboxFitContext;
    void manifest;
    void eraFilter;
    if (lastVisible.length === 0) return;
    void refreshPageFit();
  });
  function retrySandboxData() {
    clearDataLoaderCaches();
    loadSandboxData();
  }
  function restoreUrlState(m: HoopRushManifest, ix: PlayersIndex) {
    if (slots.some((p) => p !== null)) return;
    if (typeof window === 'undefined') return;
    const result = parseSandboxUrl(new URL(window.location.href), m, ix);
    if (!result.ok || !result.state) return;
    const rows = result.state.slots.map((sel) =>
      ix.players.find(
        (p) =>
          p.playerId === sel.playerId && p.franchiseId === sel.franchiseId && p.eraId === sel.eraId,
      ),
    );
    if (rows.some((row) => row === undefined)) return;
    const filled = rows.filter((row): row is IndexRow => row !== undefined);
    resolveRefsToPlayers(result.state.slots).then(
      () => {
        if (!mounted) return;
        slots = slots.map((current, i) => current ?? filled[i] ?? null);
        pickerPlayer = null;
      },
      () => {},
    );
  }
  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseFilter) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraFilter) ?? null);
  const eraIdentity = $derived(
    manifest && franchise && era
      ? resolveEraTeamIdentity(manifest, franchise.franchiseId, era.eraId)
      : null,
  );
  const poolRows = $derived.by(() => {
    let list = index?.players ?? [];
    if (franchiseFilter) list = list.filter((p) => p.franchiseId === franchiseFilter);
    if (eraFilter) list = list.filter((p) => p.eraId === eraFilter);
    return list;
  });
  const sortedRows = $derived(sortDraftRows(poolRows, 'sandbox'));
  const poolHeading = $derived(
    franchise && era && eraIdentity
      ? `${eraIdentity.abbreviationLabel ?? franchiseAbbreviation(franchise.franchiseId)} · ${era.label}`
      : franchise
        ? franchiseAbbreviation(franchise.franchiseId)
        : era
          ? era.label
          : 'All players',
  );
  const countLabel = $derived(`${poolRows.length} players`);
  function selectFranchise(id: string) {
    franchiseFilter = id;
  }
  function selectEra(id: string) {
    eraFilter = id;
  }
  function placePlayer(subject: IndexRow, slotIndex: number) {
    const plan = planPlayerMove(slots, subject, slotIndex);
    if (plan === null) return;
    const rowsById = new Map(
      slots
        .filter((player): player is IndexRow => player !== null)
        .concat(subject)
        .map((player) => [player.playerId, player]),
    );
    const next: (IndexRow | null)[] = [null, null, null, null, null];
    for (const placement of plan.placements) {
      const player = rowsById.get(placement.playerId);
      if (!player) return;
      next[placement.slotIndex] = player;
    }
    slots = next;
    if (manifest) {
      const entry = manifest.pools.find(
        (p) => p.franchiseId === subject.franchiseId && p.eraId === subject.eraId,
      );
      if (entry) void getPool(entry).catch(() => {});
    }
    closePicker();
  }
  function openPicker(player: IndexRow) {
    pickerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerFallbackId = pickerTrigger?.closest<HTMLElement>('[id^="court-slot-"]')?.id ?? null;
    pickerPlayer = player;
  }
  function pickSuggested(playerId: string) {
    if (starting) return;
    const row = lastVisible.find((candidate) => candidate.playerId === playerId);
    if (row) openPicker(row);
  }
  function closePicker() {
    if (!mounted) return;
    pickerPlayer = null;
    const trigger = pickerTrigger;
    const fallback = pickerFallbackId;
    pickerTrigger = null;
    pickerFallbackId = null;
    queueMicrotask(() => {
      if (!mounted) return;
      if (trigger?.isConnected) {
        trigger.focus();
      } else if (fallback) {
        document.getElementById(fallback)?.focus();
      }
    });
  }
  function removePlayer(slotIndex: number) {
    slots[slotIndex] = null;
    queueMicrotask(() => document.getElementById(`court-slot-${String(slotIndex)}`)?.focus());
  }
  const pickedCount = $derived(slots.filter((p) => p !== null).length);
  const lineupIsLegal = $derived.by(() => {
    if (slots.some((p) => p === null)) return false;
    return validateLineup({
      structure: [...LINEUP_STRUCTURE],
      assignments: slots.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player!.playerId,
        positions: player!.positionsPlayable,
      })),
    }).ok;
  });
  const ready = $derived(lineupIsLegal && manifest !== null && index !== null);
  async function resolveRefsToPlayers(refs: SlotRef[]): Promise<PeakPlayerSeason[]> {
    const m = manifest;
    if (!m) throw new Error('The manifest is unavailable.');
    return resolvePlayerRefs(refs, m);
  }
  async function play82() {
    if (!ready || !index || !manifest) return;
    starting = true;
    runError = null;
    try {
      const picked = slots.filter((p): p is IndexRow => p !== null);
      const refs = picked.map((p) => ({
        playerId: p.playerId,
        franchiseId: p.franchiseId,
        eraId: p.eraId,
      }));
      const resolved = await resolveRefsToPlayers(refs);
      if (!mounted) return;
      await startSandboxRun(resolved, runSeed ?? generateSeed());
      if (!mounted) return;
    } catch (e) {
      if (!mounted) return;
      runError = errorMessageOf(e);
      starting = false;
    }
  }
</script>

<svelte:head>
  <title>Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox</p>
      <h1
        class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
      >
        Draft any five
      </h1>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <a
        href={resolve('/')}
        class="shrink-0 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Back
      </a>
    </div>
  </div>

  {#if manifestError}
    <div class="mt-8">
      <AsyncState
        kind="error"
        title="Data unavailable"
        message="Couldn’t load data. Try again."
        retry={retrySandboxData}
      />
    </div>
  {:else if !manifest}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading players…" message="Getting rosters ready." />
    </div>
  {:else}
    {#if indexError}
      <div class="mt-8">
        <AsyncState
          kind="error"
          title="Players unavailable"
          message="Couldn’t load data. Try again."
          retry={retrySandboxData}
        />
      </div>
    {:else if !index}
      <div class="mt-8">
        <AsyncState kind="loading" title="Loading players…" message="Getting rosters ready." />
      </div>
    {:else}
      <div class="mt-10 flex flex-col gap-6 pb-32">
        <div class="rounded-xl bg-surface-1 p-3 sm:p-4">
          <RosterFilters
            {manifest}
            franchiseId={franchiseFilter}
            eraId={eraFilter}
            idPrefix="sandbox"
            franchiseLabel="Team"
            franchisePlaceholder="Any team…"
            anyFranchiseLabel="Any team"
            compact
            onSelectFranchise={selectFranchise}
            onSelectEra={selectEra}
          />
        </div>

        <DraftPoolBrowser
          heading={poolHeading}
          rows={sortedRows}
          {slots}
          {countLabel}
          {manifest}
          presentation="sandbox"
          filtersEditable
          fitByRow={pageDots}
          error={null}
          emptyMessage="No players match."
          onpick={openPicker}
          onvisible={handleVisiblePage}
        />

        {#if runError}
          <AsyncState
            kind="error"
            title="Run could not start"
            message={runError}
            retry={play82}
            retryLabel="Try again"
          />
        {/if}

        <LineupCourt
          {slots}
          {manifest}
          ready={lineupIsLegal}
          onmove={openPicker}
          onremove={removePlayer}
        />
        <DraftValuePanel
          players={resolvedDraftPlayers}
          presentation="sandbox"
          poolScores={pageScores}
          missingNeeds={pageNeeds}
          refinedCount={pageRefinedCount}
          onSuggestionPick={pickSuggested}
        />
        {#if ready}
          <div class="flex flex-col gap-3">
            <button
              type="button"
              onclick={play82}
              disabled={starting}
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {starting ? 'Starting…' : 'Play 82 games'}
              <ArrowRight class="h-4 w-4" />
            </button>
          </div>
        {/if}
      </div>

      <LineupSummaryNav {slots} {pickedCount} />
    {/if}
  {/if}

  {#if pickerPlayer}
    {#await loadSlotPickerDialog() then { default: SlotPickerDialog }}
      <p class="px-4 py-3 font-mono text-xs text-muted-foreground">Opening lineup picker…</p>
      <SlotPickerDialog
        player={pickerPlayer}
        {slots}
        manifest={manifest!}
        presentation="sandbox"
        allowDisplacement
        onplace={placePlayer}
        onclose={closePicker}
      />
    {/await}
  {/if}
</section>
