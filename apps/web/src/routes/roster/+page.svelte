<script lang="ts">
  import { resolve } from '$app/paths';
  import { onDestroy } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { ArrowRight, Check, ChevronDown, Search } from '@lucide/svelte';
  import { Select } from 'bits-ui';
  import type {
    HoopRushManifest,
    PlayersIndex,
    RosterDetails,
    RosterDetailsEntry,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import {
    clearDataLoaderCaches,
    getManifest,
    getPlayersIndex,
    getRosterDetails,
  } from '#lib/data.js';
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
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import RosterComparison from '#lib/components/RosterComparison.svelte';
  import RosterTable from '#lib/components/RosterTable.svelte';
  let playerDetailModule: Promise<
    typeof import('#lib/components/PlayerDetailDialog.svelte')
  > | null = null;
  function loadPlayerDetailDialog(): Promise<
    typeof import('#lib/components/PlayerDetailDialog.svelte')
  > {
    playerDetailModule ??= import('#lib/components/PlayerDetailDialog.svelte');
    return playerDetailModule;
  }
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
    manifest = null;
    index = null;
    details = null;
    const current = () => generation === dataGeneration;
    getManifest().then(
      (m) => {
        if (current()) manifest = m;
      },
      (error: unknown) => {
        if (current()) manifestError = error instanceof Error ? error.message : String(error);
      },
    );
    getPlayersIndex().then(
      (ix) => {
        if (current()) index = ix;
      },
      (error: unknown) => {
        if (current()) indexError = error instanceof Error ? error.message : String(error);
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
        detailsError = error instanceof Error ? error.message : String(error);
        detailsLoading = false;
        detailsRequest = null;
      },
    );
    detailsRequest = request;
    return request;
  }
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
  const franchiseItems = $derived([
    { value: '', label: 'Any franchise' },
    ...(manifest?.modernFranchiseSlots ?? []).map((entry) => ({
      value: entry.franchiseId,
      label: entry.displayName,
    })),
  ]);
  const eraItems = $derived([
    { value: '', label: 'Any decade' },
    ...(manifest?.eras ?? []).map((e) => ({
      value: e.eraId,
      label: e.label,
    })),
  ]);
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
  const dialogPlayer = $derived(dialogKey === null ? null : (rowsByKey.get(dialogKey) ?? null));
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
  const columns: RosterColumn[] = [
    { key: 'player', label: 'Player', sort: 'name' },
    { key: 'pos', label: 'Pos', sort: 'position', hideBelow: 'md' },
    { key: 'decade', label: 'Decade', sort: 'decade', hideBelow: 'lg' },
    { key: 'season', label: 'Season', sort: 'season', hideBelow: 'md' },
    { key: 'overall', label: 'O', sort: 'overall', numeric: true },
    { key: 'games', label: 'Games', numeric: true },
    { key: 'usage', label: 'USG%', numeric: true },
    { key: 'points', label: 'PTS', sort: 'points', numeric: true },
    { key: 'rebounds', label: 'REB', hideBelow: 'lg', numeric: true },
    { key: 'assists', label: 'AST', hideBelow: 'lg', numeric: true },
    { key: 'ts', label: 'TS%', hideBelow: 'lg', numeric: true },
    { key: 'per', label: 'PER', sort: 'per', hideBelow: 'lg', numeric: true },
  ];
</script>

<svelte:head>
  <title>Roster — Hoop Rush</title>
</svelte:head>

