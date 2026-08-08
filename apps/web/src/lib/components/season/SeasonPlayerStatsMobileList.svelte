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
  import { oneDecimal, percentOneDecimal } from '$lib/format';

  /**
   * Mobile season stats list: one card per player with a compact stat grid
   * that fits the viewport without horizontal scrolling.
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

  const sortOptions: ReadonlyArray<{ key: SeasonPlayerStatsSortKey; label: string }> = [
    { key: 'pointsPerGame', label: 'Points per game' },
    { key: 'reboundsPerGame', label: 'Rebounds per game' },
    { key: 'assistsPerGame', label: 'Assists per game' },
    { key: 'minutesPerGame', label: 'Minutes per game' },
    { key: 'stealsPerGame', label: 'Steals per game' },
    { key: 'blocksPerGame', label: 'Blocks per game' },
    { key: 'turnoversPerGame', label: 'Turnovers per game' },
    { key: 'points', label: 'Total points' },
    { key: 'rebounds', label: 'Total rebounds' },
    { key: 'assists', label: 'Total assists' },
    { key: 'minutes', label: 'Total minutes' },
    { key: 'steals', label: 'Total steals' },
    { key: 'blocks', label: 'Total blocks' },
    { key: 'turnovers', label: 'Total turnovers' },
    { key: 'fouls', label: 'Total fouls' },
    { key: 'fieldGoalPct', label: 'Field goal percentage' },
    { key: 'threePointPct', label: 'Three-point percentage' },
    { key: 'freeThrowPct', label: 'Free throw percentage' },
    { key: 'gamesPlayed', label: 'Games played' },
    { key: 'displayName', label: 'Player name' },
  ];

  const mobileSortOptions = $derived(
    sortOptions.filter((option) => {
      if (option.key === 'displayName' || option.key === 'gamesPlayed') return true;
      if (
        option.key === 'fieldGoalPct' ||
        option.key === 'threePointPct' ||
        option.key === 'freeThrowPct'
      ) {
        return true;
      }
      if (measure === 'perGame') {
        return option.key.endsWith('PerGame');
      }
      return !option.key.endsWith('PerGame');
    }),
  );

  const primaryStats = $derived(
    measure === 'perGame'
      ? ([
          { key: 'minutesPerGame' as const, label: 'MPG' },
          { key: 'pointsPerGame' as const, label: 'PPG' },
          { key: 'reboundsPerGame' as const, label: 'RPG' },
          { key: 'assistsPerGame' as const, label: 'APG' },
        ] as const)
      : ([
          { key: 'minutes' as const, label: 'MIN' },
          { key: 'points' as const, label: 'PTS' },
          { key: 'rebounds' as const, label: 'REB' },
          { key: 'assists' as const, label: 'AST' },
        ] as const),
  );

  const secondaryStats = [
    { key: 'stealsPerGame' as const, totalsKey: 'steals' as const, label: 'STL' },
    { key: 'blocksPerGame' as const, totalsKey: 'blocks' as const, label: 'BLK' },
    { key: 'turnoversPerGame' as const, totalsKey: 'turnovers' as const, label: 'TO' },
    { key: 'fouls' as const, totalsKey: 'fouls' as const, label: 'PF' },
  ] as const;

  const shootingStats = [
    { key: 'fieldGoalPct' as const, label: 'FG%' },
    { key: 'threePointPct' as const, label: '3P%' },
    { key: 'freeThrowPct' as const, label: 'FT%' },
  ] as const;

  function formatValue(row: SeasonPlayerStatsRow, key: SeasonPlayerStatsSortKey): string {
    if (key === 'gamesPlayed') return String(row.gamesPlayed);
    if (key === 'minutes') return String(Math.round(row.minutes));
    if (key === 'fieldGoalPct' || key === 'threePointPct' || key === 'freeThrowPct') {
      const value = row[key];
      if (value === null) return '—';
      if (value === 0) return '0%';
      return percentOneDecimal(value);
    }
    const value = row[key];
    return typeof value === 'number' ? oneDecimal(value) : '—';
  }

  function eraLabelOf(playerVersionId: string, franchiseId: string, eraId: string): string | null {
    return eraIdentityOf(manifest, franchiseId, eraId).displayLabel;
  }

  function secondaryValue(
    row: SeasonPlayerStatsRow,
    stat: (typeof secondaryStats)[number],
  ): string {
    const key = measure === 'perGame' ? stat.key : stat.totalsKey;
    return formatValue(row, key);
  }
</script>

<div class="mt-3 flex flex-col gap-3 md:hidden" data-season-player-stats-mobile>
  <div class="flex flex-col gap-2">
    <label class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      Sort by
      <select
        value={sortKey}
        onchange={(event) => onSort((event.currentTarget as HTMLSelectElement).value as SeasonPlayerStatsSortKey)}
        class="mt-1 min-h-11 w-full rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {#each mobileSortOptions as option (option.key)}
          <option value={option.key}>{option.label}</option>
        {/each}
      </select>
    </label>
    <button
      type="button"
      aria-label={`Sort direction: ${sortDir === 'desc' ? 'descending' : 'ascending'}`}
      onclick={() => onSort(sortKey)}
      class="min-h-11 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {sortDir === 'desc' ? 'Highest first' : 'Lowest first'}
    </button>
  </div>

  <ul class="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/40 bg-surface-1">
    {#each rows as row (row.playerVersionId)}
      {@const face = faceOf(row.playerVersionId)}
      {@const eraLabel = eraLabelOf(row.playerVersionId, row.franchiseId, row.eraId)}
      <li class="px-3 py-3">
        <div class="flex min-w-0 items-start gap-2">
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
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold">{row.displayName}</p>
                <p class="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {row.gamesPlayed} gp
                  {#if row.positions.length > 0}
                    · {formatPositions(row.positions)}
                  {/if}
                </p>
              </div>
              {#if row.overallRating !== null}
                <span
                  class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                >
                  OVR {row.overallRating}
                </span>
              {/if}
            </div>
            {#if eraLabel !== null}
              <p class="mt-0.5 line-clamp-1 font-mono text-[9px] text-muted-foreground/70">
                {eraLabel}
              </p>
            {/if}
          </div>
        </div>

        <dl class="mt-3 grid grid-cols-4 gap-2">
          {#each primaryStats as stat (stat.key)}
            <div class="rounded-lg bg-surface-2 px-2 py-1.5 text-center">
              <dt class="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                {stat.label}
              </dt>
              <dd class="mt-0.5 font-display text-base font-extrabold tabular-nums">
                {formatValue(row, stat.key)}
              </dd>
            </div>
          {/each}
        </dl>

        <dl class="mt-2 grid grid-cols-4 gap-2">
          {#each secondaryStats as stat (stat.key)}
            <div class="text-center">
              <dt class="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                {stat.label}
              </dt>
              <dd class="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                {secondaryValue(row, stat)}
              </dd>
            </div>
          {/each}
        </dl>

        <dl class="mt-2 grid grid-cols-3 gap-2 border-t border-border/40 pt-2">
          {#each shootingStats as stat (stat.key)}
            <div class="text-center">
              <dt class="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                {stat.label}
              </dt>
              <dd class="mt-0.5 font-mono text-xs font-semibold tabular-nums">
                {formatValue(row, stat.key)}
              </dd>
            </div>
          {/each}
        </dl>
      </li>
    {/each}
  </ul>
</div>
