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
  import { clearDataLoaderCaches, getManifest, getPlayersIndex, getRosterDetails } from '$lib/data';
  import { DETAILED_POSITIONS } from '$lib/player-positions';
  import {
    defaultDirection,
    filterRoster,
    paginateGroupedRows,
    sortRoster,
    type RosterColumn,
    type RosterDetailRow,
    type RosterListItem,
    type RosterSortDirection,
    type RosterSortId,
  } from '$lib/roster-browser';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import RosterComparison from '$lib/components/RosterComparison.svelte';
  import RosterTable from '$lib/components/RosterTable.svelte';

  /** The player-detail dialog chunk loads only when a roster player is selected. */
  let playerDetailModule: Promise<
    typeof import('$lib/components/PlayerDetailDialog.svelte')
  > | null = null;
  function loadPlayerDetailDialog(): Promise<
    typeof import('$lib/components/PlayerDetailDialog.svelte')
  > {
    playerDetailModule ??= import('$lib/components/PlayerDetailDialog.svelte');
    return playerDetailModule;
  }

  type IndexRow = RosterDetailRow;

  const SORT_OPTIONS: { id: RosterSortId; label: string }[] = [
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
  const PAGE_SIZE = 120;

  /** Typing delay before the filter/sort pipeline re-runs on the full index. */
  const SEARCH_DEBOUNCE_MS = 80;

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);
  let details = $state.raw<RosterDetails | null>(null);
  let detailsError: string | null = $state(null);

  let franchiseId = $state('');
  let eraId = $state('');
  let positionFilter = $state<'PG' | 'SG' | 'SF' | 'PF' | 'C' | null>(null);
  /** Raw input value; `search` below is the debounced query the pipeline reads. */
  let searchInput = $state('');
  let search = $state('');
  let sortId = $state<RosterSortId>('none');
  let sortDir = $state<RosterSortDirection>('asc');
  let visibleCount = $state(PAGE_SIZE);
  let dialogPlayer = $state<IndexRow | null>(null);
  let compareSelection = $state<IndexRow[]>([]);

  $effect(() => {
    const raw = searchInput;
    const timeout = setTimeout(() => {
      search = raw;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  });

  function loadRosterData() {
    manifestError = null;
    indexError = null;
    detailsError = null;
    manifest = null;
    index = null;
    details = null;
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
        getPlayersIndex().then(
          (ix) => {
            if (cancelled) return;
            index = ix;
          },
          (error: unknown) => {
            if (!cancelled) indexError = error instanceof Error ? error.message : String(error);
          },
        );
        getRosterDetails().then(
          (det) => {
            if (cancelled) return;
            details = det;
          },
          (error: unknown) => {
            if (!cancelled) detailsError = error instanceof Error ? error.message : String(error);
          },
        );
      },
      (error: unknown) => {
        if (!cancelled) manifestError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }

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

  const rosterRows = $derived.by((): IndexRow[] => {
    if (!index || !details) return [];
    const byKey = new SvelteMap<string, RosterDetailsEntry>();
    for (const entry of details.players) {
      byKey.set(`${entry.playerId}/${entry.franchiseId}/${entry.eraId}/${entry.seasonKey}`, entry);
    }
    const rows: IndexRow[] = [];
    for (const player of index.players) {
      const detail = byKey.get(
        `${player.playerId}/${player.franchiseId}/${player.eraId}/${player.seasonKey}`,
      );
      if (!detail) continue;
      rows.push({ ...player, ...detail });
    }
    return rows;
  });

  const filteredRows = $derived.by(() => {
    return filterRoster(rosterRows, {
      franchiseId: franchiseId || null,
      eraId: eraId || null,
      position: positionFilter,
      query: search,
    });
  });

  const sortedRows = $derived.by(() => sortRoster(filteredRows, sortId, sortDir));

  const visibleItems = $derived.by((): RosterListItem<IndexRow>[] => {
    if (sortId !== 'none') {
      return sortedRows.slice(0, visibleCount).map((player) => ({ type: 'player', player }));
    }
    return paginateGroupedRows(sortedRows, visibleCount);
  });
  const hasMore = $derived(filteredRows.length > visibleCount);
  const visiblePlayers = $derived(Math.min(visibleCount, filteredRows.length));

  // Reset pagination whenever the scope or ordering changes.
  $effect(() => {
    void [franchiseId, eraId, positionFilter, search, sortId, sortDir];
    visibleCount = PAGE_SIZE;
  });

  function selectFranchise(id: string) {
    franchiseId = id;
  }

  function selectEra(id: string) {
    eraId = id;
  }

  function chooseSort(id: RosterSortId) {
    if (id === sortId && id !== 'none') {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortId = id;
    sortDir = defaultDirection(id);
  }

  function openPlayer(player: IndexRow) {
    dialogPlayer = player;
  }

  function closePlayer() {
    dialogPlayer = null;
  }

  function toggleCompare(player: IndexRow) {
    const existing = compareSelection.findIndex(
      (entry) => comparisonKey(entry) === comparisonKey(player),
    );
    if (existing >= 0) {
      compareSelection = compareSelection.filter(
        (entry) => comparisonKey(entry) !== comparisonKey(player),
      );
      return;
    }
    if (compareSelection.length < 2) compareSelection = [...compareSelection, player];
  }

  function comparisonKey(player: IndexRow): string {
    return `${player.franchiseId}/${player.eraId}/${player.playerId}`;
  }

  function isCompared(player: IndexRow): boolean {
    return compareSelection.some((entry) => comparisonKey(entry) === comparisonKey(player));
  }

  function removeCompare(key: string) {
    compareSelection = compareSelection.filter((entry) => comparisonKey(entry) !== key);
  }

  function clearCompare() {
    compareSelection = [];
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
    : ''}"
>
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Roster</p>
      <h1
        class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
      >
        Player database
      </h1>
      <p class="mt-3 max-w-xl text-sm text-muted-foreground">
        Every eligible peak player-season in the league. Browse by franchise, decade, rating, and
        stats — then take your favorites to the sandbox.
      </p>
    </div>
    <a
      href={resolve('/sandbox')}
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
        message={`Failed to load data: ${manifestError}`}
        retry={retryRosterData}
      />
    </div>
  {:else if !manifest}
    <div class="mt-8">
      <AsyncState
        kind="loading"
        title="Loading roster data"
        message="Preparing the player index…"
      />
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
        <AsyncState kind="loading" title="Loading player index" message="One moment…" />
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

        {#if filteredRows.length === 0}
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
            onShowMore={() => (visibleCount += PAGE_SIZE)}
            moreLabel={`Show ${PAGE_SIZE} more`}
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
    />
  {/if}

  {#if dialogPlayer}
    {#await loadPlayerDetailDialog() then { default: PlayerDetailDialog }}
      <p class="px-4 py-3 font-mono text-xs text-muted-foreground">Loading…</p>
      <PlayerDetailDialog
        player={dialogPlayer}
        manifest={manifest!}
        {franchiseName}
        {eraLabel}
        onClose={closePlayer}
      />
    {/await}
  {/if}
</section>
