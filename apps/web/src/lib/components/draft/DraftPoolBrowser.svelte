<script lang="ts">
  import type {
    HoopRushManifest,
    PlayersIndexEntry,
    ProjectionSlot,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import type { DraftFitNeed, DraftFitTier, LineupRepositionPlan } from '@hoop-rush/engine';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import { untrack } from 'svelte';
  import { Search } from '@lucide/svelte';
  import { lowercaseName } from '$lib/roster-browser';
  import {
    FIT_NEED_META,
    FIT_TIER_META,
    DRAFT_POOL_PAGE_SIZE,
    formatNetDelta,
    poolRowKey,
  } from '$lib/draft-fit';
  import {
    ratingBadges,
    type DraftPresentation,
    type RatingBadgeLabel,
  } from '$lib/draft-presentation';
  import { SLOT_INDEXES, SLOT_LABELS, canFillSlot, planPlayerMove } from '$lib/draft-slots';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  type IndexRow = PlayersIndexEntry;
  const PAGE_SIZE = DRAFT_POOL_PAGE_SIZE;
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
    selectionDisabled = false,
    fitByRow = null,
    onpick,
    onvisible,
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
    selectionDisabled?: boolean;
    fitByRow?: ReadonlyMap<
      string,
      {
        tier: DraftFitTier;
        need: DraftFitNeed;
        netDelta: number | null;
        worstNetDelta?: number | null;
        warningLabel?: string | null;
        recommendedSlot?: ProjectionSlot | null;
      }
    > | null;
    onpick: (player: IndexRow) => void;
    onvisible?: (rows: IndexRow[]) => void;
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
      plan: LineupRepositionPlan;
    } | null;
  };
  function rowKey(player: IndexRow): string {
    return `${player.franchiseId}/${player.eraId}/${player.seasonKey}/${player.playerId}`;
  }
  function poolCardInfoFor(player: IndexRow): PoolCardInfo {
    if (slots.some((p) => p !== null && p.playerId === player.playerId)) {
      return { state: 'lineup', displace: null };
    }
    let displace: PoolCardInfo['displace'] = null;
    for (const i of SLOT_INDEXES) {
      const incumbent = slots[i] ?? null;
      const plan = planPlayerMove(slots, player, i);
      if (plan === null) continue;
      if (!incumbent) return { state: 'place', displace: null };
      if (displace === null) {
        displace = { incumbent, plan };
      }
    }
    return displace !== null && allowDisplacement
      ? { state: 'displace', displace }
      : { state: 'blocked', displace: null };
  }
  const poolCardInfo = $derived.by(
    (): ReadonlyMap<string, PoolCardInfo> =>
      new Map(visibleRows.map((player) => [rowKey(player), poolCardInfoFor(player)])),
  );
  // Fit map is keyed by franchise/era/player so global pools with repeat
  // playerIds still resolve to the right row.
  const showFit = $derived(presentation !== 'ball-knowledge' && fitByRow !== null);
  let lastVisibleKey = '';
  $effect(() => {
    if (!onvisible) return;
    const current = visibleRows;
    const key = current.map((player) => rowKey(player)).join(',');
    if (key === lastVisibleKey) return;
    lastVisibleKey = key;
    onvisible(current);
  });
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
      {#each visibleRows as player (rowKey(player))}
        {@const card = poolCardInfo.get(rowKey(player)) ?? {
          state: 'blocked',
          displace: null,
        }}
        {@const cardState = card.state}
        <li class="min-w-0">
          <button
            type="button"
            disabled={selectionDisabled || cardState === 'blocked'}
            aria-disabled={selectionDisabled || cardState === 'blocked' ? 'true' : undefined}
            onclick={() => {
              if (!selectionDisabled) onpick(player);
            }}
            class="flex w-full items-center gap-2 rounded-lg py-2 pr-2.5 pl-2 text-left sm:gap-3 sm:py-2.5 sm:pr-5 sm:pl-3 {cardState ===
            'lineup'
              ? 'bg-primary/10 opacity-60'
              : cardState === 'displace'
                ? 'bg-accent/10 opacity-90 shadow-[0_0_8px_hsl(42_91%_61%/0.15)] hover:bg-accent/20 hover:opacity-100'
                : selectionDisabled || cardState === 'blocked'
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
              {#if cardState === 'displace' && card.displace}
                {@const movedCount = Math.max(1, card.displace.plan.moves.length - 1)}
                <span class="block truncate font-mono text-[10px] leading-tight text-accent">
                  Rearranges {movedCount} player{movedCount === 1 ? '' : 's'}
                </span>
              {/if}
              {#if showFit}
                {@const fit = fitByRow?.get(poolRowKey(player)) ?? null}
                {#if fit}
                  {@const tier = FIT_TIER_META[fit.tier]}
                  {@const need = FIT_NEED_META[fit.need]}
                  <span
                    class="flex items-center gap-1 truncate font-mono text-[10px] leading-tight"
                    title={`${tier.label} · fills ${need.label}${fit.recommendedSlot ? ` · best in ${fit.recommendedSlot}` : ''}${fit.netDelta === null ? '' : ` · ${formatNetDelta(fit.netDelta)} across references`}${fit.worstNetDelta === null || fit.worstNetDelta === undefined ? '' : ` · worst ${formatNetDelta(fit.worstNetDelta)}`}${fit.warningLabel ? ` · watch: ${fit.warningLabel}` : ''}`}
                    data-fit-row={fit.tier}
                  >
                    <span class="h-2 w-2 shrink-0 rounded-full {tier.dot}" aria-hidden="true"
                    ></span>
                    <span class="truncate text-muted-foreground">{tier.label} · {need.label}</span>
                  </span>
                {/if}
              {/if}
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
