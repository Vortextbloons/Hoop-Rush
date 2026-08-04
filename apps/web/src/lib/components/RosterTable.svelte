<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import {
    formatDecimal,
    formatPct,
    formatPerGame,
    perGame,
    type RosterColumn,
    type RosterDetailRow,
    type RosterListItem,
    type RosterSortDirection,
    type RosterSortId,
  } from '$lib/roster-browser';
  import PlayerFace from './PlayerFace.svelte';

  /**
   * The Roster browser's data grid: a responsive desktop table plus mobile
   * cards over the same flattened items, with sortable headers and the
   * compare/selection affordances. The page owns the pipeline (filter, sort,
   * group, paginate) and passes the resulting items here for presentation.
   */

  let {
    items,
    columns,
    sortId,
    sortDir,
    eraLabel,
    manifest,
    heading,
    hasMore,
    visiblePlayers,
    filteredCount,
    onSort,
    onOpen,
    isCompared,
    onToggleCompare,
    compareFull,
    onShowMore,
    moreLabel = 'Show more',
  }: {
    items: RosterListItem[];
    columns: RosterColumn[];
    sortId: RosterSortId;
    sortDir: RosterSortDirection;
    eraLabel: Map<string, string>;
    manifest: HoopRushManifest;
    heading: string;
    hasMore: boolean;
    visiblePlayers: number;
    filteredCount: number;
    onSort: (id: RosterSortId) => void;
    onOpen: (player: RosterDetailRow) => void;
    isCompared: (player: RosterDetailRow) => boolean;
    onToggleCompare: (player: RosterDetailRow) => void;
    compareFull: boolean;
    onShowMore: () => void;
    moreLabel?: string;
  } = $props();

  const sortArrow = $derived(sortId === 'none' ? '' : sortDir === 'asc' ? '↑' : '↓');

  const groupKey = (item: RosterListItem): string =>
    item.type === 'group'
      ? `group:${item.franchiseId}/${item.eraId}`
      : `row:${item.player.franchiseId}/${item.player.eraId}/${item.player.playerId}`;

  /** Historical display label for a franchise/era context, modern fallback. */
  function groupLabel(franchiseId: string, eraId: string): string {
    const identity = resolveEraTeamIdentity(manifest, franchiseId, eraId);
    return identity.displayLabel ?? franchiseAbbreviation(franchiseId);
  }

  /** Historical abbreviation for one row's franchise/era context. */
  function teamLabelFor(player: RosterDetailRow): string {
    const identity = resolveEraTeamIdentity(manifest, player.franchiseId, player.eraId);
    return identity.abbreviationLabel ?? franchiseAbbreviation(player.franchiseId);
  }

  function compareLabel(player: RosterDetailRow): string {
    const added = isCompared(player);
    const suffix = !added && compareFull ? ' (comparison full)' : '';
    return `${added ? 'Remove' : 'Add'} ${player.displayName} to comparison${suffix}`;
  }

  function hideClass(hideBelow?: 'md' | 'lg'): string {
    if (!hideBelow) return '';
    return hideBelow === 'md' ? 'hidden md:table-cell' : 'hidden lg:table-cell';
  }

  function cellValue(player: RosterDetailRow, key: string): string {
    switch (key) {
      case 'pos':
        return player.positionsPlayable.join('/');
      case 'decade':
        return eraLabel.get(player.eraId) ?? player.eraId;
      case 'season':
        return player.seasonKey;
      case 'overall':
        return String(player.overall);
      case 'points':
        return formatPerGame(perGame(player.stats, 'points'));
      case 'rebounds':
        return formatPerGame(perGame(player.stats, 'rebounds'));
      case 'assists':
        return formatPerGame(perGame(player.stats, 'assists'));
      case 'ts':
        return formatPct(player.stats.tsPct ?? 0);
      case 'per':
        return formatDecimal(player.stats.per ?? 0);
      default:
        return '';
    }
  }

  function rowActionTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('input,button,label,a') !== null;
  }
</script>

