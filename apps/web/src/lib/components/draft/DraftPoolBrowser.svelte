<script lang="ts">
  import type { HoopRushManifest, PlayersIndexEntry, SlotIndex } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import { untrack } from 'svelte';
  import { Search } from '@lucide/svelte';
  import { lowercaseName } from '$lib/roster-browser';
  import {
    ratingBadges,
    type DraftPresentation,
    type RatingBadgeLabel,
  } from '$lib/draft-presentation';
  import { SLOT_INDEXES, SLOT_LABELS, canFillSlot, displacementTargetFor } from '$lib/draft-slots';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  type IndexRow = PlayersIndexEntry;
  const PAGE_SIZE = 48;
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
  let searchInput = $state('');
  let search = $state('');
  let positionFilter = $state<SlotIndex | null>(null);
  let visibleCount = $state(PAGE_SIZE);
  const eraLabel = $derived(new Map(manifest.eras.map((e) => [e.eraId, e.label])));
  function teamLabelFor(player: IndexRow): string {
    const identity = resolveEraTeamIdentity(manifest, player.franchiseId, player.eraId);
    return identity.abbreviationLabel ?? franchiseAbbreviation(player.franchiseId);
  }
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
    displace: {
      incumbent: IndexRow;
      targetSlot: number;
    } | null;
  };
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
  const poolCardInfo = $derived.by(
    (): ReadonlyMap<string, PoolCardInfo> =>
      new Map(visibleRows.map((player) => [player.playerId, poolCardInfoFor(player)])),
  );
</script>

<div class="min-w-0 overflow-x-clip rounded-none bg-surface-1 sm:rounded-xl">
  <div class="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
    <h2
      class="min-w-0 truncate font-display text-base font-extrabold tracking-tight uppercase sm:text-lg"
      title={heading}
    >
      {heading}
    </h2>
    <span
      class="max-w-[46%] shrink-0 truncate text-right text-[10px] text-muted-foreground sm:text-label"
    >
      {countLabel}
    </span>
  </div>
  {#if filtersEditable}
    <div class="flex min-w-0 flex-col gap-2 px-2 pb-2 sm:px-2">
      <div class="relative min-w-0">
        <Search
          class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          bind:value={searchInput}
          placeholder="Search players…"
          aria-label="Search players by name"
          class="h-10 w-full rounded-lg bg-surface-2 pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div
        class="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Filter by position"
      >
        <button
          type="button"
          aria-pressed={positionFilter === null}
          onclick={() => (positionFilter = null)}
          class="shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
          null
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
        >
          All
        </button>
        {#each SLOT_INDEXES as i (i)}
          <button
            type="button"
            aria-pressed={positionFilter === i}
            onclick={() => (positionFilter = positionFilter === i ? null : i)}
            class="shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
            i
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
          >
            {SLOT_LABELS[i]}
          </button>
        {/each}
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
      class="grid max-h-[55vh] min-w-0 gap-1 overflow-x-hidden overflow-y-auto p-1.5 sm:max-h-[560px] sm:grid-cols-2 sm:p-2 xl:grid-cols-3"
    >
      {#each visibleRows as player (player.franchiseId + '/' + player.eraId + '/' + player.playerId)}
        {@const card = poolCardInfo.get(player.playerId) ?? {
          state: 'blocked',
          displace: null,
        }}
        {@const cardState = card.state}
        <li class="min-w-0">
          <button
            type="button"
            disabled={cardState === 'blocked'}
            aria-disabled={cardState === 'blocked' ? 'true' : undefined}
            onclick={() => onpick(player)}
            class="flex w-full items-center gap-2 rounded-lg py-2 pr-2.5 pl-2 text-left sm:gap-3 sm:py-2.5 sm:pr-5 sm:pl-3 {cardState ===
            'lineup'
              ? 'bg-primary/10 opacity-60'
              : cardState === 'displace'
                ? 'bg-accent/10 opacity-90 shadow-[0_0_8px_hsl(42_91%_61%/0.15)] hover:bg-accent/20 hover:opacity-100'
                : cardState === 'blocked'
                  ? 'opacity-40 disabled:cursor-not-allowed'
                  : 'hover:bg-surface-2'}"
          >
            <PlayerFace
              {player}
              {manifest}
              size="md"
              fallbackInitials={player.firstName[0]! + player.lastName[0]!}
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-bold leading-tight"
                >{player.displayName}</span
              >
              <span
                class="block truncate font-mono text-[10px] leading-tight text-muted-foreground"
              >
                {player.seasonKey} · {teamLabelFor(player)}
              </span>
              <span
                class="block truncate font-mono text-[10px] leading-tight text-muted-foreground"
              >
                {eraLabel.get(player.eraId) ?? player.eraId} · {formatPositions(
                  player.positionsPlayable,
                )}
              </span>
            </span>
            <span class="ml-1 flex shrink-0 gap-1 font-mono text-[10px]">
              {#each ratingBadges(player, presentation) as badge (badge.label)}
                <span
                  class="rounded-full bg-surface-3 px-1.5 py-0.5 sm:px-2"
                  title={BADGE_TITLES[badge.label]}
                >
                  {`${badge.label} ${badge.value}`}
                </span>
              {/each}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if hasMore}
      <div class="flex justify-center gap-3 p-2 sm:justify-end">
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
