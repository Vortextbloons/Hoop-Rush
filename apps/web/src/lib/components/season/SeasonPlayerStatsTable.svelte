<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import { eraIdentityOf, type SeasonFaceRef } from '$lib/season/season-branding';
  import type {
    SeasonPlayerStatsMeasure,
    SeasonPlayerStatsRow,
    SeasonPlayerStatsSortKey,
  } from '$lib/season/season-player-stats-view';
  import { formatPositions } from '$lib/player-positions';

  /**
   * Full Season Run player stats table: sortable column headers (buttons +
   * aria-sort) over totals or per-game rates plus shooting percentages.
   * Rendered twice by SeasonPlayerStats — inside the mobile disclosure and
   * directly on desktop — with sorting state owned by the parent.
   */

  let {
    rows,
    measure,
    sortKey,
    sortDir,
    onSort,
    faceOf,
    manifest,
  }: {
    rows: SeasonPlayerStatsRow[];
    measure: SeasonPlayerStatsMeasure;
    sortKey: SeasonPlayerStatsSortKey;
    sortDir: 'asc' | 'desc';
    onSort: (key: SeasonPlayerStatsSortKey) => void;
    faceOf: (playerVersionId: string) => SeasonFaceRef | null;
    manifest: HoopRushManifest;
  } = $props();

  const statColumns: ReadonlyArray<{
    key: SeasonPlayerStatsSortKey;
    label: string;
    measure: SeasonPlayerStatsMeasure | 'both';
  }> = [
    { key: 'minutesPerGame', label: 'MPG', measure: 'perGame' },
    { key: 'pointsPerGame', label: 'PPG', measure: 'perGame' },
    { key: 'reboundsPerGame', label: 'RPG', measure: 'perGame' },
    { key: 'assistsPerGame', label: 'APG', measure: 'perGame' },
    { key: 'stealsPerGame', label: 'SPG', measure: 'perGame' },
    { key: 'blocksPerGame', label: 'BPG', measure: 'perGame' },
    { key: 'turnoversPerGame', label: 'TOPG', measure: 'perGame' },
    { key: 'minutes', label: 'MIN', measure: 'totals' },
    { key: 'points', label: 'PTS', measure: 'totals' },
    { key: 'rebounds', label: 'REB', measure: 'totals' },
    { key: 'assists', label: 'AST', measure: 'totals' },
    { key: 'steals', label: 'STL', measure: 'totals' },
    { key: 'blocks', label: 'BLK', measure: 'totals' },
    { key: 'turnovers', label: 'TO', measure: 'totals' },
    { key: 'fouls', label: 'PF', measure: 'totals' },
    { key: 'fieldGoalPct', label: 'FG%', measure: 'both' },
    { key: 'threePointPct', label: '3P%', measure: 'both' },
    { key: 'freeThrowPct', label: 'FT%', measure: 'both' },
  ];

  const columns = $derived(
    statColumns.filter((column) => column.measure === 'both' || column.measure === measure),
  );

  function ariaSort(key: SeasonPlayerStatsSortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none';
    return sortDir === 'desc' ? 'descending' : 'ascending';
  }

  function formatValue(row: SeasonPlayerStatsRow, key: SeasonPlayerStatsSortKey): string {
    if (key === 'gamesPlayed') return String(row.gamesPlayed);
    if (key === 'minutes') return String(Math.round(row.minutes));
    if (key === 'fieldGoalPct' || key === 'threePointPct' || key === 'freeThrowPct') {
      const value = row[key];
      if (value === null) return '—';
      if (value === 0) return '0%';
      return `${(value * 100).toFixed(1)}%`;
    }
    const value = row[key];
    return typeof value === 'number' ? value.toFixed(1) : '—';
  }

  function eraLabelOf(playerVersionId: string, franchiseId: string, eraId: string) {
    return eraIdentityOf(manifest, franchiseId, eraId).displayLabel;
  }
</script>

<table class="w-full min-w-[44rem] text-sm">
  <thead>
    <tr
      class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
    >
      <th scope="col" aria-sort={ariaSort('displayName')} class="px-3 py-2 text-left">
        <button
          type="button"
          onclick={() => onSort('displayName')}
          aria-label="Sort by player name"
          class="font-medium uppercase tracking-[0.12em] outline-none focus-visible:ring-2 focus-visible:ring-ring {sortKey ===
          'displayName'
            ? 'text-foreground'
            : 'hover:text-foreground'}"
        >
          Player
        </button>
      </th>
      <th scope="col" aria-sort={ariaSort('gamesPlayed')} class="px-3 py-2 text-right">
        <button
          type="button"
          onclick={() => onSort('gamesPlayed')}
          aria-label="Sort by games played"
          class="font-medium uppercase tracking-[0.12em] outline-none focus-visible:ring-2 focus-visible:ring-ring {sortKey ===
          'gamesPlayed'
            ? 'text-foreground'
            : 'hover:text-foreground'}"
        >
          GP
        </button>
      </th>
      {#each columns as column (column.key)}
        {@const active = sortKey === column.key}
        <th scope="col" aria-sort={ariaSort(column.key)} class="px-3 py-2 text-right">
          <button
            type="button"
            onclick={() => onSort(column.key)}
            aria-label={`Sort by ${column.label}`}
            class="font-medium uppercase tracking-[0.12em] outline-none focus-visible:ring-2 focus-visible:ring-ring {active
              ? 'text-foreground'
              : 'hover:text-foreground'}"
          >
            {column.label}
          </button>
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.playerVersionId)}
      {@const face = faceOf(row.playerVersionId)}
      {@const eraLabel = eraLabelOf(row.playerVersionId, row.franchiseId, row.eraId)}
      <tr class="border-b border-border/40">
        <th scope="row" class="px-3 py-1.5 text-left">
          <div class="flex min-w-0 items-center gap-2">
            {#if face !== null}
              <SeasonPlayerFace {face} {manifest} size="sm" />
            {:else}
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
                aria-hidden="true"
              >
                ?
              </span>
            {/if}
            <div class="min-w-0">
              <p class="flex min-w-0 items-center gap-2">
                <span class="max-w-44 truncate font-semibold">{row.displayName}</span>
                {#if row.overallRating !== null}
                  <span
                    class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] font-bold text-foreground"
                  >
                    OVR {row.overallRating}
                  </span>
                {/if}
              </p>
              <p class="truncate font-mono text-[9px] text-muted-foreground">
                {row.seasonKey}
                {#if row.positions.length > 0}
                  · {formatPositions(row.positions)}
                {/if}
                {#if eraLabel}
                  · {eraLabel}
                {/if}
              </p>
            </div>
          </div>
        </th>
        <td class="px-3 py-1.5 text-right font-mono text-[10px]">{row.gamesPlayed}</td>
        {#each columns as column (column.key)}
          <td class="px-3 py-1.5 text-right font-mono text-[10px]">
            {formatValue(row, column.key)}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