<div class="hidden sm:block" aria-label={heading}>
  <p class="mb-2 text-xs text-muted-foreground lg:hidden">
    Scroll horizontally for more stats
  </p>
  <div
    class="overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]"
    style="scrollbar-gutter: stable;"
  >
    <table class="min-w-[720px] w-full border-separate border-spacing-0 text-left">
      <thead>
        <tr>
          <th
            scope="col"
            class="sticky left-0 z-20 w-10 border-b border-border bg-card px-2 py-3"
          >
            <span class="sr-only">Compare</span>
          </th>
          {#each columns as col (col.key)}
            <th
              scope="col"
              class="border-b border-border px-2 py-3 text-xs font-bold tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase {col.key ===
              'player'
                ? 'sticky left-10 z-20 min-w-[180px] bg-card pl-3 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.4)]'
                : ''} {col.numeric ? 'text-right' : ''} {hideClass(col.hideBelow)}"
            >
              {#if col.sort}
                <button
                  type="button"
                  aria-pressed={sortId === col.sort}
                  onclick={() => onSort(col.sort!)}
                  class="inline-flex items-center gap-1 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring {sortId ===
                  col.sort
                    ? 'text-primary'
                    : ''}"
                >
                  {col.label}
                  {#if sortId === col.sort}
                    <span aria-hidden="true">{sortArrow}</span>
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
        {#each items as item (groupKey(item))}
          {#if item.type === 'group'}
            <tr>
              <td
                colspan={columns.length + 1}
                class="border-b border-border/60 bg-surface-1 px-3 py-2 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase"
              >
                {groupLabel(item.franchiseId, item.eraId)} · {eraLabel.get(item.eraId) ??
                  item.eraId} · {item.count} players
              </td>
            </tr>
          {:else}
            {@const player = item.player}
            <tr
              role="button"
              tabindex="0"
              aria-label={`View ${player.displayName} stats`}
              onclick={(event) => {
                if (!rowActionTarget(event.target)) onOpen(player);
              }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen(player);
                }
              }}
              class="cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-surface-2 group"
            >
              <td
                class="sticky left-0 z-10 bg-card px-2 py-3 group-hover:bg-surface-2"
              >
                <label class="flex cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={isCompared(player)}
                    disabled={compareFull && !isCompared(player)}
                    aria-label={compareLabel(player)}
                    onclick={(event) => event.stopPropagation()}
                    onchange={() => onToggleCompare(player)}
                    class="h-4 w-4 rounded border-border accent-primary"
                  />
                </label>
              </td>
              <td
                class="sticky left-10 z-10 min-w-[180px] bg-card px-3 py-3 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.4)] group-hover:bg-surface-2"
              >
                <div class="flex min-w-0 items-center gap-2.5">
                  <PlayerFace
                    {player}
                    {manifest}
                    size="md"
                    fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-base font-bold">{player.displayName}</span>
                    <span class="block text-xs text-muted-foreground">
                      {teamLabelFor(player)}
                    </span>
                  </span>
                </div>
              </td>
              {#each columns.filter((c) => c.key !== 'player') as col (col.key)}
                <td
                  class="px-2 py-3 text-sm whitespace-nowrap {col.numeric
                    ? 'text-right font-mono tabular-nums'
                    : 'text-muted-foreground'} {col.key === 'overall' ? 'font-bold text-foreground' : ''} {hideClass(
                    col.hideBelow,
                  )}"
                >
                  {cellValue(player, col.key)}
                </td>
              {/each}
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>

<ul class="flex flex-col gap-2 sm:hidden" aria-label={heading}>
  {#each items as item (groupKey(item))}
    {#if item.type === 'group'}
      <li class="px-1 pt-3 pb-1 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
        {groupLabel(item.franchiseId, item.eraId)} · {eraLabel.get(item.eraId) ?? item.eraId} · {item.count}
        players
      </li>
    {:else}
      {@const player = item.player}
      <li>
        <div
          role="button"
          tabindex="0"
          aria-label={`View ${player.displayName} stats`}
          onclick={(event) => {
            if (!rowActionTarget(event.target)) onOpen(player);
          }}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(player);
            }
          }}
          class="cursor-pointer rounded-lg bg-card px-3 py-4 transition-colors hover:bg-surface-2"
        >
          <div class="flex items-start gap-3">
            <span class="mt-1 flex shrink-0 items-center">
              <input
                type="checkbox"
                checked={isCompared(player)}
                disabled={compareFull && !isCompared(player)}
                aria-label={compareLabel(player)}
                onclick={(event) => event.stopPropagation()}
                onchange={() => onToggleCompare(player)}
                class="h-4 w-4 cursor-pointer rounded border-border accent-primary"
              />
            </span>
            <PlayerFace
              {player}
              {manifest}
              size="md"
              fallbackInitials={player.firstName[0]! + player.lastName[0]!}
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-base font-bold">{player.displayName}</span>
              <span class="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {teamLabelFor(player)} · {eraLabel.get(player.eraId) ?? player.eraId} · {player.seasonKey}
                · {player.positionsPlayable.join('/')}
              </span>
            </span>
          </div>
          <div
            class="mt-3 grid grid-cols-4 gap-1 rounded-md bg-surface-1 p-2 text-center text-xs"
          >
            <span class="rounded px-1 py-0.5">
              <span class="block text-[10px] text-muted-foreground uppercase">O</span>
              <span class="text-stat block font-bold">{player.overall}</span>
            </span>
            <span class="rounded px-1 py-0.5">
              <span class="block text-[10px] text-muted-foreground uppercase">PTS</span>
              <span class="text-stat block font-bold"
                >{formatPerGame(perGame(player.stats, 'points'))}</span
              >
            </span>
            <span class="rounded px-1 py-0.5">
              <span class="block text-[10px] text-muted-foreground uppercase">REB</span>
              <span class="text-stat block font-bold"
                >{formatPerGame(perGame(player.stats, 'rebounds'))}</span
              >
            </span>
            <span class="rounded px-1 py-0.5">
              <span class="block text-[10px] text-muted-foreground uppercase">AST</span>
              <span class="text-stat block font-bold"
                >{formatPerGame(perGame(player.stats, 'assists'))}</span
              >
            </span>
          </div>
        </div>
      </li>
    {/if}
  {/each}
</ul>

{#if hasMore}
  <div class="flex items-center justify-between gap-3 px-1 pb-1 pt-2">
    <span class="text-xs text-muted-foreground">
      Showing {visiblePlayers.toLocaleString()} of {filteredCount.toLocaleString()} players
    </span>
    <button
      type="button"
      onclick={onShowMore}
      class="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-bold text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3"
    >
      {moreLabel}
    </button>
  </div>
{/if}
