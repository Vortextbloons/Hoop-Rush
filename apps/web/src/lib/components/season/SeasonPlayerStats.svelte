<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerStatsTable from '$lib/components/season/SeasonPlayerStatsTable.svelte';
  import type {
    SeasonPlayerStatsMeasure,
    SeasonPlayerStatsSortKey,
    SeasonPlayerStatsView,
  } from '$lib/season/season-player-stats-view';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';

  /**
   * Season Run player stats section (Team tab): the human team's ten players
   * with totals or per-game rates plus shooting percentages, folded from
   * accepted game summaries. Sort state lives here (default PPG desc);
   * desktop renders the full table directly, mobile a compact primary view
   * with an expandable full table — mirroring the BoxScore responsive
   * pattern.
   */

  let {
    view,
    manifest,
    shell,
  }: {
    view: SeasonPlayerStatsView;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
  } = $props();

  let measure = $state<SeasonPlayerStatsMeasure>('perGame');
  let sortKey = $state<SeasonPlayerStatsSortKey>('pointsPerGame');
  let sortDir = $state<'asc' | 'desc'>('desc');

  function toggleSort(key: SeasonPlayerStatsSortKey): void {
    if (key === sortKey) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      sortKey = key;
      sortDir = key === 'displayName' ? 'asc' : 'desc';
    }
  }

  const sortedRows = $derived.by(() => {
    const rows = [...view.rows];
    const dir = sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const av = sortValueOf(a, sortKey);
      const bv = sortValueOf(b, sortKey);
      if (av === bv) return a.displayName.localeCompare(b.displayName);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
    return rows;
  });

  function sortValueOf(
    row: SeasonPlayerStatsView['rows'][number],
    key: SeasonPlayerStatsSortKey,
  ): number | string {
    if (key === 'displayName') return row.displayName;
    const value = row[key];
    return value === null ? -1 : value;
  }

  const faceOf = (playerVersionId: string) => shell.facesByVersion.get(playerVersionId) ?? null;

  const tableProps = $derived({
    rows: sortedRows,
    measure,
    sortKey,
    sortDir,
    onSort: toggleSort,
    faceOf,
    manifest,
  });
</script>

<section aria-labelledby="season-stats-heading" class="mt-6" data-season-player-stats>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h2
        id="season-stats-heading"
        class="font-display text-xl font-extrabold uppercase tracking-tight"
      >
        Season stats
      </h2>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Your ten players · folded from accepted game summaries
      </p>
    </div>
    {#if view.hasStats}
      <div role="group" aria-label="Stat measurement" class="flex rounded-lg bg-surface-2 p-1">
        <button
          type="button"
          aria-pressed={measure === 'perGame'}
          onclick={() => {
            measure = 'perGame';
          }}
          class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {measure ===
          'perGame'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          Per game
        </button>
        <button
          type="button"
          aria-pressed={measure === 'totals'}
          onclick={() => {
            measure = 'totals';
          }}
          class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {measure ===
          'totals'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
        >
          Totals
        </button>
      </div>
    {/if}
  </div>

  {#if !view.hasStats}
    <p class="mt-3 font-mono text-[10px] text-muted-foreground">
      Accept a block to fold per-player season stats.
    </p>
  {:else}
    <!-- Mobile: compact primary stats, then an expandable full-stat table -->
    <div class="mt-3 md:hidden">
      <div class="overflow-hidden rounded-xl bg-surface-1">
        <table class="w-full text-sm">
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
            >
              <th scope="col" class="px-3 py-2 text-left font-medium">Player</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">GP</th>
              {#if measure === 'perGame'}
                <th scope="col" class="px-3 py-2 text-right font-medium">PPG</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">RPG</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">APG</th>
              {:else}
                <th scope="col" class="px-3 py-2 text-right font-medium">PTS</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">REB</th>
                <th scope="col" class="px-3 py-2 text-right font-medium">AST</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each sortedRows as row (row.playerVersionId)}
              <tr class="border-b border-border/40">
                <th scope="row" class="max-w-36 truncate px-3 py-1.5 text-left font-semibold">
                  {row.displayName}
                </th>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">{row.gamesPlayed}</td>
                <td class="px-3 py-1.5 text-right font-bold">
                  {measure === 'perGame' ? row.pointsPerGame.toFixed(1) : row.points}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {measure === 'perGame' ? row.reboundsPerGame.toFixed(1) : row.rebounds}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {measure === 'perGame' ? row.assistsPerGame.toFixed(1) : row.assists}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <details class="group border-t border-border/60">
          <summary
            class="cursor-pointer px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          >
            Full stats
          </summary>
          <div class="overflow-x-auto border-t border-border/40">
            <SeasonPlayerStatsTable {...tableProps} />
          </div>
        </details>
      </div>
    </div>

    <!-- Desktop: full sortable table directly -->
    <div class="mt-3 hidden md:block">
      <div class="overflow-hidden rounded-xl bg-surface-1">
        <SeasonPlayerStatsTable {...tableProps} />
      </div>
    </div>
  {/if}
</section>
