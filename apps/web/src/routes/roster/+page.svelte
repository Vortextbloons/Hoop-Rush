<script lang="ts">
  import { resolve } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { ArrowRight, Search } from '@lucide/svelte';
  import type {
    HoopRushManifest,
    PlayoffPerformance,
    PlayersIndex,
    RosterDetails,
    RosterDetailsEntry,
    SeasonPlayoffProfiles,
  } from '@hoop-rush/data-contracts';
  import {
    franchiseAbbreviation,
    playerVersionId,
    resolveEraTeamIdentity,
  } from '@hoop-rush/data-contracts';
  import {
    clearDataLoaderCaches,
    getManifest,
    getPlayersIndex,
    getRosterDetails,
  } from '#lib/data.js';
  import { loadPlayoffProfiles } from '#lib/data-assets.js';
  import { errorMessageOf } from '#lib/errors.js';
  import { LITE_TOGGLE_EVENT, deferIdle, isLiteMode } from '#lib/device-capabilities.js';
  import { DETAILED_POSITIONS } from '#lib/player-positions.js';
  import {
    defaultDirection,
    filterRoster,
    paginateGroupedRows,
    sortNeedsDetails,
    sortRoster,
    type RosterColumn,
    type RosterListItem,
    type RosterRow,
    type RosterSortDirection,
    type RosterSortId,
  } from '#lib/roster-browser.js';
  import RosterFilters from '#lib/components/RosterFilters.svelte';

  import RosterComparison from '#lib/components/RosterComparison.svelte';
  import RosterTable from '#lib/components/RosterTable.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import PlayerProfileSheet from '#lib/components/PlayerProfileSheet.svelte';
  import type { ProfileTab } from '#lib/components/PlayerProfileSheet.svelte';
  import {
    buildPlayerProfile,
    buildPlayerProfileReferences,
    type PlayerProfileReferences,
  } from '#lib/players/player-profile.js';
  import { rosterProfileInput, rosterProfileSamples } from '#lib/players/roster-profile.js';
  import { teamLabelFor } from '#lib/branding.js';
  import { ZERO_RATINGS, ZERO_TENDENCIES } from '#lib/players/player-profile.js';
  type IndexRow = RosterRow;
  const SORT_OPTIONS: {
    id: RosterSortId;
    label: string;
  }[] = [
    { id: 'none', label: 'None' },
    { id: 'name', label: 'Name' },
    { id: 'overall', label: 'Overall' },
    { id: 'offense', label: 'Offense' },
    { id: 'defense', label: 'Defense' },
    { id: 'points', label: 'Points' },
    { id: 'per', label: 'PER' },
    { id: 'season', label: 'Season' },
    { id: 'decade', label: 'Decade' },
    { id: 'team', label: 'Team' },
    { id: 'position', label: 'Position' },
  ];
  const POSITION_OPTIONS = DETAILED_POSITIONS;
  const DEFAULT_PAGE_SIZE = 120;
  const LITE_PAGE_SIZE = 60;
  const SEARCH_DEBOUNCE_MS = 150;
  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);
  let details = $state.raw<RosterDetails | null>(null);
  let detailsError: string | null = $state(null);
  let detailsLoading = $state(false);
  let playoffProfiles = $state.raw<SeasonPlayoffProfiles | null>(null);
  let liteActive = $state(false);
  const pageSize = $derived(liteActive ? LITE_PAGE_SIZE : DEFAULT_PAGE_SIZE);
  let franchiseId = $state('');
  let eraId = $state('');
  let positionFilter = $state<'PG' | 'SG' | 'SF' | 'PF' | 'C' | null>(null);
  let searchInput = $state('');
  let search = $state('');
  let sortId = $state<RosterSortId>('none');
  let sortDir = $state<RosterSortDirection>('asc');
  let visibleCount = $state(DEFAULT_PAGE_SIZE);
  let dialogKey = $state<string | null>(null);
  let compareKeys = $state<string[]>([]);
  let detailsRequest: Promise<void> | null = null;
  let playoffProfilesRequest: Promise<void> | null = null;
  let dataGeneration = 0;
  $effect(() => {
    const syncLite = () => {
      liteActive = isLiteMode();
    };
    syncLite();
    window.addEventListener(LITE_TOGGLE_EVENT, syncLite);
    return () => window.removeEventListener(LITE_TOGGLE_EVENT, syncLite);
  });
  $effect(() => {
    const raw = searchInput;
    const timeout = setTimeout(() => {
      search = raw;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  });
  function rowKey(entry: {
    playerId: string;
    franchiseId: string;
    eraId: string;
    seasonKey: string;
  }): string {
    return `${entry.playerId}/${entry.franchiseId}/${entry.eraId}/${entry.seasonKey}`;
  }
  function loadRosterData() {
    const generation = (dataGeneration += 1);
    manifestError = null;
    indexError = null;
    detailsError = null;
    detailsLoading = false;
    detailsRequest = null;
    playoffProfilesRequest = null;
    manifest = null;
    index = null;
    details = null;
    playoffProfiles = null;
    const current = () => generation === dataGeneration;
    getManifest().then(
      (m) => {
        if (current()) manifest = m;
      },
      (error: unknown) => {
        if (current()) manifestError = errorMessageOf(error);
      },
    );
    getPlayersIndex().then(
      (ix) => {
        if (current()) index = ix;
      },
      (error: unknown) => {
        if (current()) indexError = errorMessageOf(error);
      },
    );
  }
  function ensureDetails(): Promise<void> {
    if (details !== null) return Promise.resolve();
    if (detailsRequest !== null) return detailsRequest;
    const generation = dataGeneration;
    detailsLoading = true;
    detailsError = null;
    const request = getRosterDetails().then(
      (det) => {
        if (generation !== dataGeneration) return;
        details = det;
        detailsLoading = false;
        detailsRequest = null;
      },
      (error: unknown) => {
        if (generation !== dataGeneration) return;
        detailsError = errorMessageOf(error);
        detailsLoading = false;
        detailsRequest = null;
      },
    );
    detailsRequest = request;
    return request;
  }
  function ensurePlayoffProfiles(): Promise<void> {
    if (playoffProfiles !== null || manifest?.rosterDetails?.playoffProfilesSplit !== true) {
      return Promise.resolve();
    }
    if (playoffProfilesRequest !== null) return playoffProfilesRequest;
    const generation = dataGeneration;
    const request = loadPlayoffProfiles(manifest).then(
      (profiles) => {
        if (generation !== dataGeneration) return;
        playoffProfiles = profiles;
        playoffProfilesRequest = null;
      },
      () => {
        if (generation !== dataGeneration) return;
        // Postseason evidence is optional; the sheet simply omits the section.
        playoffProfilesRequest = null;
      },
    );
    playoffProfilesRequest = request;
    return request;
  }
  $effect(() => {
    if (dialogKey !== null && playoffProfiles === null) void ensurePlayoffProfiles();
  });
  $effect(() => {
    if (!manifest || !index || details !== null || detailsRequest !== null) return;
    let cancelled = false;
    deferIdle(() => {
      if (!cancelled) void ensureDetails();
    }, 250);
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    if (dialogKey !== null && details === null) void ensureDetails();
  });
  $effect(() => {
    if (compareKeys.length >= 2 && details === null) void ensureDetails();
  });
  $effect(() => loadRosterData());
  function retryRosterData() {
    clearDataLoaderCaches();
    loadRosterData();
  }
  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseId) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraId) ?? null);
  const eraLabel = $derived(new SvelteMap((manifest?.eras ?? []).map((e) => [e.eraId, e.label])));
  const franchiseName = $derived(
    new SvelteMap(
      (manifest?.modernFranchiseSlots ?? []).map((e) => [e.franchiseId, e.displayName]),
    ),
  );
  const detailsByKey = $derived.by(() => {
    const byKey = new Map<string, RosterDetailsEntry>();
    if (details) {
      for (const entry of details.players) byKey.set(rowKey(entry), entry);
    }
    return byKey;
  });
  const rosterRows = $derived.by((): IndexRow[] => {
    if (!index) return [];
    const byKey = detailsByKey;
    return index.players.map((player) => ({
      ...player,
      detail: byKey.get(rowKey(player)) ?? null,
    }));
  });
  const filteredRows = $derived.by(() => {
    return filterRoster(rosterRows, {
      franchiseId: franchiseId || null,
      eraId: eraId || null,
      position: positionFilter,
      query: search,
    });
  });
  const sortedRows = $derived.by(() => {
    if (sortNeedsDetails(sortId) && details === null) return [];
    return sortRoster(filteredRows, sortId, sortDir);
  });
  const visibleItems = $derived.by((): RosterListItem<IndexRow>[] => {
    if (sortId !== 'none') {
      return sortedRows.slice(0, visibleCount).map((player) => ({ type: 'player', player }));
    }
    return paginateGroupedRows(sortedRows, visibleCount);
  });
  const hasMore = $derived(filteredRows.length > visibleCount);
  const visiblePlayers = $derived(Math.min(visibleCount, filteredRows.length));
  $effect(() => {
    void [franchiseId, eraId, positionFilter, search, sortId, sortDir, pageSize];
    visibleCount = pageSize;
  });
  function selectFranchise(id: string) {
    franchiseId = id;
  }
  function selectEra(id: string) {
    eraId = id;
  }
  function chooseSort(id: RosterSortId) {
    if (sortNeedsDetails(id) && details === null) void ensureDetails();
    if (id === sortId && id !== 'none') {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortId = id;
    sortDir = defaultDirection(id);
  }
  const rowsByKey = $derived(new Map(rosterRows.map((row) => [comparisonKey(row), row] as const)));
  const playoffByVersionId = $derived.by(() => {
    const byVersion = new Map<string, PlayoffPerformance>();
    for (const profile of playoffProfiles?.profiles ?? []) {
      byVersion.set(profile.playerVersionId, profile.playoffPerformance);
    }
    return byVersion;
  });
  function playoffPerformanceFor(row: IndexRow | null): PlayoffPerformance | null {
    if (!row) return null;
    if (row.detail?.playoffPerformance !== undefined) return row.detail.playoffPerformance;
    return (
      playoffByVersionId.get(
        playerVersionId(row.playerId, row.franchiseId, row.eraId, row.seasonKey),
      ) ?? null
    );
  }
  const dialogPlayer = $derived(dialogKey === null ? null : (rowsByKey.get(dialogKey) ?? null));

  /**
   * Percentile cohorts for the whole roster, built once when details arrive so a
   * row opened later does not pay the cost of sorting 8k players.
   */
  const profileReferences = $derived.by((): PlayerProfileReferences | null => {
    if (rosterRows.length === 0) return null;
    if (!rosterRows.some((row) => row.detail?.ratings !== undefined)) return null;
    return buildPlayerProfileReferences(rosterProfileSamples(rosterRows));
  });

  const dialogProfile = $derived.by(() => {
    const row = dialogPlayer;
    if (row === null || profileReferences === null) return null;
    const input = rosterProfileInput(
      {
        ...row,
        playoffPerformance: playoffPerformanceFor(row),
      },
      teamLabelFor(manifest!, row.franchiseId, row.eraId),
    );
    if (input === null) return null;
    return buildPlayerProfile(
      input,
      profileReferences.forSlot(row.positionsPlayable[0] ?? '') ?? null,
    );
  });

  let dialogTab = $state<ProfileTab>('details');

  /**
   * Identity-only fallback while details are still loading, or when the artifact
   * predates ratings. Keeps the header accurate instead of showing a blank sheet.
   */
  function identityProfileInput(row: IndexRow) {
    return {
      displayName: row.displayName,
      franchiseLabel: teamLabelFor(manifest!, row.franchiseId, row.eraId),
      seasonKey: row.seasonKey,
      positions: row.positionsPlayable,
      heightInches: row.detail?.heightInches ?? null,
      weightLbs: row.detail?.weightLbs ?? null,
      overall: row.overall,
      offense: row.offense,
      defense: row.defense,
      ratings: ZERO_RATINGS,
      tendencies: ZERO_TENDENCIES,
      anchors: null,
      stats: null,
      slot: row.positionsPlayable[0] ?? null,
    };
  }

  const compareSelection = $derived(
    compareKeys
      .map((key) => rowsByKey.get(key))
      .filter((row): row is IndexRow => row !== undefined),
  );
  function openPlayer(player: IndexRow) {
    dialogKey = comparisonKey(player);
  }
  function closePlayer() {
    dialogKey = null;
  }
  function toggleCompare(player: IndexRow) {
    const key = comparisonKey(player);
    if (compareKeys.includes(key)) {
      compareKeys = compareKeys.filter((entry) => entry !== key);
      return;
    }
    if (compareKeys.length < 2) compareKeys = [...compareKeys, key];
  }
  function comparisonKey(player: IndexRow): string {
    return `${player.franchiseId}/${player.eraId}/${player.playerId}`;
  }
  function isCompared(player: IndexRow): boolean {
    return compareKeys.includes(comparisonKey(player));
  }
  function removeCompare(key: string) {
    compareKeys = compareKeys.filter((entry) => entry !== key);
  }
  function clearCompare() {
    compareKeys = [];
  }
  onDestroy(clearCompare);
  const eraIdentity = $derived(
    manifest && franchise && era
      ? resolveEraTeamIdentity(manifest, franchise.franchiseId, era.eraId)
      : null,
  );
  const poolHeading = $derived(
    franchise && era && eraIdentity
      ? `${eraIdentity.abbreviationLabel ?? franchiseAbbreviation(franchise.franchiseId)} · ${era.label}`
      : franchise
        ? franchiseAbbreviation(franchise.franchiseId)
        : era
          ? era.label
          : 'All players',
  );
  const columns = $derived.by((): RosterColumn[] => {
    const cols: RosterColumn[] = [{ key: 'player', label: 'Player', sort: 'name' }];
    if (!positionFilter) {
      cols.push({ key: 'pos', label: 'Pos', sort: 'position', hideBelow: 'md' });
    }
    if (!eraId) {
      cols.push({ key: 'decade', label: 'Decade', sort: 'decade', hideBelow: 'lg' });
    }
    cols.push(
      { key: 'season', label: 'Season', sort: 'season', hideBelow: 'md' },
      { key: 'games', label: 'Games', numeric: true },
      { key: 'usage', label: 'USG%', numeric: true },
      { key: 'points', label: 'PTS', sort: 'points', numeric: true },
      { key: 'rebounds', label: 'REB', hideBelow: 'lg', numeric: true },
      { key: 'assists', label: 'AST', hideBelow: 'lg', numeric: true },
      { key: 'ts', label: 'TS%', hideBelow: 'lg', numeric: true },
      { key: 'per', label: 'PER', sort: 'per', hideBelow: 'lg', numeric: true },
    );
    return cols;
  });
</script>

<svelte:head>
  <title>Roster — Hoop Rush</title>
</svelte:head>

<PageShell
  as="section"
  width="xl"
  padding="lg"
  class={compareSelection.length > 0 ? 'pb-40 md:pb-10' : 'pb-24 md:pb-10'}
>
  <div class="flex items-end justify-between gap-4">
    <div>
      <h1
        class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
      >
        Player database
      </h1>
    </div>
    <a
      href={resolve('sandbox/')}
      class="hidden shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline sm:inline-flex"
    >
      Draft a lineup <ArrowRight class="h-3.5 w-3.5" />
    </a>
  </div>

  {#if manifestError}
    <div class="mt-8">
      <EmptyState
        kind="error"
        title="Data unavailable"
        message="Couldn’t load data. Try again."
        retry={retryRosterData}
      />
    </div>
  {:else if !manifest}
    <div class="mt-8">
      <EmptyState kind="loading" title="Loading…" message="Loading…" />
    </div>
  {:else}
    <div class="mt-8">
      <RosterFilters
        {manifest}
        {franchiseId}
        {eraId}
        idPrefix="roster"
        onSelectFranchise={selectFranchise}
        onSelectEra={selectEra}
      />
    </div>

    {#if indexError || detailsError}
      <div class="mt-8">
        <EmptyState
          kind="error"
          title="Players unavailable"
          message={`Failed to load players: ${indexError ?? detailsError}`}
          retry={retryRosterData}
        />
      </div>
    {:else if !index}
      <div class="mt-8">
        <EmptyState kind="loading" title="Loading players…" message="Getting rosters ready." />
      </div>
    {:else}
      <div class="mt-8 flex flex-col gap-4 rounded-xl bg-surface-1 p-2 sm:p-3">
        <div class="flex flex-col gap-2">
          <div class="relative">
            <Search
              class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              bind:value={searchInput}
              placeholder="Search players…"
              aria-label="Search players by name"
              class="h-11 w-full rounded-lg bg-surface-2 pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div
            class="flex items-center gap-1 overflow-x-auto pb-0.5"
            role="group"
            aria-label="Filter by position"
          >
            <button
              type="button"
              aria-pressed={positionFilter === null}
              onclick={() => (positionFilter = null)}
              class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
              null
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
            >
              All
            </button>
            {#each POSITION_OPTIONS as pos (pos)}
              <button
                type="button"
                aria-pressed={positionFilter === pos}
                onclick={() => (positionFilter = positionFilter === pos ? null : pos)}
                class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
                pos
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
              >
                {pos}
              </button>
            {/each}
            <span class="ml-auto shrink-0 pl-1 text-xs text-muted-foreground">
              {filteredRows.length.toLocaleString()} players
            </span>
          </div>
          <div
            class="flex items-center gap-1 overflow-x-auto pb-0.5"
            role="group"
            aria-label="Sort players"
          >
            <span class="text-label shrink-0 pr-1 text-muted-foreground">Sort</span>
            {#each SORT_OPTIONS as opt (opt.id)}
              <button
                type="button"
                aria-pressed={sortId === opt.id}
                onclick={() => chooseSort(opt.id)}
                class="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {sortId ===
                opt.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
              >
                {opt.label}
              </button>
            {/each}
            {#if sortId !== 'none'}
              <button
                type="button"
                onclick={() => chooseSort(sortId)}
                aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                class="shrink-0 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs font-bold text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3"
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            {/if}
          </div>
        </div>

        {#if detailsError}
          <div
            class="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <p class="text-xs text-destructive">
              Detailed stats unavailable. Basic player info is still available.
            </p>
            <button
              type="button"
              onclick={() => void ensureDetails()}
              class="self-start rounded-md border border-destructive/40 px-3 py-1.5 font-mono text-xs font-bold text-destructive outline-none transition-colors hover:border-destructive focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
            >
              Retry
            </button>
          </div>
        {/if}

        {#if sortNeedsDetails(sortId) && details === null}
          <div class="p-2">
            {#if detailsLoading}
              <EmptyState
                kind="loading"
                title="Loading player stats…"
                message="This sort needs detailed stats."
              />
            {:else}
              <EmptyState
                kind="error"
                title="Player stats unavailable"
                message={detailsError ?? 'Detailed stats could not load.'}
                retry={() => void ensureDetails()}
              />
            {/if}
          </div>
        {:else if filteredRows.length === 0}
          <EmptyState class="p-6" title="No players match" surface="none" />
        {:else}
          <RosterTable
            items={visibleItems}
            {columns}
            {sortId}
            {sortDir}
            {eraLabel}
            manifest={manifest!}
            heading={poolHeading}
            {hasMore}
            {visiblePlayers}
            filteredCount={filteredRows.length}
            onSort={chooseSort}
            onOpen={openPlayer}
            {isCompared}
            onToggleCompare={toggleCompare}
            compareFull={compareSelection.length >= 2}
            onShowMore={() => (visibleCount += pageSize)}
            moreLabel={`Show ${pageSize} more`}
            filterFranchiseId={franchiseId}
            filterEraId={eraId}
            filterPosition={positionFilter}
          />
        {/if}
      </div>
    {/if}
  {/if}

  {#if manifest && compareSelection.length > 0}
    <RosterComparison
      selected={compareSelection}
      {manifest}
      {franchiseName}
      {eraLabel}
      oncompare={toggleCompare}
      onremove={removeCompare}
      onclear={clearCompare}
      {detailsError}
      onRetry={() => void ensureDetails()}
    />
  {/if}

  {#if dialogProfile}
    <PlayerProfileSheet
      profile={dialogProfile}
      face={dialogPlayer}
      {manifest}
      tabs={['details', 'production', 'tendencies', 'ratings']}
      bind:tab={dialogTab}
      open
      onOpenChange={(next) => {
        if (!next) closePlayer();
      }}
    />
  {:else if dialogPlayer}
    <PlayerProfileSheet
      profile={buildPlayerProfile(identityProfileInput(dialogPlayer), null)}
      face={dialogPlayer}
      {manifest}
      bind:tab={dialogTab}
      open
      onOpenChange={(next) => {
        if (!next) closePlayer();
      }}
    />
  {/if}
</PageShell>
