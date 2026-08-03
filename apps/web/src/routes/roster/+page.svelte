<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, ChevronDown, Search, X } from '@lucide/svelte';
  import { Dialog, Select } from 'bits-ui';
  import type {
    HoopRushManifest,
    PlayersIndex,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import {
    defaultDirection,
    filterRoster,
    formatDecimal,
    formatPct,
    formatPerGame,
    groupRoster,
    paginateItems,
    perGame,
    shotPct,
    sortRoster,
    type RosterSortDirection,
    type RosterSortId,
  } from '$lib/roster-browser';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  type IndexRow = PlayersIndexEntry;

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

  const POSITION_OPTIONS = ['G', 'F', 'C'] as const;
  const PAGE_SIZE = 120;

  /** Typing delay before the filter/sort pipeline re-runs on the full index. */
  const SEARCH_DEBOUNCE_MS = 200;

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);

  let franchiseId = $state('');
  let eraId = $state('');
  let positionFilter = $state<'G' | 'F' | 'C' | null>(null);
  /** Raw input value; `search` below is the debounced query the pipeline reads. */
  let searchInput = $state('');
  let search = $state('');
  let sortId = $state<RosterSortId>('none');
  let sortDir = $state<RosterSortDirection>('asc');
  let visibleCount = $state(PAGE_SIZE);
  let dialogPlayer = $state<IndexRow | null>(null);

  $effect(() => {
    const raw = searchInput;
    const timeout = setTimeout(() => {
      search = raw;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  });

  $effect(() => {
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
      },
      (error: unknown) => {
        if (!cancelled) manifestError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
    };
  });

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

  const eraLabel = $derived(new Map((manifest?.eras ?? []).map((e) => [e.eraId, e.label])));

  const franchiseName = $derived(
    new Map((manifest?.modernFranchiseSlots ?? []).map((e) => [e.franchiseId, e.displayName])),
  );

  const filteredRows = $derived.by(() => {
    if (!index) return [] as IndexRow[];
    return filterRoster(index.players, {
      franchiseId: franchiseId || null,
      eraId: eraId || null,
      position: positionFilter,
      query: search,
    });
  });

  const sortedRows = $derived.by(() => sortRoster(filteredRows, sortId, sortDir));

  type RosterListItem =
    | { type: 'group'; franchiseId: string; eraId: string; count: number }
    | { type: 'player'; player: IndexRow };

  /** Flat list of group headers and players; groups only in 'none' order. */
  const listItems = $derived.by((): RosterListItem[] => {
    if (sortId !== 'none') {
      return sortedRows.map((player) => ({ type: 'player', player }));
    }
    return groupRoster(sortedRows).flatMap((group): RosterListItem[] => [
      {
        type: 'group',
        franchiseId: group.franchiseId,
        eraId: group.eraId,
        count: group.players.length,
      },
      ...group.players.map((player): RosterListItem => ({ type: 'player', player })),
    ]);
  });

  const visibleItems = $derived(paginateItems(listItems, visibleCount));
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

  /** Applies a sort mode, toggling direction when the mode is already active. */
  function chooseSort(id: RosterSortId) {
    if (id === sortId && id !== 'none') {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortId = id;
    sortDir = defaultDirection(id);
  }

  function statLine(player: IndexRow) {
    const s = player.stats;
    return {
      mpg: perGame(s, 'minutes'),
      ppg: perGame(s, 'points'),
      rpg: perGame(s, 'rebounds'),
      apg: perGame(s, 'assists'),
      spg: perGame(s, 'steals'),
      bpg: perGame(s, 'blocks'),
      topg: perGame(s, 'turnovers'),
      fgPct: shotPct(s.fieldGoalsMade, s.fieldGoalsAttempted),
      threePct: shotPct(s.threesMade, s.threesAttempted),
      ftPct: shotPct(s.freeThrowsMade, s.freeThrowsAttempted),
      ts: s.tsPct ?? 0,
      efg: s.efgPct ?? 0,
      per: s.per ?? 0,
      bpm: s.boxPlusMinus ?? 0,
      usage: s.usageRate ?? 0,
    };
  }

  function heightLabel(player: IndexRow): string {
    if (player.heightInches === null || player.heightInches === undefined) return '—';
    const feet = Math.floor(player.heightInches / 12);
    const inches = player.heightInches % 12;
    return `${feet}'${inches}"`;
  }

  function weightLabel(player: IndexRow): string {
    if (player.weightLbs === null || player.weightLbs === undefined) return '—';
    return `${player.weightLbs} lbs`;
  }

  function openPlayer(player: IndexRow) {
    dialogPlayer = player;
  }

  function closePlayer() {
    dialogPlayer = null;
  }

  const dialogSections = $derived.by(() => {
    const p = dialogPlayer;
    if (!p) return [] as { title: string; items: [string, string][] }[];
    const s = statLine(p);
    return [
      {
        title: 'Per game',
        items: [
          ['Minutes', formatPerGame(s.mpg)],
          ['Points', formatPerGame(s.ppg)],
          ['Rebounds', formatPerGame(s.rpg)],
          ['Assists', formatPerGame(s.apg)],
          ['Steals', formatPerGame(s.spg)],
          ['Blocks', formatPerGame(s.bpg)],
          ['Turnovers', formatPerGame(s.topg)],
        ],
      },
      {
        title: 'Shooting',
        items: [
          ['Field goal', formatPct(s.fgPct)],
          ['Three point', formatPct(s.threePct)],
          ['Free throw', formatPct(s.ftPct)],
          ['Effective FG', formatPct(s.efg)],
          ['True shooting', formatPct(s.ts)],
        ],
      },
      {
        title: 'Advanced',
        items: [
          ['PER', formatDecimal(s.per)],
          ['Box plus/minus', formatDecimal(s.bpm)],
          ['Usage rate', formatDecimal(s.usage)],
        ],
      },
      {
        title: 'Context',
        items: [
          ['Games', String(p.stats.gamesPlayed)],
          ['Minutes', String(p.stats.minutes)],
          ['Height', heightLabel(p)],
          ['Weight', weightLabel(p)],
        ],
      },
    ];
  });

  const poolHeading = $derived(
    franchise && era
      ? `${franchiseAbbreviation(franchise.franchiseId)} · ${era.label}`
      : franchise
        ? franchiseAbbreviation(franchise.franchiseId)
        : era
          ? era.label
          : 'All players',
  );

  const columns: {
    key: string;
    label: string;
    sort?: RosterSortId;
    numeric?: boolean;
    className?: string;
  }[] = [
    { key: 'player', label: 'Player', sort: 'name' },
    { key: 'pos', label: 'Pos', sort: 'position' },
    { key: 'decade', label: 'Decade', sort: 'decade' },
    { key: 'season', label: 'Season', sort: 'season' },
    { key: 'overall', label: 'O', sort: 'overall', numeric: true },
    { key: 'points', label: 'PTS', sort: 'points', numeric: true },
    { key: 'rebounds', label: 'REB', numeric: true },
    { key: 'assists', label: 'AST', numeric: true },
    { key: 'ts', label: 'TS%', numeric: true },
    { key: 'per', label: 'PER', sort: 'per', numeric: true },
  ];

  const sortArrow = $derived(sortId === 'none' ? '' : sortDir === 'asc' ? '↑' : '↓');
</script>

<svelte:head>
  <title>Roster — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
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
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      Failed to load data: {manifestError}
    </p>
  {:else if !manifest}
    <p class="mt-8 font-mono text-sm text-muted-foreground">Loading data…</p>
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
                    />
                    <span class="truncate" title={franchise.displayName}>
                      {franchiseAbbreviation(franchise.franchiseId)}
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

    {#if indexError}
      <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        Failed to load players: {indexError}
      </p>
    {:else if !index}
      <p class="mt-8 font-mono text-sm text-muted-foreground">Loading players…</p>
    {:else}
      <div class="mt-8 flex flex-col gap-4 rounded-xl border border-border bg-card p-2 sm:p-3">
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
              class="h-10 w-full rounded-lg border border-input bg-surface-1 pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
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
              class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
              null
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
            >
              All
            </button>
            {#each POSITION_OPTIONS as pos (pos)}
              <button
                type="button"
                aria-pressed={positionFilter === pos}
                onclick={() => (positionFilter = positionFilter === pos ? null : pos)}
                class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
                pos
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
              >
                {pos}
              </button>
            {/each}
            <span class="ml-auto shrink-0 pl-1 font-mono text-[10px] text-muted-foreground">
              {filteredRows.length.toLocaleString()} players
            </span>
          </div>
          <div
            class="flex items-center gap-1 overflow-x-auto pb-0.5"
            role="group"
            aria-label="Sort players"
          >
            <span
              class="shrink-0 pr-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
            >
              Sort
            </span>
            {#each SORT_OPTIONS as opt (opt.id)}
              <button
                type="button"
                aria-pressed={sortId === opt.id}
                onclick={() => chooseSort(opt.id)}
                class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {sortId ===
                opt.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
              >
                {opt.label}
              </button>
            {/each}
            {#if sortId !== 'none'}
              <button
                type="button"
                onclick={() => chooseSort(sortId)}
                aria-label={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
                class="shrink-0 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] font-bold text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
              >
                {sortArrow}
              </button>
            {/if}
          </div>
        </div>

        {#if filteredRows.length === 0}
          <p class="p-6 text-center font-mono text-xs text-muted-foreground">No players match.</p>
        {:else}
          <div class="hidden overflow-x-auto sm:block" aria-label={poolHeading}>
            <table class="w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  {#each columns as col (col.key)}
                    <th
                      scope="col"
                      class="border-b border-border px-2 py-2 font-mono text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-muted-foreground uppercase first:pl-3 last:pr-3 {col.numeric
                        ? 'text-right'
                        : ''}"
                    >
                      {#if col.sort}
                        <button
                          type="button"
                          aria-pressed={sortId === col.sort}
                          onclick={() => chooseSort(col.sort!)}
                          class="inline-flex items-center gap-1 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring {sortId ===
                          col.sort
                            ? 'text-primary'
                            : ''}"
                        >
                          {col.label}
                          {#if sortId === col.sort}
                            <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                          {/if}
                        </button>
                      {:else}
                        {col.label}
                      {/if}
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each visibleItems as item (item.type === 'group' ? `group:${item.franchiseId}/${item.eraId}` : `row:${item.player.franchiseId}/${item.player.eraId}/${item.player.playerId}`)}
                  {#if item.type === 'group'}
                    <tr>
                      <td
                        colspan={columns.length}
                        class="border-b border-border/60 bg-surface-1 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
                      >
                        {franchiseAbbreviation(item.franchiseId)} · {eraLabel.get(item.eraId) ??
                          item.eraId} · {item.count} players
                      </td>
                    </tr>
                  {:else}
                    {@const player = item.player}
                    <tr
                      tabindex="0"
                      role="button"
                      aria-label={`View ${player.displayName} stats`}
                      onclick={() => openPlayer(player)}
                      onkeydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openPlayer(player);
                        }
                      }}
                      class="cursor-pointer border-b border-border/40 outline-none transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <td class="px-3 py-2">
                        <span class="flex min-w-0 items-center gap-2.5">
                          <PlayerFace
                            {player}
                            {manifest}
                            size="sm"
                            fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                          />
                          <span class="min-w-0">
                            <span class="block truncate text-sm font-bold">
                              {player.displayName}
                            </span>
                            <span class="block font-mono text-[10px] text-muted-foreground">
                              {franchiseAbbreviation(player.franchiseId)}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td
                        class="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
                      >
                        {player.positionsCanonical.join('/')}
                      </td>
                      <td
                        class="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
                      >
                        {eraLabel.get(player.eraId) ?? player.eraId}
                      </td>
                      <td
                        class="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground"
                      >
                        {player.seasonKey}
                      </td>
                      <td class="px-2 py-2 text-right font-mono text-[11px] font-bold tabular-nums">
                        {player.overall}
                      </td>
                      <td class="px-2 py-2 text-right font-mono text-[11px] tabular-nums">
                        {formatPerGame(perGame(player.stats, 'points'))}
                      </td>
                      <td class="px-2 py-2 text-right font-mono text-[11px] tabular-nums">
                        {formatPerGame(perGame(player.stats, 'rebounds'))}
                      </td>
                      <td class="px-2 py-2 text-right font-mono text-[11px] tabular-nums">
                        {formatPerGame(perGame(player.stats, 'assists'))}
                      </td>
                      <td class="px-2 py-2 text-right font-mono text-[11px] tabular-nums">
                        {formatPct(player.stats.tsPct ?? 0)}
                      </td>
                      <td class="px-3 py-2 text-right font-mono text-[11px] tabular-nums">
                        {formatDecimal(player.stats.per ?? 0)}
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>

          <ul class="flex flex-col gap-1 sm:hidden" aria-label={poolHeading}>
            {#each visibleItems as item (item.type === 'group' ? `group:${item.franchiseId}/${item.eraId}` : `row:${item.player.franchiseId}/${item.player.eraId}/${item.player.playerId}`)}
              {#if item.type === 'group'}
                <li
                  class="px-2 pt-3 pb-1 font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
                >
                  {franchiseAbbreviation(item.franchiseId)} · {eraLabel.get(item.eraId) ??
                    item.eraId} · {item.count} players
                </li>
              {:else}
                {@const player = item.player}
                <li>
                  <button
                    type="button"
                    aria-label={`View ${player.displayName} stats`}
                    onclick={() => openPlayer(player)}
                    class="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring active:bg-surface-2 sm:hover:border-border"
                  >
                    <PlayerFace
                      {player}
                      {manifest}
                      size="sm"
                      fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-bold">{player.displayName}</span>
                      <span class="block font-mono text-[10px] text-muted-foreground">
                        {franchiseAbbreviation(player.franchiseId)} · {eraLabel.get(player.eraId) ??
                          player.eraId} · {player.seasonKey} · {player.positionsCanonical.join('/')}
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Overall">
                        O {player.overall}
                      </span>
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Points per game">
                        {formatPerGame(perGame(player.stats, 'points'))}
                      </span>
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Rebounds per game">
                        {formatPerGame(perGame(player.stats, 'rebounds'))}
                      </span>
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Assists per game">
                        {formatPerGame(perGame(player.stats, 'assists'))}
                      </span>
                    </span>
                  </button>
                </li>
              {/if}
            {/each}
          </ul>

          {#if hasMore}
            <div class="flex items-center justify-between gap-3 px-1 pb-1">
              <span class="font-mono text-[10px] text-muted-foreground">
                Showing {visiblePlayers.toLocaleString()} of
                {filteredRows.length.toLocaleString()} players
              </span>
              <button
                type="button"
                onclick={() => (visibleCount += PAGE_SIZE)}
                class="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] font-bold text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
              >
                Show {PAGE_SIZE} more
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}

  <Dialog.Root
    open={dialogPlayer !== null}
    onOpenChange={(open) => {
      if (!open) closePlayer();
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content
        class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
      >
        {#if dialogPlayer}
          {@const subject = dialogPlayer}
          {@const line = statLine(subject)}
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <PlayerFace
                player={subject}
                manifest={manifest!}
                size="md"
                fallbackInitials={subject.firstName[0]! + subject.lastName[0]!}
              />
              <div class="min-w-0">
                <Dialog.Title
                  class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
                >
                  {subject.displayName}
                </Dialog.Title>
                <p class="font-mono text-[10px] text-muted-foreground">
                  {franchiseName.get(subject.franchiseId) ?? subject.franchiseId} · {eraLabel.get(
                    subject.eraId,
                  ) ?? subject.eraId} · {subject.seasonKey}
                </p>
              </div>
            </div>
            <Dialog.Close
              aria-label="Close"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <X class="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            <span class="rounded bg-surface-3 px-1.5 py-0.5">
              {subject.positionsCanonical.join('/')}
            </span>
            <span
              class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary"
              title="Overall"
            >
              O {subject.overall}
            </span>
            <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Offense"
              >OF {subject.offense}</span
            >
            <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Defense"
              >DF {subject.defense}</span
            >
          </div>

          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            {#each dialogSections as section (section.title)}
              <div>
                <h3
                  class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
                >
                  {section.title}
                </h3>
                <dl class="mt-2 grid grid-cols-2 gap-1.5">
                  {#each section.items as [label, value] (label)}
                    <div
                      class="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5"
                    >
                      <dt class="font-mono text-[10px] text-muted-foreground">{label}</dt>
                      <dd class="font-mono text-xs font-bold tabular-nums">{value}</dd>
                    </div>
                  {/each}
                </dl>
              </div>
            {/each}
          </div>

          <p class="mt-4 font-mono text-[10px] text-muted-foreground">
            Peak season by selection score · {line.usage.toFixed(1)}% usage · {formatPerGame(
              line.mpg,
            )} minutes per game
          </p>
        {/if}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
</section>
