<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { onMount } from 'svelte';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import {
    formatDecimal,
    formatPct,
    formatPerGame,
    perGame,
    type RosterColumn,
    type RosterRow,
    type RosterListItem,
    type RosterSortDirection,
    type RosterSortId,
  } from '#lib/roster-browser.js';
  import { teamLabelFor } from '#lib/branding.js';
  import { formatPositions } from '#lib/player-positions.js';
  import PlayerFace from './PlayerFace.svelte';
  import TeamLogo from './TeamLogo.svelte';
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
    filterFranchiseId = '',
    filterEraId = '',
    filterPosition = null as 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null,
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
    onOpen: (player: RosterRow) => void;
    isCompared: (player: RosterRow) => boolean;
    onToggleCompare: (player: RosterRow) => void;
    compareFull: boolean;
    onShowMore: () => void;
    moreLabel?: string;
    filterFranchiseId?: string;
    filterEraId?: string;
    filterPosition?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  } = $props();
  const sortArrow = $derived(sortId === 'none' ? '' : sortDir === 'asc' ? '↑' : '↓');
  const dataColumns = $derived(columns.filter((c) => c.key !== 'player'));
  const groupKey = (item: RosterListItem): string =>
    item.type === 'group'
      ? `group:${item.franchiseId}/${item.eraId}`
      : `row:${item.player.franchiseId}/${item.player.eraId}/${item.player.playerId}`;
  function groupLabel(franchiseId: string, eraId: string): string {
    const identity = resolveEraTeamIdentity(manifest, franchiseId, eraId);
    return identity.displayLabel ?? franchiseAbbreviation(franchiseId);
  }
  function teamSlotFor(player: RosterRow): string | null {
    return (
      manifest.modernFranchiseSlots.find((entry) => entry.franchiseId === player.franchiseId)
        ?.teamExternalId ?? null
    );
  }
  function logoCandidatesFor(player: RosterRow): string[] {
    return resolveEraTeamIdentity(manifest, player.franchiseId, player.eraId).logoCandidates ?? [];
  }
  function compareLabel(player: RosterRow): string {
    const added = isCompared(player);
    const suffix = !added && compareFull ? ' (comparison full)' : '';
    return `${added ? 'Remove' : 'Add'} ${player.displayName} to comparison${suffix}`;
  }
  function hideClass(hideBelow?: 'md' | 'lg'): string {
    if (!hideBelow) return '';
    return hideBelow === 'md' ? 'hidden md:table-cell' : 'hidden lg:table-cell';
  }
  function cellValue(player: RosterRow, key: string): string {
    const stats = player.detail?.stats ?? null;
    switch (key) {
      case 'pos':
        return formatPositions(player.positionsPlayable);
      case 'decade':
        return eraLabel.get(player.eraId) ?? player.eraId;
      case 'season':
        return player.seasonKey;
      case 'overall':
        return String(player.overall);
      case 'games':
        return stats ? String(stats.gamesPlayed) : '…';
      case 'usage':
        if (!stats) return '…';
        return stats.usageRate === null ? '—' : `${formatDecimal(stats.usageRate)}%`;
      case 'points':
        return stats ? formatPerGame(perGame(stats, 'points')) : '…';
      case 'rebounds':
        return stats ? formatPerGame(perGame(stats, 'rebounds')) : '…';
      case 'assists':
        return stats ? formatPerGame(perGame(stats, 'assists')) : '…';
      case 'ts':
        return stats ? formatPct(stats.tsPct) : '…';
      case 'per':
        return stats ? formatDecimal(stats.per) : '…';
      default:
        return '';
    }
  }
  function rowActionTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('input,button,label,a') !== null;
  }
  function openPlayerRow(player: RosterRow) {
    onOpen(player);
    if (!isCompared(player) && !compareFull) onToggleCompare(player);
  }
  function playerMetaLine(player: RosterRow): string {
    const parts: string[] = [];
    if (!filterFranchiseId) {
      parts.push(teamLabelFor(manifest, player.franchiseId, player.eraId));
    }
    if (!filterEraId) {
      parts.push(eraLabel.get(player.eraId) ?? player.eraId);
    }
    parts.push(player.seasonKey);
    if (!filterPosition) {
      parts.push(formatPositions(player.positionsPlayable));
    }
    return parts.join(' · ');
  }
  const showTeamInPlayerCell = $derived(!filterFranchiseId);
  // Render one layout only: the hidden breakpoint variant still costs DOM,
  // images and row diffing for every row.
  let desktop = $state(true);
  onMount(() => {
    const media = window.matchMedia('(min-width: 640px)');
    desktop = media.matches;
    const update = (event: MediaQueryListEvent): void => {
      desktop = event.matches;
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
</script>

{#if desktop}
  <div aria-label={heading}>
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
                  class="bg-surface-2/80 px-3 py-2 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase first:rounded-t-lg"
                >
                  {groupLabel(item.franchiseId, item.eraId)} · {eraLabel.get(item.eraId) ??
                    item.eraId} · {item.count} players
                </td>
              </tr>
            {:else}
              {@const player = item.player}
              {@const teamExternalId = teamSlotFor(player)}
              <tr
                role="button"
                tabindex="0"
                aria-label={`View ${player.displayName} stats`}
                onclick={(event) => {
                  if (!rowActionTarget(event.target)) openPlayerRow(player);
                }}
                onkeydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openPlayerRow(player);
                  }
                }}
                class="cursor-pointer transition-colors hover:bg-surface-2 group"
                data-virtual-row
              >
                <td class="sticky left-0 z-10 bg-card px-2 py-3 group-hover:bg-surface-2">
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
                      {#if showTeamInPlayerCell}
                        <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {#if teamExternalId}
                            <TeamLogo
                              {manifest}
                              franchiseId={player.franchiseId}
                              {teamExternalId}
                              logoCandidates={logoCandidatesFor(player)}
                              className="h-4 w-4"
                            />
                          {/if}
                          <span class="truncate"
                            >{teamLabelFor(manifest, player.franchiseId, player.eraId)}</span
                          >
                        </span>
                      {/if}
                      <span
                        class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 font-mono text-[10px] tabular-nums"
                        aria-label="Ratings"
                      >
                        <span class="font-bold text-primary" title="Overall"
                          >O {player.overall}</span
                        >
                        <span class="text-muted-foreground" title="Offense"
                          >OF {player.offense}</span
                        >
                        <span class="text-muted-foreground" title="Defense"
                          >DF {player.defense}</span
                        >
                      </span>
                    </span>
                  </div>
                </td>
                {#each dataColumns as col (col.key)}
                  <td
                    class="px-2 py-3 text-sm whitespace-nowrap {col.numeric
                      ? 'text-right font-mono tabular-nums'
                      : 'text-muted-foreground'} {col.key === 'overall'
                      ? 'font-bold text-foreground'
                      : ''} {hideClass(col.hideBelow)}"
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
{:else}
  <ul class="flex flex-col gap-2" aria-label={heading}>
    {#each items as item (groupKey(item))}
      {#if item.type === 'group'}
        <li
          class="px-1 pt-3 pb-1 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase"
        >
          {groupLabel(item.franchiseId, item.eraId)} · {eraLabel.get(item.eraId) ?? item.eraId} · {item.count}
          players
        </li>
      {:else}
        {@const player = item.player}
        {@const mobileTeamExternalId = teamSlotFor(player)}
        <li data-virtual-row>
          <div
            role="button"
            tabindex="0"
            aria-label={`View ${player.displayName} stats`}
            onclick={(event) => {
              if (!rowActionTarget(event.target)) openPlayerRow(player);
            }}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPlayerRow(player);
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
                {#if playerMetaLine(player)}
                  <span
                    class="mt-0.5 flex items-center gap-1.5 text-xs leading-snug text-muted-foreground"
                  >
                    {#if showTeamInPlayerCell && mobileTeamExternalId}
                      <TeamLogo
                        {manifest}
                        franchiseId={player.franchiseId}
                        teamExternalId={mobileTeamExternalId}
                        logoCandidates={logoCandidatesFor(player)}
                        className="h-4 w-4"
                      />
                    {/if}
                    <span class="min-w-0 truncate">{playerMetaLine(player)}</span>
                  </span>
                {/if}
                <span
                  class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0 font-mono text-[10px] tabular-nums"
                  aria-label="Ratings"
                >
                  <span class="font-bold text-primary" title="Overall">O {player.overall}</span>
                  <span class="text-muted-foreground" title="Offense">OF {player.offense}</span>
                  <span class="text-muted-foreground" title="Defense">DF {player.defense}</span>
                </span>
              </span>
            </div>
            <div
              class="mt-3 grid grid-cols-3 gap-1 rounded-md bg-surface-1 p-2 text-center text-xs"
            >
              <span class="rounded px-1 py-0.5">
                <span class="block text-[10px] text-muted-foreground uppercase">Games</span>
                <span class="text-stat block font-bold">{cellValue(player, 'games')}</span>
              </span>
              <span class="rounded px-1 py-0.5">
                <span class="block text-[10px] text-muted-foreground uppercase">USG%</span>
                <span class="text-stat block font-bold">{cellValue(player, 'usage')}</span>
              </span>
              <span class="rounded px-1 py-0.5">
                <span class="block text-[10px] text-muted-foreground uppercase">PER</span>
                <span class="text-stat block font-bold">{cellValue(player, 'per')}</span>
              </span>
              <span class="rounded px-1 py-0.5">
                <span class="block text-[10px] text-muted-foreground uppercase">PTS</span>
                <span class="text-stat block font-bold"
                  >{player.detail
                    ? formatPerGame(perGame(player.detail.stats, 'points'))
                    : '…'}</span
                >
              </span>
              <span class="rounded px-1 py-0.5">
                <span class="block text-[10px] text-muted-foreground uppercase">REB</span>
                <span class="text-stat block font-bold"
                  >{player.detail
                    ? formatPerGame(perGame(player.detail.stats, 'rebounds'))
                    : '…'}</span
                >
              </span>
              <span class="rounded px-1 py-0.5">
                <span class="block text-[10px] text-muted-foreground uppercase">AST</span>
                <span class="text-stat block font-bold"
                  >{player.detail
                    ? formatPerGame(perGame(player.detail.stats, 'assists'))
                    : '…'}</span
                >
              </span>
            </div>
          </div>
        </li>
      {/if}
    {/each}
  </ul>
{/if}

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
