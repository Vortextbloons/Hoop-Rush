<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import '$lib/collection/ultimate-theme.css';
  import { page } from '$app/state';
  import { onDestroy, onMount, tick } from 'svelte';
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
  import { getContext } from 'svelte';
  import {
    ULTIMATE_RUN_SHELL_CONTEXT,
    type UltimateRunShell,
  } from '$lib/collection/ultimate-shell.svelte';
  import ActiveTarget from '$lib/collection/ActiveTarget.svelte';
  import SetProgress from '$lib/collection/SetProgress.svelte';
  import {
    loadCollectionCatalog,
    loadCollectionIndex,
    loadCollectionProgression,
  } from '$lib/collection/collection-assets.ts';
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
  import {
    claimSetReward,
    claimWelcomeStarter,
    ensureCollection,
    setTargetPlayer,
  } from '$lib/collection/collection-hub.ts';
  import {
    targetPlayerSummary,
    targetedSummaryForPlayer,
  } from '$lib/collection/collection-targeting-view.ts';
  import { collectionErrorMessage } from '$lib/collection/collection-errors.ts';
  import { setProgressViews } from '$lib/collection/collection-progression-view.ts';
  import type {
    CollectionCatalog,
    CollectionProgressionRules,
    CollectionState,
  } from '@hoop-rush/data-contracts';

  const shell = getContext<UltimateRunShell>(ULTIMATE_RUN_SHELL_CONTEXT);

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let manifest = $state<HoopRushManifest | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let progression = $state<CollectionProgressionRules | null>(null);
  let progressionError = $state<string | null>(null);
  let entries = $state<CollectionIndexEntry[]>([]);
  let collectionState = $state<CollectionState | null>(null);
  let claiming = $state(false);
  let claimError = $state<string | null>(null);
  let starterCards = $state<CollectionIndexEntry[]>([]);
  let announcement = $state('');
  let targetBusy = $state(false);
  let targetError = $state<string | null>(null);
  let claimingSetId = $state<string | null>(null);
  let setClaimError = $state<string | null>(null);
  let searchInput = $state<HTMLInputElement | undefined>(undefined);
  let filterDialog = $state<HTMLDialogElement | undefined>(undefined);
  let filterButton = $state<HTMLButtonElement | undefined>(undefined);
  let filterDialogTitle = $state<HTMLHeadingElement | undefined>(undefined);
  let desktopFilterLayout = $state(false);
  let mobileFilterOpen = $state(false);

  let filters = $state<CollectionFilters>({ ...EMPTY_COLLECTION_FILTERS });
  let sort = $state<CollectionSortId>('default');
  let draftFilters = $state<CollectionFilters>({ ...EMPTY_COLLECTION_FILTERS });
  let draftSort = $state<CollectionSortId>('default');
  const editingFilters = $derived(mobileFilterOpen ? draftFilters : filters);
  const editingSort = $derived(mobileFilterOpen ? draftSort : sort);
  let pageNum = $state(1);
  let selectedCardId = $state<string | null>(null);

  const FAMILIES = $derived(
    [...new Set(entries.map((entry) => entry.family))].sort((left, right) =>
      left.localeCompare(right),
    ),
  );

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

  function writeFiltersToUrl(replaceState = false): void {
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
    const target = `/ultimate/run/collection${query ? `?${query}` : ''}`;
    void goto(resolve(target as any), {
      replaceState,
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
      void loadCollectionProgression()
        .then((loaded) => {
          if (mounted) {
            progression = loaded;
            progressionError = null;
          }
        })
        .catch((failure: unknown) => {
          if (!mounted) return;
          progression = null;
          progressionError =
            failure instanceof Error
              ? failure.message
              : 'The collection progression rules are unavailable.';
        });
    } catch (loadError) {
      if (!mounted) return;
      error = loadError instanceof Error ? loadError.message : 'Could not load the collection.';
      phase = 'error';
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    page.url.search;
    if (phase === 'ready') readFiltersFromUrl();
  });

  $effect(() => {
    if (collectionState && entries.length > 0) shell.sync(collectionState, entries.length);
  });

  const ownedIds = $derived(new Set((collectionState?.owned ?? []).map((entry) => entry.cardId)));
  const sets = $derived(catalog?.sets ?? []);
  const items = $derived(buildBookItems(entries, ownedIds, sets));
  const filtered = $derived(filterBookItems(items, filters));
  const sorted = $derived(sortBookItems(filtered, sort));
  const paged = $derived(paginateBookItems(sorted, pageNum, COLLECTION_PAGE_SIZE));

  const franchiseOptions = $derived([...new Set(entries.map((entry) => entry.franchiseId))].sort());
  const eraOptions = $derived([...new Set(entries.map((entry) => entry.eraId))].sort());

  function onFilterChange(replaceState = false): void {
    pageNum = 1;
    writeFiltersToUrl(replaceState);
  }

  function toggleInList<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  }

  function cloneFilters(value: CollectionFilters): CollectionFilters {
    return {
      ...value,
      franchises: [...value.franchises],
      eras: [...value.eras],
      positions: [...value.positions],
      rarities: [...value.rarities],
      families: [...value.families],
      sets: [...value.sets],
    };
  }

  function updateFilters(next: CollectionFilters, replaceState = false): void {
    if (mobileFilterOpen) {
      draftFilters = next;
      return;
    }
    filters = next;
    onFilterChange(replaceState);
  }

  function updateFilter<K extends keyof CollectionFilters>(
    key: K,
    value: CollectionFilters[K],
    replaceState = false,
  ): void {
    const current = mobileFilterOpen ? draftFilters : filters;
    updateFilters({ ...current, [key]: value } as CollectionFilters, replaceState);
  }

  function updateListFilter(
    key: 'franchises' | 'eras' | 'positions' | 'rarities' | 'families' | 'sets',
    value: string,
  ): void {
    const current = mobileFilterOpen ? draftFilters : filters;
    const next = toggleInList(current[key] as string[], value);
    updateFilters({ ...current, [key]: next } as CollectionFilters);
  }

  function updateSort(next: CollectionSortId): void {
    if (mobileFilterOpen) {
      draftSort = next;
      return;
    }
    sort = next;
    onFilterChange();
  }

  async function openMobileFilters(): Promise<void> {
    if (!filterDialog || desktopFilterLayout) return;
    draftFilters = cloneFilters(filters);
    draftSort = sort;
    mobileFilterOpen = true;
    filterDialog.showModal();
    await tick();
    filterDialogTitle?.focus();
  }

  function closeMobileFilters(apply: boolean): void {
    if (apply) {
      filters = cloneFilters(draftFilters);
      sort = draftSort;
      onFilterChange();
    } else {
      draftFilters = cloneFilters(filters);
      draftSort = sort;
    }
    mobileFilterOpen = false;
    filterDialog?.close();
    if (!desktopFilterLayout) filterButton?.focus();
  }

  function resetEditingFilters(): void {
    if (mobileFilterOpen) {
      draftFilters = { ...EMPTY_COLLECTION_FILTERS };
      draftSort = 'default';
      return;
    }
    filters = { ...EMPTY_COLLECTION_FILTERS };
    sort = 'default';
    onFilterChange();
  }

  function handleFilterDialogClose(): void {
    const restoreTrigger = mobileFilterOpen && !desktopFilterLayout;
    mobileFilterOpen = false;
    draftFilters = cloneFilters(filters);
    draftSort = sort;
    if (restoreTrigger) filterButton?.focus();
  }

  onMount(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const syncBreakpoint = (): void => {
      desktopFilterLayout = media.matches;
      if (media.matches && mobileFilterOpen) {
        mobileFilterOpen = false;
        filterDialog?.close();
      }
    };
    syncBreakpoint();
    media.addEventListener('change', syncBreakpoint);
    return () => media.removeEventListener('change', syncBreakpoint);
  });

  const activeFilterCount = $derived(
    Number(filters.search.length > 0) +
      Number(filters.owned !== 'all') +
      filters.franchises.length +
      filters.eras.length +
      filters.positions.length +
      filters.rarities.length +
      filters.families.length +
      filters.sets.length,
  );

  function clearAppliedFilter(
    key:
      'search' | 'owned' | 'franchises' | 'eras' | 'positions' | 'rarities' | 'families' | 'sets',
    value?: string,
  ): void {
    if (key === 'search') filters.search = '';
    else if (key === 'owned') filters.owned = 'all';
    else {
      const next = (filters[key] as string[]).filter((entry) => entry !== value);
      filters = { ...filters, [key]: next } as CollectionFilters;
    }
    onFilterChange();
  }

  function clearAppliedSort(): void {
    sort = 'default';
    onFilterChange();
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
      claimError = collectionErrorMessage(claimFailure, 'Claim failed. Try again.');
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
  const activeTargetId = $derived(collectionState?.activeTargetPlayerId ?? null);
  const activeTargetSummary = $derived(
    catalog && activeTargetId ? targetPlayerSummary(catalog, activeTargetId) : null,
  );
  const activeTargetLine = $derived(
    activeTargetId ? targetedSummaryForPlayer(activeTargetSummary, activeTargetId) : '',
  );
  const activeTargetPlayer = $derived.by(() => {
    if (!catalog || !activeTargetId) return null;
    const card = catalog.cards.find((entry) => entry.playerId === activeTargetId);
    if (!card) return null;
    return {
      playerId: activeTargetId,
      playerExternalId: card.playerExternalId,
      altIds: null,
    };
  });
  const setViews = $derived(
    progression && catalog && collectionState
      ? setProgressViews({
          progression,
          catalog,
          ownedCardIds: ownedIds,
          claimedSetIds: collectionState.claimedSetIds,
        })
      : [],
  );
  const cardNameOf = $derived((cardId: string) => {
    return (
      entries.find((entry) => entry.cardId === cardId)?.displayName ??
      catalog?.cards.find((entry) => entry.cardId === cardId)?.displayName ??
      cardId
    );
  });

  function retryProgression(): void {
    progressionError = null;
    void loadCollectionProgression()
      .then((loaded) => {
        if (mounted) progression = loaded;
      })
      .catch((failure: unknown) => {
        if (!mounted) return;
        progressionError =
          failure instanceof Error
            ? failure.message
            : 'The collection progression rules are unavailable.';
      });
  }

  async function targetPlayer(playerId: string): Promise<void> {
    if (targetBusy) return;
    targetBusy = true;
    targetError = null;
    try {
      const next = await setTargetPlayer(playerId, new Date().toISOString());
      if (!mounted) return;
      collectionState = next;
      const summary = catalog ? targetPlayerSummary(catalog, playerId) : null;
      announcement = `Target set: ${summary?.displayName ?? playerId}. All ${
        summary?.versionCount ?? 0
      } catalog versions are targeted. Rarity odds do not change.`;
    } catch (failure) {
      if (!mounted) return;
      targetError = collectionErrorMessage(failure, 'Setting the target failed.');
    } finally {
      if (mounted) targetBusy = false;
    }
  }

  async function clearTarget(): Promise<void> {
    if (targetBusy) return;
    targetBusy = true;
    targetError = null;
    try {
      const next = await setTargetPlayer(null, new Date().toISOString());
      if (!mounted) return;
      collectionState = next;
      announcement = 'Target cleared. Packs draw with equal card weights again.';
    } catch (failure) {
      if (!mounted) return;
      targetError = collectionErrorMessage(failure, 'Clearing the target failed.');
    } finally {
      if (mounted) targetBusy = false;
    }
  }

  async function claimSet(setId: string): Promise<void> {
    if (claimingSetId !== null) return;
    claimingSetId = setId;
    setClaimError = null;
    try {
      const outcome = await claimSetReward(setId, new Date().toISOString());
      if (!mounted) return;
      collectionState = outcome.state;
      const title =
        outcome.receipt?.title ??
        catalog?.sets.find((entry) => entry.setId === setId)?.title ??
        setId;
      const amount = outcome.receipt?.amount ?? 0;
      announcement = `Claimed ${title}: +${amount.toLocaleString('en-US')} Exchange. Exchange balance is now ${outcome.state.balances.Exchange.toLocaleString('en-US')}.`;
    } catch (failure) {
      if (!mounted) return;
      setClaimError = collectionErrorMessage(failure, 'Claiming the set failed.');
    } finally {
      if (mounted) claimingSetId = null;
    }
  }

  function inspectCard(cardId: string): void {
    selectedCardId = cardId;
  }
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

<div class="ur-page ur-collection-page">
  <div class="ur-page-intro ur-book-intro">
    <div>
      <p class="ur-hero-eyebrow">Your collection</p>
      <h2 class="ur-book-title">Your card book</h2>
      <p class="ur-page-description">
        Browse the full player card catalog and finish sets to claim their rewards.
      </p>
    </div>
    {#if collectionState}
      <div class="ur-stat-duo ur-book-counts" aria-label="Collection totals">
        <span class="ur-stat-box ur-stat-gold"
          ><strong class="ur-number">{collectionState.owned.length}</strong><small
            >Owned</small
          ></span
        >
        <span class="ur-stat-box"
          ><strong class="ur-number">{entries.length.toLocaleString('en-US')}</strong><small
            >Catalog</small
          ></span
        >
      </div>
    {/if}
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
        class="ur-starter-claim ur-arena-panel mt-6 p-6"
      >
        <p class="ur-hero-eyebrow">Welcome grant</p>
        <h2 id="welcome-heading" class="ur-section-title">
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
          class="ur-starter-claim-button ur-btn-gold mt-4 px-5 py-2.5 outline-none disabled:opacity-50"
        >
          {claiming ? 'Claiming…' : 'Claim starter'}
        </button>
      </section>
    {/if}

    {#if starterCards.length > 0}
      <section aria-label="Starter results" class="ur-starter-recap ur-arena-panel mt-6">
        <p class="ur-hero-eyebrow">Starter claimed</p>
        <h2 class="ur-section-title">Five cards added</h2>
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
      {#if progressionError}
        <div class="mt-6">
          <AsyncState
            kind="error"
            title="Targeting and sets unavailable"
            message={progressionError}
            retry={retryProgression}
          />
        </div>
      {:else}
        {#if activeTargetId && catalog}
          <ActiveTarget
            playerName={activeTargetSummary?.displayName ?? activeTargetId}
            summaryLine={activeTargetLine}
            blurb={progression?.display.targetingBlurb ?? undefined}
            busy={targetBusy}
            player={activeTargetPlayer}
            {manifest}
            onChange={() => searchInput?.focus()}
            onClear={clearTarget}
          />
          {#if targetError}
            <p role="alert" class="mt-2 text-sm text-destructive">{targetError}</p>
          {/if}
        {/if}
        {#if setClaimError}
          <p role="alert" class="mt-2 text-sm text-destructive">{setClaimError}</p>
        {/if}
        {#if setViews.length > 0}
          <SetProgress
            views={setViews}
            title={progression?.display.setsTitle ?? 'Sets'}
            blurb={progression?.display.setsBlurb ?? undefined}
            {cardNameOf}
            busySetId={claimingSetId}
            onClaim={claimSet}
            onInspect={inspectCard}
          />
        {/if}
      {/if}

      <button
        bind:this={filterButton}
        type="button"
        class="ur-mobile-filter-trigger ur-btn-ghost"
        onclick={() => void openMobileFilters()}
      >
        Filters{activeFilterCount > 0 ? ` · ${activeFilterCount} applied` : ''}
      </button>
      <dialog
        bind:this={filterDialog}
        open={desktopFilterLayout}
        onclose={handleFilterDialogClose}
        aria-labelledby="collection-filter-title"
        class="ur-collection-filters mt-6"
      >
        <div class="ur-filter-dialog-heading">
          <h2 id="collection-filter-title" bind:this={filterDialogTitle} tabindex="-1" class="ur-section-title">
            Filter cards
          </h2>
          {#if !desktopFilterLayout}
            <button
              type="button"
              class="ur-filter-dialog-close ur-btn-ghost"
              onclick={() => closeMobileFilters(false)}
            >
              Cancel
            </button>
          {/if}
        </div>
        <div class="ur-filter-pills flex flex-wrap gap-2">
          <label class="flex min-w-48 flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span class="sr-only">Search players</span>
            <input
              bind:this={searchInput}
              type="search"
              placeholder="Search players"
              value={editingFilters.search}
              oninput={(event) => updateFilter('search', event.currentTarget.value, true)}
              class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <label class="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            Owned
            <select
              value={editingFilters.owned}
              onchange={(event) =>
                updateFilter('owned', event.currentTarget.value as CollectionFilters['owned'])}
              class="bg-transparent outline-none"
            >
              <option value="all">All</option>
              <option value="owned">Owned</option>
              <option value="unowned">Unowned</option>
            </select>
          </label>
          <label class="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            Sort
            <select
              value={editingSort}
              onchange={(event) => updateSort(event.currentTarget.value as CollectionSortId)}
              class="bg-transparent outline-none"
            >
              <option value="default">Rarity · Overall</option>
              <option value="name">Name</option>
              <option value="overall">Overall</option>
            </select>
          </label>
        </div>
        <div class="ur-filter-groups mt-3">
          <details class="ur-filter-group">
            <summary class="cursor-pointer text-sm font-semibold">Franchise</summary>
            <div class="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
              {#each franchiseOptions as franchise (franchise)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editingFilters.franchises.includes(franchise)}
                    onchange={() => updateListFilter('franchises', franchise)}
                  />
                  {franchise}
                </label>
              {/each}
            </div>
          </details>
          <details class="ur-filter-group">
            <summary class="cursor-pointer text-sm font-semibold">Era</summary>
            <div class="mt-2 flex flex-col gap-1">
              {#each eraOptions as era (era)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editingFilters.eras.includes(era)}
                    onchange={() => updateListFilter('eras', era)}
                  />
                  {era}
                </label>
              {/each}
            </div>
          </details>
          <details class="ur-filter-group">
            <summary class="cursor-pointer text-sm font-semibold"
              >Position · Rarity · Family</summary
            >
            <div class="mt-2 flex flex-col gap-1">
              {#each DETAILED_POSITIONS as position (position)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editingFilters.positions.includes(position)}
                    onchange={() => updateListFilter('positions', position)}
                  />
                  {position}
                </label>
              {/each}
              {#each COLLECTION_RARITY_ORDER as rarity (rarity)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editingFilters.rarities.includes(rarity)}
                    onchange={() => updateListFilter('rarities', rarity)}
                  />
                  {rarity}
                </label>
              {/each}
              {#each FAMILIES as family (family)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editingFilters.families.includes(family)}
                    onchange={() => updateListFilter('families', family)}
                  />
                  {family}
                </label>
              {/each}
            </div>
          </details>
          <details class="ur-filter-group">
            <summary class="cursor-pointer text-sm font-semibold">Set</summary>
            <div class="mt-2 flex flex-col gap-1">
              {#each sets as set (set.setId)}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editingFilters.sets.includes(set.setId)}
                    onchange={() => updateListFilter('sets', set.setId)}
                  />
                  {set.title}
                </label>
              {/each}
            </div>
          </details>
        </div>
        {#if !desktopFilterLayout}
          <div class="ur-filter-dialog-actions">
            <button type="button" class="ur-filter-clear ur-btn-ghost" onclick={resetEditingFilters}
              >Clear</button
            >
            <button type="button" class="ur-filter-apply ur-btn-gold" onclick={() => closeMobileFilters(true)}>
              Apply filters
            </button>
          </div>
        {/if}
      </dialog>

      {#if activeFilterCount > 0 || sort !== 'default'}
        <div class="ur-applied-filters" aria-label="Applied filters">
          <span>Showing</span>
          {#if filters.search}
            <button type="button" onclick={() => clearAppliedFilter('search')}>
              Search: {filters.search}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove search filter</span>
            </button>
          {/if}
          {#if filters.owned !== 'all'}
            <button type="button" onclick={() => clearAppliedFilter('owned')}>
              {filters.owned}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove ownership filter</span>
            </button>
          {/if}
          {#each filters.franchises as franchise (franchise)}
            <button type="button" onclick={() => clearAppliedFilter('franchises', franchise)}>
              {franchise}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove franchise filter</span>
            </button>
          {/each}
          {#each filters.eras as era (era)}
            <button type="button" onclick={() => clearAppliedFilter('eras', era)}>
              {era}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove era filter</span>
            </button>
          {/each}
          {#each filters.positions as position (position)}
            <button type="button" onclick={() => clearAppliedFilter('positions', position)}>
              {position}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove position filter</span>
            </button>
          {/each}
          {#each filters.rarities as rarity (rarity)}
            <button type="button" onclick={() => clearAppliedFilter('rarities', rarity)}>
              {rarity}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove rarity filter</span>
            </button>
          {/each}
          {#each filters.families as family (family)}
            <button type="button" onclick={() => clearAppliedFilter('families', family)}>
              {family}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Remove family filter</span>
            </button>
          {/each}
          {#each filters.sets as setId (setId)}
            <button type="button" onclick={() => clearAppliedFilter('sets', setId)}>
              {sets.find((set) => set.setId === setId)?.title ?? setId}<span aria-hidden="true">
                ×</span
              >
              <span class="sr-only">Remove set filter</span>
            </button>
          {/each}
          {#if sort !== 'default'}
            <button type="button" onclick={clearAppliedSort}>
              Sort: {sort}<span aria-hidden="true"> ×</span>
              <span class="sr-only">Reset sort</span>
            </button>
          {/if}
        </div>
      {/if}

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
        <ul
          class="ur-card-grid mt-3 grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 min-[768px]:grid-cols-4 min-[1100px]:grid-cols-5"
        >
          {#each paged.pageItems as item (item.entry.cardId)}
            <li>
              <CollectionCard
                {item}
                {catalog}
                {manifest}
                selected={selectedCardId === item.entry.cardId}
                onSelect={(cardId) => {
                  selectedCardId = cardId;
                }}
              />
            </li>
          {/each}
        </ul>
        <nav aria-label="Collection pages" class="ur-book-pager mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={paged.page <= 1}
            onclick={() => {
              pageNum = paged.page - 1;
              writeFiltersToUrl();
            }}
            class="ur-book-page-btn ur-btn-ghost px-4 py-2 text-sm outline-none disabled:opacity-40"
          >
            Previous
          </button>
          <span class="ur-number text-sm tabular-nums">Page {paged.page} / {paged.pageCount}</span>
          <button
            type="button"
            disabled={paged.page >= paged.pageCount}
            onclick={() => {
              pageNum = paged.page + 1;
              writeFiltersToUrl();
            }}
            class="ur-book-page-btn ur-btn-ghost px-4 py-2 text-sm outline-none disabled:opacity-40"
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
    activeTargetPlayerId={activeTargetId}
    targetingAvailable={progression !== null && catalog !== null}
    {targetBusy}
    {targetError}
    onSetTarget={(playerId) => void targetPlayer(playerId)}
    onClearTarget={() => void clearTarget()}
    onClose={() => {
      selectedCardId = null;
      targetError = null;
    }}
  />
{/if}

<style>
  .ur-page-description {
    max-width: 55ch;
    margin-top: 0.45rem;
    color: var(--ur-muted);
    font-size: 0.9rem;
  }

  .ur-book-intro {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.1rem;
    padding: 0;
    border: 0;
    background: none;
  }

  .ur-book-title {
    margin: 0.25rem 0 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3.1rem);
    font-weight: 900;
    letter-spacing: -0.035em;
    line-height: 0.95;
    text-shadow: 0 2px 18px rgb(0 0 0 / 60%);
  }

  .ur-book-counts {
    min-width: min(22rem, 100%);
  }

  .ur-card-grid {
    gap: clamp(0.65rem, 1.5vw, 1.15rem);
    overflow: visible;
  }

  .ur-card-grid > li {
    min-width: 0;
    overflow: visible;
  }

  .ur-collection-filters {
    width: min(54rem, calc(100vw - 2rem));
    max-height: min(88svh, 54rem);
    padding: 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    color: var(--ur-paper);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      0 1.5rem 5rem rgb(0 0 0 / 52%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-collection-filters::backdrop {
    background: rgb(3 7 9 / 78%);
    backdrop-filter: blur(4px);
  }

  .ur-mobile-filter-trigger,
  .ur-filter-dialog-close,
  .ur-filter-clear,
  .ur-filter-apply {
    font-size: 0.84rem;
    font-weight: 800;
  }

  .ur-mobile-filter-trigger {
    width: 100%;
    margin-top: 1.5rem;
    justify-content: flex-start;
  }

  .ur-filter-dialog-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .ur-filter-dialog-heading h2 {
    color: #fff;
  }

  .ur-filter-pills > label {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 22%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 40%),
      var(--ur-surface);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%);
  }

  .ur-filter-dialog-close,
  .ur-filter-clear {
    background: var(--ur-surface);
  }

  .ur-filter-apply {
    border-color: var(--ur-apex);
    background: var(--ur-apex);
    color: #241a02;
  }

  .ur-filter-dialog-actions {
    position: sticky;
    bottom: -1rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin: 1rem -1rem -1rem;
    padding: 0.75rem 1rem max(0.75rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--ur-line);
    background: var(--ur-raised);
  }

  .ur-filter-groups {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ur-collection-filters label {
    min-height: 2.75rem;
    color: var(--ur-paper);
  }

  .ur-collection-filters input,
  .ur-collection-filters select {
    color: var(--ur-paper);
  }

  .ur-collection-filters :global(input[type='checkbox']) {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: var(--ur-apex);
  }

  .ur-filter-group {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 20%, var(--ur-line));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 35%),
      var(--ur-raised);
    padding: 0.75rem;
  }

  .ur-filter-group summary {
    min-height: 2rem;
    color: var(--ur-paper);
    font-size: 0.84rem;
    font-weight: 700;
  }

  .ur-filter-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .ur-applied-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.75rem;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }

  .ur-applied-filters button {
    min-height: 2rem;
    padding: 0.25rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line-strong));
    border-radius: 999px;
    background: color-mix(in srgb, var(--ur-surface) 85%, transparent);
    color: var(--ur-paper);
    outline: none;
  }

  .ur-applied-filters button:hover {
    border-color: var(--ur-apex);
  }

  .ur-applied-filters button:focus-visible,
  .ur-mobile-filter-trigger:focus-visible,
  .ur-filter-dialog-close:focus-visible,
  .ur-filter-clear:focus-visible,
  .ur-filter-apply:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  .ur-starter-recap {
    padding: clamp(1rem, 2.5vw, 1.4rem);
  }

  .ur-starter-recap li {
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
  }

  .ur-book-pager .ur-book-page-btn:hover:not(:disabled) {
    border-color: var(--ur-apex);
  }

  .ur-collection-page :global(.ur-set-progress-book) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-collection-page :global(.ur-set-entry) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 22%, var(--ur-line));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 35%),
      var(--ur-bg);
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(1)) {
    border-top: 2px solid var(--ur-apex);
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(1) .ur-set-meter > span) {
    background: linear-gradient(90deg, #8a6a1f, var(--ur-apex));
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(2)) {
    border-top: 2px solid var(--ur-eruption);
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(2) .ur-set-meter > span) {
    background: linear-gradient(90deg, #7a2a18, var(--ur-eruption));
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(3)) {
    border-top: 2px solid var(--ur-eclipse);
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(3) .ur-set-meter > span) {
    background: linear-gradient(90deg, #4c2a9e, var(--ur-eclipse));
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(n + 4)) {
    border-top: 2px solid var(--ur-ember);
  }

  .ur-collection-page :global(.ur-set-entry:nth-child(n + 4) .ur-set-meter > span) {
    background: linear-gradient(90deg, #7a3a1e, var(--ur-ember));
  }

  .ur-collection-page :global(.ur-set-entry > button) {
    border-radius: 0.55rem;
  }

  .ur-collection-page :global(.ur-active-target) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 34%, var(--ur-line-strong));
    border-radius: 0.75rem;
  }

  @media (max-width: 600px) {
    .ur-book-intro {
      align-items: flex-start;
      flex-direction: column;
    }

    .ur-book-counts {
      width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-filter-group {
      scroll-behavior: auto;
    }

    .ur-collection-page :global(*),
    .ur-book-page-btn {
      animation: none !important;
      transition: none !important;
    }
  }

  @media (min-width: 768px) {
    .ur-mobile-filter-trigger,
    .ur-filter-dialog-heading,
    .ur-filter-dialog-actions {
      display: none;
    }

    .ur-collection-filters[open] {
      position: static;
      inset: auto;
      display: block;
      width: 100%;
      max-width: none;
      max-height: none;
      margin: 1.5rem 0 0;
      padding: 0.85rem 0;
      border: 0;
      border-block: 1px solid var(--ur-line-strong);
      background: transparent;
      box-shadow: none;
    }

    .ur-collection-filters::backdrop {
      display: none;
    }

    .ur-filter-groups {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .ur-filter-groups {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
