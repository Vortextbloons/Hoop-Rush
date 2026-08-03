<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
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

  function compareLabel(player: RosterDetailRow): string {
    const added = isCompared(player);
    const suffix = !added && compareFull ? ' (comparison full)' : '';
    return `${added ? 'Remove' : 'Add'} ${player.displayName}${suffix}`;
  }
</script>

<div class="hidden overflow-x-auto sm:block" aria-label={heading}>
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
              colspan={columns.length}
              class="border-b border-border/60 bg-surface-1 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              {franchiseAbbreviation(item.franchiseId)} · {eraLabel.get(item.eraId) ?? item.eraId} ·
              {item.count} players
            </td>
          </tr>
        {:else}
          {@const player = item.player}
          <tr
            class="border-b border-border/40 transition-colors last:border-b-0 hover:bg-surface-2"
          >
            <td class="px-3 py-2">
              <button
                type="button"
                aria-label={`View ${player.displayName} stats`}
                onclick={() => onOpen(player)}
                class="flex min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PlayerFace
                  {player}
                  {manifest}
                  size="sm"
                  fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-bold">{player.displayName}</span>
                  <span class="block font-mono text-[10px] text-muted-foreground">
                    {franchiseAbbreviation(player.franchiseId)}
                  </span>
                </span>
              </button>
            </td>
            <td class="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
              {player.positionsCanonical.join('/')}
            </td>
            <td class="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
              {eraLabel.get(player.eraId) ?? player.eraId}
            </td>
            <td class="px-2 py-2 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
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
            <td class="px-3 py-2 text-right">
              <button
                type="button"
                aria-pressed={isCompared(player)}
                aria-label={compareLabel(player)}
                disabled={compareFull && !isCompared(player)}
                onclick={() => onToggleCompare(player)}
                class="rounded-md border px-2 py-1 font-mono text-[10px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 {isCompared(
                  player,
                )
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
              >
                {isCompared(player) ? 'Added' : 'Compare'}
              </button>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<ul class="flex flex-col gap-1 sm:hidden" aria-label={heading}>
  {#each items as item (groupKey(item))}
    {#if item.type === 'group'}
      <li
        class="px-2 pt-3 pb-1 font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
      >
        {franchiseAbbreviation(item.franchiseId)} · {eraLabel.get(item.eraId) ?? item.eraId} ·
        {item.count} players
      </li>
    {:else}
      {@const player = item.player}
      <li
        class="rounded-lg border border-transparent px-2 py-2.5 transition-colors active:bg-surface-2"
      >
        <div class="flex items-center gap-3">
          <button
            type="button"
            aria-label={`View ${player.displayName} stats`}
            onclick={() => onOpen(player)}
            class="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <button
            type="button"
            aria-pressed={isCompared(player)}
            aria-label={compareLabel(player)}
            disabled={compareFull && !isCompared(player)}
            onclick={() => onToggleCompare(player)}
            class="shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 {isCompared(
              player,
            )
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
          >
            {isCompared(player) ? 'Added' : 'Compare'}
          </button>
        </div>
      </li>
    {/if}
  {/each}
</ul>

{#if hasMore}
  <div class="flex items-center justify-between gap-3 px-1 pb-1">
    <span class="font-mono text-[10px] text-muted-foreground">
      Showing {visiblePlayers.toLocaleString()} of {filteredCount.toLocaleString()} players
    </span>
    <button
      type="button"
      onclick={onShowMore}
      class="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] font-bold text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
    >
      {moreLabel}
    </button>
  </div>
{/if}
