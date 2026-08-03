<script lang="ts">
  import type { HoopRushManifest, PlayersIndexEntry, SlotIndex } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { canPlay, slotRequirement } from '@hoop-rush/engine';
  import { Search } from '@lucide/svelte';
  import { lowercaseName } from '$lib/roster-browser';
  import {
    ratingBadges,
    type DraftPresentation,
    type RatingBadgeLabel,
  } from '$lib/draft-presentation';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  type IndexRow = PlayersIndexEntry;

  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const SLOT_NAMES = [
    'Point Guard',
    'Shooting Guard',
    'Small Forward',
    'Power Forward',
    'Center',
  ] as const;
  const SLOT_INDEXES = [0, 1, 2, 3, 4] as const;
  const PAGE_SIZE = 120;

  /** Typing delay before the pool list re-filters the players index. */
  const SEARCH_DEBOUNCE_MS = 200;

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
    if (positionFilter !== null) {
      const requirement = slotRequirement(positionFilter);
      list = list.filter((p) => p.positionsCanonical.includes(requirement));
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
  // (Sandbox) always starts with an unfiltered, fresh list.
  $effect(() => {
    void [rows, filtersEditable];
    searchInput = '';
    search = '';
    positionFilter = null;
    visibleCount = PAGE_SIZE;
  });

  function canFillSlot(player: IndexRow, slotIndex: number): boolean {
    return canPlay(player.positionsCanonical, slotRequirement(slotIndex as SlotIndex));
  }

  /**
   * Where a displaced incumbent can land: the first open slot it can fill,
   * including the slot the incoming player is vacating. Returns null when the
   * incumbent cannot move anywhere.
   */
  function displacementTargetFor(
    incumbent: IndexRow,
    targetSlot: number,
    subjectSlot: number,
  ): number | null {
    for (const i of SLOT_INDEXES) {
      if (i === targetSlot) continue;
      const willBeOpen = i === subjectSlot || slots[i] === null;
      if (!willBeOpen) continue;
      if (canFillSlot(incumbent, i)) return i;
    }
    return null;
  }

  type PoolCardState = 'lineup' | 'place' | 'displace' | 'blocked';

  type PoolCardInfo = {
    state: PoolCardState;
    /** Who gets moved and where when this card's take-over is used. */
    displace: { incumbent: IndexRow; targetSlot: number } | null;
  };

  /**
   * Eligibility shown on the pool card itself, before any click. A player is
   * "place" whenever any eligible slot is open; the displace highlight is
   * reserved for the case where displacement is the only option. Classic
   * drafts pass allowDisplacement={false}, so a displace-only case reads as
   * blocked with no "Moves X" affordance.
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
        const target = displacementTargetFor(incumbent, i, -1);
        if (target !== null) displace = { incumbent, targetSlot: target };
      }
    }
    return displace !== null && allowDisplacement
      ? { state: 'displace', displace }
      : { state: 'blocked', displace: null };
  }

  /**
   * Card eligibility for every pool row, keyed by playerId. The cards only
   * depend on the lineup slots (plus each player's positions), so the map is
   * rebuilt once per slot change and looked up in the template instead of
   * recomputing per rendered row.
   */
  const poolCardInfo = $derived.by(
    (): ReadonlyMap<string, PoolCardInfo> =>
      new Map(rows.map((player) => [player.playerId, poolCardInfoFor(player)])),
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
    <p class="border-b border-border/60 p-4 text-sm text-destructive">{error}</p>
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
                ) ?? player.eraId} · {player.positionsCanonical.join('/')}
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
