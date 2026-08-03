<script lang="ts">
  import type { HoopRushManifest, PlayersIndexEntry, SlotIndex } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { untrack } from 'svelte';
  import { Search } from '@lucide/svelte';
  import { lowercaseName } from '$lib/roster-browser';
  import {
    ratingBadges,
    type DraftPresentation,
    type RatingBadgeLabel,
  } from '$lib/draft-presentation';
  import {
    SLOT_INDEXES,
    SLOT_LABELS,
    SLOT_NAMES,
    canFillSlot,
    displacementTargetFor,
  } from '$lib/draft-slots';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  type IndexRow = PlayersIndexEntry;

  const PAGE_SIZE = 48;

  /** Typing delay before the pool list re-filters the players index. */
  const SEARCH_DEBOUNCE_MS = 80;

  const BADGE_TITLES: Record<RatingBadgeLabel, string> = {
    O: 'Overall',
  };

  let {
    heading,
    rows,
    slots,
    countLabel,
    filtersEditable,
    manifest,
    presentation,
    error,
    emptyMessage,
    allowDisplacement = true,
    onpick,
  }: {
    heading: string;
    rows: IndexRow[];
    slots: (IndexRow | null)[];
    countLabel: string;
    filtersEditable: boolean;
    manifest: HoopRushManifest;
    presentation: DraftPresentation;
    error: string | null;
    emptyMessage: string;
    allowDisplacement?: boolean;
    onpick: (player: IndexRow) => void;
  } = $props();

  /** Raw input value; `search` below is the debounced query the pool reads. */
  let searchInput = $state('');
  let search = $state('');
  let positionFilter = $state<SlotIndex | null>(null);
  let visibleCount = $state(PAGE_SIZE);

  const eraLabel = $derived(new Map(manifest.eras.map((e) => [e.eraId, e.label])));

  $effect(() => {
    const raw = searchInput;
    const timeout = setTimeout(() => {
      search = raw;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  });

  const filteredRows = $derived.by(() => {
    if (!filtersEditable) return rows;
    let list = rows;
    const position = positionFilter;
    if (position !== null) {
      list = list.filter((p) => canFillSlot(p, position));
    }
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((p) => lowercaseName(p).includes(query));
    }
    return list;
  });

  const visibleRows = $derived(filteredRows.slice(0, visibleCount));
  const hasMore = $derived(filteredRows.length > visibleCount);
  const visiblePlayers = $derived(Math.min(visibleCount, filteredRows.length));

  // Reset the draft's local filters whenever the pool scope or editability
  // changes so a new rolled pool (Classic) or a new franchise/era scope
  // (Sandbox) always starts with an unfiltered, fresh list. The effect's
  // dependency set stays [rows, filtersEditable]: the value comparisons are
  // untracked reads, and every write is value-guarded so an unchanged scope
  // never invalidates state or schedules a second effect cycle.
  $effect(() => {
    void [rows, filtersEditable];
    const input = untrack(() => searchInput);
    const query = untrack(() => search);
    const position = untrack(() => positionFilter);
    const visible = untrack(() => visibleCount);
    if (input !== '') searchInput = '';
    if (query !== '') search = '';
    if (position !== null) positionFilter = null;
    if (visible !== PAGE_SIZE) visibleCount = PAGE_SIZE;
  });

  type PoolCardState = 'lineup' | 'place' | 'displace' | 'blocked';

  type PoolCardInfo = {
    state: PoolCardState;
    /** Who gets moved and where when this card's take-over is used. */
    displace: { incumbent: IndexRow; targetSlot: number } | null;
  };

  /**
   * Eligibility shown on the pool card itself, before any click. A player is
   * "place" whenever any eligible slot is open; the displace highlight is
   * reserved for the case where displacement is the only option.
   */
  function poolCardInfoFor(player: IndexRow): PoolCardInfo {
    if (slots.some((p) => p !== null && p.playerId === player.playerId)) {
      return { state: 'lineup', displace: null };
    }
    let displace: PoolCardInfo['displace'] = null;
    for (const i of SLOT_INDEXES) {
      if (!canFillSlot(player, i)) continue;
      const incumbent = slots[i] ?? null;
      if (!incumbent) return { state: 'place', displace: null };
      if (displace === null) {
        const target = displacementTargetFor(slots, incumbent, i, -1);
        if (target !== null) displace = { incumbent, targetSlot: target };
      }
    }
    return displace !== null && allowDisplacement
      ? { state: 'displace', displace }
      : { state: 'blocked', displace: null };
  }

  /**
   * Card eligibility for every visible pool row, keyed by playerId. The cards
   * only depend on the lineup slots (plus each player's positions), so the map
   * is rebuilt once per slot change and looked up in the template instead of
   * recomputing per rendered row.
   */
  const poolCardInfo = $derived.by(
    (): ReadonlyMap<string, PoolCardInfo> =>
      new Map(visibleRows.map((player) => [player.playerId, poolCardInfoFor(player)])),
  );
</script>

<div class="rounded-xl border border-border bg-card">
  <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
    <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">{heading}</h2>
    <span class="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
      {countLabel}
    </span>
  </div>
  {#if filtersEditable}
    <div class="flex flex-col gap-2 border-b border-border p-2">
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
        {#each SLOT_INDEXES as i (i)}
          <button
            type="button"
            aria-pressed={positionFilter === i}
            onclick={() => (positionFilter = positionFilter === i ? null : i)}
            class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
            i
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
          >
            {SLOT_LABELS[i]}
          </button>
        {/each}
        <span class="ml-auto shrink-0 pl-1 font-mono text-[10px] text-muted-foreground">
          {filteredRows.length}/{rows.length}
        </span>
      </div>
    </div>
  {/if}
  {#if error}
    <p
      class="border-b border-border/60 p-4 text-sm text-destructive"
      role="alert"
      aria-live="assertive"
    >
      {error}
    </p>
  {/if}
  {#if filteredRows.length === 0}
    <p class="p-6 text-center font-mono text-xs text-muted-foreground">{emptyMessage}</p>
  {:else}
    <ul
      class="grid max-h-[55vh] gap-1 overflow-y-auto p-2 sm:max-h-[560px] sm:grid-cols-2 xl:grid-cols-3"
    >
      {#each visibleRows as player (player.franchiseId + '/' + player.eraId + '/' + player.playerId)}
        {@const card = poolCardInfo.get(player.playerId) ?? {
          state: 'blocked',
          displace: null,
        }}
        {@const cardState = card.state}
        <li>
          <button
            type="button"
            disabled={cardState === 'blocked'}
            aria-disabled={cardState === 'blocked' ? 'true' : undefined}
            onclick={() => onpick(player)}
            class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left {cardState ===
            'lineup'
              ? 'border-primary/50 bg-primary/10 opacity-60'
              : cardState === 'displace'
                ? 'border-accent/50 bg-accent/10 opacity-90 shadow-[0_0_8px_hsl(42_91%_61%/0.15)] hover:bg-accent/20 hover:opacity-100'
                : cardState === 'blocked'
                  ? 'border-transparent opacity-40 disabled:cursor-not-allowed'
                  : 'border-transparent hover:border-border hover:bg-surface-2'}"
          >
            <PlayerFace
              {player}
              {manifest}
              size="md"
              fallbackInitials={player.firstName[0]! + player.lastName[0]!}
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-bold">{player.displayName}</span>
              <span class="block font-mono text-[10px] text-muted-foreground">
                {player.seasonKey} · {franchiseAbbreviation(player.franchiseId)} · {eraLabel.get(
                  player.eraId,
                ) ?? player.eraId} · {player.positionsPlayable.join('/')}
              </span>
            </span>
            <span class="flex shrink-0 gap-1 font-mono text-[10px]">
              {#each ratingBadges(player, presentation) as badge (badge.label)}
                <span class="rounded bg-surface-3 px-1.5 py-0.5" title={BADGE_TITLES[badge.label]}>
                  {`${badge.label} ${badge.value}`}
                </span>
              {/each}
              {#if cardState === 'displace' && card.displace}
                <span
                  class="rounded bg-accent/25 px-1.5 py-0.5 font-bold text-accent"
                  title={`Moves ${card.displace.incumbent.displayName} to ${SLOT_NAMES[card.displace.targetSlot]}`}
                >
                  Moves {card.displace.incumbent.displayName.split(' ').pop()}
                </span>
              {:else if cardState === 'blocked'}
                <span
                  class="rounded bg-surface-3 px-1.5 py-0.5 text-muted-foreground"
                  title="No open or movable position"
                >
                  No slot
                </span>
              {/if}
            </span>
          </button>
        </li>
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