<section
  class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10 {compareSelection.length > 0
    ? 'pb-40 md:pb-10'
    : 'pb-24 md:pb-10'}"
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
      <AsyncState
        kind="error"
        title="Data unavailable"
        message="Couldn’t load data. Try again."
        retry={retryRosterData}
      />
    </div>
  {:else if !manifest}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading…" message="Loading…" />
    </div>
  {:else}
    <div class="mt-8 grid gap-6 sm:grid-cols-2">
      <div>
        <h2
          id="roster-franchise-label"
          class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
        >
          Franchise
        </h2>
        <Select.Root
          type="single"
          value={franchiseId}
          onValueChange={selectFranchise}
          items={franchiseItems}
        >
          <Select.Trigger
            aria-labelledby="roster-franchise-label"
            class="mt-3 flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Select.Value placeholder="Any franchise…">
              {#snippet children(props)}
                {#if franchise}
                  <span class="flex min-w-0 items-center gap-2.5">
                    <TeamLogo
                      manifest={manifest!}
                      franchiseId={franchise.franchiseId}
                      teamExternalId={franchise.teamExternalId}
                      logoCandidates={eraIdentity?.logoCandidates ?? []}
                    />
                    <span
                      class="truncate"
                      title={eraIdentity?.displayLabel ?? franchise.displayName}
                    >
                      {eraIdentity?.abbreviationLabel ??
                        franchiseAbbreviation(franchise.franchiseId)}
                    </span>
                  </span>
                {:else}
                  <span class="font-normal text-muted-foreground">{props.placeholder}</span>
                {/if}
              {/snippet}
            </Select.Value>
            <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              side="bottom"
              sideOffset={6}
              align="start"
              collisionPadding={12}
              class="z-50 min-w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/30"
            >
              <Select.Viewport
                class="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-0.5"
              >
                <Select.Item
                  value=""
                  label="Any franchise"
                  aria-label="Any franchise"
                  class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                >
                  {#snippet children({ selected })}
                    <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                      <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                        Any franchise
                      </span>
                      {#if selected}
                        <Check class="h-4 w-4 shrink-0 text-primary" />
                      {/if}
                    </span>
                  {/snippet}
                </Select.Item>
                {#each manifest.modernFranchiseSlots as entry (entry.franchiseId)}
                  <Select.Item
                    value={entry.franchiseId}
                    label={entry.displayName}
                    aria-label={`${franchiseAbbreviation(entry.franchiseId)} — ${entry.displayName}`}
                    class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                  >
                    {#snippet children({ selected })}
                      <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                        <TeamLogo
                          manifest={manifest!}
                          franchiseId={entry.franchiseId}
                          teamExternalId={entry.teamExternalId}
                        />
                        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                          {franchiseAbbreviation(entry.franchiseId)}
                        </span>
                        {#if selected}
                          <Check class="h-4 w-4 shrink-0 text-primary" />
                        {/if}
                      </span>
                    {/snippet}
                  </Select.Item>
                {/each}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div>
        <h2
          id="roster-decade-label"
          class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
        >
          Decade
        </h2>

        <Select.Root type="single" value={eraId} onValueChange={selectEra} items={eraItems}>
          <Select.Trigger
            aria-labelledby="roster-decade-label"
            class="mt-3 flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Select.Value placeholder="Any decade…">
              {#snippet children(props)}
                {#if era}
                  <span class="truncate font-mono">{era.label}</span>
                {:else}
                  <span class="font-normal text-muted-foreground">{props.placeholder}</span>
                {/if}
              {/snippet}
            </Select.Value>
            <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              side="bottom"
              sideOffset={6}
              align="start"
              collisionPadding={12}
              class="z-50 min-w-48 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/30"
            >
              <Select.Viewport
                class="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-0.5"
              >
                <Select.Item
                  value=""
                  label="Any decade"
                  aria-label="Any decade"
                  class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                >
                  {#snippet children({ selected })}
                    <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                      <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                        Any decade
                      </span>
                      {#if selected}
                        <Check class="h-4 w-4 shrink-0 text-primary" />
                      {/if}
                    </span>
                  {/snippet}
                </Select.Item>
                {#each manifest.eras as e (e.eraId)}
                  <Select.Item
                    value={e.eraId}
                    label={e.label}
                    class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                  >
                    {#snippet children({ selected })}
                      <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                        <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                          {e.label}
                        </span>
                        {#if selected}
                          <Check class="h-4 w-4 shrink-0 text-primary" />
                        {/if}
                      </span>
                    {/snippet}
                  </Select.Item>
                {/each}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>
    </div>

    {#if indexError || detailsError}
      <div class="mt-8">
        <AsyncState
          kind="error"
          title="Players unavailable"
          message={`Failed to load players: ${indexError ?? detailsError}`}
          retry={retryRosterData}
        />
      </div>
    {:else if !index || !details}
      <div class="mt-8">
        <AsyncState kind="loading" title="Loading players…" message="Getting rosters ready." />
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
              <AsyncState
                kind="loading"
                title="Loading player stats…"
                message="This sort needs detailed stats."
              />
            {:else}
              <AsyncState
                kind="error"
                title="Player stats unavailable"
                message={detailsError ?? 'Detailed stats could not load.'}
                retry={() => void ensureDetails()}
              />
            {/if}
          </div>
        {:else if filteredRows.length === 0}
          <p class="p-6 text-center font-mono text-xs text-muted-foreground">No players match.</p>
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

  {#if dialogPlayer}
    {#await loadPlayerDetailDialog() then { default: PlayerDetailDialog }}
      <p class="px-4 py-3 font-mono text-xs text-muted-foreground">Opening player details…</p>
      <PlayerDetailDialog
        player={dialogPlayer}
        manifest={manifest!}
        {franchiseName}
        {eraLabel}
        onClose={closePlayer}
        {detailsError}
        onRetry={() => void ensureDetails()}
      />
    {/await}
  {/if}
</section>
