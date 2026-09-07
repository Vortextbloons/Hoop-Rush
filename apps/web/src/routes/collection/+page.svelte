<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import type {
    CollectionIndexEntry,
    CollectionSetId,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { COLLECTION_RARITY_ORDER } from '@hoop-rush/data-contracts';
  import { getManifest } from '$lib/data';
  import { DETAILED_POSITIONS } from '$lib/player-positions';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import CollectionCard from '$lib/collection/CollectionCard.svelte';
  import CardDialog from '$lib/collection/CardDialog.svelte';
  import { loadCollectionCatalog, loadCollectionIndex } from '$lib/collection/collection-assets.ts';
  import {
    buildBookItems,
    COLLECTION_PAGE_SIZE,
    EMPTY_COLLECTION_FILTERS,
    filterBookItems,
    paginateBookItems,
    sortBookItems,
    type CollectionFilters,
    type CollectionSortId,
  } from '$lib/collection/collection-browser.ts';
  import { claimWelcomeStarter, ensureCollection } from '$lib/collection/collection-hub.ts';
  import type { CollectionCatalog, CollectionState } from '@hoop-rush/data-contracts';

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let manifest = $state<HoopRushManifest | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let entries = $state<CollectionIndexEntry[]>([]);
  let collectionState = $state<CollectionState | null>(null);
  let claiming = $state(false);
  let claimError = $state<string | null>(null);
  let starterCards = $state<CollectionIndexEntry[]>([]);
  let announcement = $state('');

  let filters = $state<CollectionFilters>({ ...EMPTY_COLLECTION_FILTERS });
  let sort = $state<CollectionSortId>('default');
  let pageNum = $state(1);
  let selectedCardId = $state<string | null>(null);

  const FAMILIES = ['Base', 'Sharpshooter', 'Lockdown', 'Floor General'] as const;

  function readFiltersFromUrl(): void {
    const params = page.url.searchParams;
    filters = {
      search: params.get('q') ?? '',
      franchises: params.getAll('franchise'),
      eras: params.getAll('era'),
      positions: params.getAll('position'),
      rarities: params
        .getAll('rarity')
        .filter((r): r is (typeof COLLECTION_RARITY_ORDER)[number] =>
          (COLLECTION_RARITY_ORDER as readonly string[]).includes(r),
        ),
      families: params.getAll('family'),
      owned: (params.get('owned') as CollectionFilters['owned']) ?? 'all',
      sets: params.getAll('set') as CollectionSetId[],
    };
    const sortParam = params.get('sort');
    sort = sortParam === 'name' || sortParam === 'overall' ? sortParam : 'default';
    pageNum = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  }

  function writeFiltersToUrl(): void {
    const params = new URLSearchParams();
    if (filters.search) params.set('q', filters.search);
    for (const value of filters.franchises) params.append('franchise', value);
    for (const value of filters.eras) params.append('era', value);
    for (const value of filters.positions) params.append('position', value);
    for (const value of filters.rarities) params.append('rarity', value);
    for (const value of filters.families) params.append('family', value);
    if (filters.owned !== 'all') params.set('owned', filters.owned);
    for (const value of filters.sets) params.append('set', value);
    if (sort !== 'default') params.set('sort', sort);
    if (pageNum > 1) params.set('page', String(pageNum));
    const query = params.toString();
    const target = `/collection${query ? `?${query}` : ''}`;
    void goto(resolve(target as any), {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  async function load(): Promise<void> {
    readFiltersFromUrl();
    try {
      const [loadedManifest, loadedIndex, loadedState] = await Promise.all([
        getManifest(),
        loadCollectionIndex(),
        ensureCollection(new Date().toISOString()),
      ]);
      if (!mounted) return;
      manifest = loadedManifest;
      entries = loadedIndex.cards;
      collectionState = loadedState;
      phase = 'ready';
      void loadCollectionCatalog()
        .then((loaded) => {
          if (mounted) catalog = loaded;
        })
        .catch(() => {});
    } catch (loadError) {
      if (!mounted) return;
      error = loadError instanceof Error ? loadError.message : 'Could not load the collection.';
      phase = 'error';
    }
  }

  $effect(() => {
    void load();
  });

  const ownedIds = $derived(new Set((collectionState?.owned ?? []).map((entry) => entry.cardId)));
  const sets = $derived(catalog?.sets ?? []);
  const items = $derived(buildBookItems(entries, ownedIds, sets));
  const filtered = $derived(filterBookItems(items, filters));
  const sorted = $derived(sortBookItems(filtered, sort));
  const paged = $derived(paginateBookItems(sorted, pageNum, COLLECTION_PAGE_SIZE));

  const franchiseOptions = $derived([...new Set(entries.map((entry) => entry.franchiseId))].sort());
  const eraOptions = $derived([...new Set(entries.map((entry) => entry.eraId))].sort());

  function onFilterChange(): void {
    pageNum = 1;
    writeFiltersToUrl();
  }

  function toggleInList<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  }

  async function claim(): Promise<void> {
    if (claiming) return;
    claiming = true;
    claimError = null;
    try {
      const outcome = await claimWelcomeStarter(new Date().toISOString());
      if (!mounted) return;
      collectionState = outcome.state;
      const byId = new Map(entries.map((entry) => [entry.cardId, entry]));
      starterCards = outcome.pull.slots
        .map((slot) => byId.get(slot.cardId))
        .filter((entry) => entry !== undefined);
      announcement = `Starter claimed. ${String(starterCards.length)} new cards, 3,000 Coins.`;
    } catch (claimFailure) {
      if (!mounted) return;
      claimError =
        claimFailure instanceof Error ? claimFailure.message : 'Claim failed. Try again.';
    } finally {
      if (mounted) claiming = false;
    }
  }

  const selectedCard = $derived(
    selectedCardId && catalog
      ? (catalog.cards.find((card) => card.cardId === selectedCardId) ?? null)
      : null,
  );
  const selectedEntry = $derived(
    selectedCardId ? (entries.find((entry) => entry.cardId === selectedCardId) ?? null) : null,
  );
  const selectedSet = $derived.by(() => {
    if (!selectedCardId || !catalog) return null;
    const id: string = selectedCardId;
    return catalog.sets.find((set) => set.memberCardIds.includes(id)) ?? null;
  });
  const selectedSetOwned = $derived(
    selectedSet ? selectedSet.memberCardIds.filter((id) => ownedIds.has(id)).length : 0,
  );
  const eligiblePacks = $derived.by(() => {
    if (!selectedCard || !catalog) return [];
    const rarityRank = COLLECTION_RARITY_ORDER.indexOf(selectedCard.rarity);
    return catalog.packs
      .filter((pack) => {
        if (pack.eligibleScope === 'specials-only' && selectedCard.family === 'Base') return false;
        return pack.slots.some((slot) => {
          const floor = slot.kind === 'guaranteed' ? (slot.floorRarity ?? 'Ember') : 'Ember';
          return COLLECTION_RARITY_ORDER.indexOf(floor) <= rarityRank;
        });
      })
      .map((pack) => pack.packId);
  });
</script>

<svelte:head>
  <title>Collection · Hoop Rush</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="font-display text-3xl font-extrabold tracking-tight">Collection</h1>
      <p class="text-sm text-muted-foreground">
        Ultimate Run card album. One permanent collection per profile.
      </p>
    </div>
    <div class="flex items-center gap-4 text-sm" aria-live="off">
      <span><strong class="tabular-nums">{collectionState?.balances.Coins ?? 0}</strong> Coins</span
      >
      <span
        ><strong class="tabular-nums">{collectionState?.balances.Exchange ?? 0}</strong> Exchange</span
      >
      <a
        href={resolve('/collection/packs')}
        class="rounded-xl bg-accent px-4 py-2 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Packs
      </a>
    </div>
  </div>

  <p class="sr-only" role="status">{announcement}</p>

  {#if phase === 'loading'}
    <div class="mt-6">
      <AsyncState kind="loading" title="Loading" message="Loading the collection…" />
    </div>
  {:else if phase === 'error'}
    <div class="mt-6">
      <AsyncState
        kind="error"
        title="Couldn't load"
        message={error ?? 'Unknown error.'}
        retry={() => {
          phase = 'loading';
          void load();
        }}
      />
    </div>
  {:else}
    {#if collectionState && !collectionState.claimedWelcome}
      <section
        aria-labelledby="welcome-heading"
        class="mt-6 rounded-2xl border border-border bg-card p-6"
      >
        <h2 id="welcome-heading" class="font-display text-2xl font-extrabold">
          Claim your starter
        </h2>
        <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
          One free five-card starter plus a one-time grant of 3,000 Coins. Starter cards are drawn
          from Ember base cards and always form a legal five. This grant can be claimed once.
        </p>
        <ul class="mt-3 list-disc pl-5 text-sm text-muted-foreground">
          <li>Five new, distinct players from Ember base cards</li>
          <li>Rarity before claiming: 100% Ember</li>
          <li>Welcome grant: 3,000 Coins, starting Exchange: 0</li>
        </ul>
        {#if claimError}
          <p role="alert" class="mt-3 text-sm text-negative">{claimError}</p>
        {/if}
        <button
          type="button"
          onclick={claim}
          disabled={claiming}
          class="mt-4 rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {claiming ? 'Claiming…' : 'Claim starter'}
        </button>
      </section>
    {/if}

    {#if starterCards.length > 0}
      <section
        aria-label="Starter results"
        class="mt-6 rounded-2xl border border-border bg-card p-6"
      >
        <h2 class="font-display text-xl font-extrabold">Starter claimed</h2>
        <p class="text-sm text-muted-foreground">Five cards added · 3,000 Coins in the balance.</p>
        <ul class="mt-3 grid gap-2 sm:grid-cols-2">
          {#each starterCards as card (card.cardId)}
            <li class="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
              <span class="text-sm font-bold">New</span>
              <span class="min-w-0">
                <span class="block truncate font-semibold">{card.displayName}</span>
                <span class="block text-xs text-muted-foreground"
                  >{card.seasonKey} · {card.rarity}</span
                >
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if collectionState?.claimedWelcome}
      <section
        aria-label="Collection filters"
        class="mt-6 rounded-2xl border border-border bg-card p-4"
      >
        <div class="flex flex-wrap gap-2">
          <label class="flex min-w-48 flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span class="sr-only">Search players</span>
            <input
              type="search"
              placeholder="Search players"
              bind:value={filters.search}
              oninput={onFilterChange}
              class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <label class="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            Owned
            <select
              bind:value={filters.owned}
              onchange={onFilterChange}
              class="bg-transparent outline-none"
            >
              <option value="all">All</option>
              <option value="owned">Owned</option>
              <option value="unowned">Unowned</option>
            </select>
          </label>
          <label class="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            Sort
            <select bind:value={sort} onchange={onFilterChange} class="bg-transparent outline-none">
              <option value="default">Rarity · Overall</option>
              <option value="name">Name</option>
              <option value="overall">Overall</option>
            </select>
          </label>
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <details class="rounded-xl bg-surface-2 p-3">
            <summary class="cursor-pointer text-sm font-semibold">Franchise</summary>
            <div class="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
              {#each franchiseOptions as franchise (franchise)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.franchises.includes(franchise)}
                    onchange={() => {
                      filters.franchises = toggleInList(filters.franchises, franchise);
                      onFilterChange();
                    }}
                  />
                  {franchise}
                </label>
              {/each}
            </div>
          </details>
          <details class="rounded-xl bg-surface-2 p-3">
            <summary class="cursor-pointer text-sm font-semibold">Era</summary>
            <div class="mt-2 flex flex-col gap-1">
              {#each eraOptions as era (era)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.eras.includes(era)}
                    onchange={() => {
                      filters.eras = toggleInList(filters.eras, era);
                      onFilterChange();
                    }}
                  />
                  {era}
                </label>
              {/each}
            </div>
          </details>
          <details class="rounded-xl bg-surface-2 p-3">
            <summary class="cursor-pointer text-sm font-semibold"
              >Position · Rarity · Family</summary
            >
            <div class="mt-2 flex flex-col gap-1">
              {#each DETAILED_POSITIONS as position (position)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.positions.includes(position)}
                    onchange={() => {
                      filters.positions = toggleInList(filters.positions, position);
                      onFilterChange();
                    }}
                  />
                  {position}
                </label>
              {/each}
              {#each COLLECTION_RARITY_ORDER as rarity (rarity)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.rarities.includes(rarity)}
                    onchange={() => {
                      filters.rarities = toggleInList(filters.rarities, rarity);
                      onFilterChange();
                    }}
                  />
                  {rarity}
                </label>
              {/each}
              {#each FAMILIES as family (family)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.families.includes(family)}
                    onchange={() => {
                      filters.families = toggleInList(filters.families, family);
                      onFilterChange();
                    }}
                  />
                  {family}
                </label>
              {/each}
            </div>
          </details>
          <details class="rounded-xl bg-surface-2 p-3">
            <summary class="cursor-pointer text-sm font-semibold">Set</summary>
            <div class="mt-2 flex flex-col gap-1">
              {#each sets as set (set.setId)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.sets.includes(set.setId)}
                    onchange={() => {
                      filters.sets = toggleInList(filters.sets, set.setId);
                      onFilterChange();
                    }}
                  />
                  {set.title}
                </label>
              {/each}
            </div>
          </details>
        </div>
      </section>

      <p class="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {filtered.length} of {items.length} cards · page {paged.page} of {paged.pageCount}
      </p>
      {#if paged.pageItems.length === 0}
        <p
          class="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        >
          No cards match these filters.
        </p>
      {:else}
        <ul class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each paged.pageItems as item (item.entry.cardId)}
            <li>
              <CollectionCard
                {item}
                {manifest}
                selected={selectedCardId === item.entry.cardId}
                onSelect={(cardId) => {
                  selectedCardId = cardId;
                }}
              />
            </li>
          {/each}
        </ul>
        <nav aria-label="Collection pages" class="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={paged.page <= 1}
            onclick={() => {
              pageNum = paged.page - 1;
              writeFiltersToUrl();
            }}
            class="rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Previous
          </button>
          <span class="text-sm tabular-nums">Page {paged.page} / {paged.pageCount}</span>
          <button
            type="button"
            disabled={paged.page >= paged.pageCount}
            onclick={() => {
              pageNum = paged.page + 1;
              writeFiltersToUrl();
            }}
            class="rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Next
          </button>
        </nav>
      {/if}
    {/if}
  {/if}
</div>

{#if manifest}
  <CardDialog
    card={selectedCard}
    indexEntry={selectedEntry}
    {catalog}
    {manifest}
    owned={selectedCardId ? ownedIds.has(selectedCardId) : false}
    ownedCount={selectedSetOwned}
    setTotal={selectedSet?.memberCardIds.length ?? 0}
    setTitle={selectedSet?.title ?? null}
    {eligiblePacks}
    onClose={() => {
      selectedCardId = null;
    }}
  />
{/if}
