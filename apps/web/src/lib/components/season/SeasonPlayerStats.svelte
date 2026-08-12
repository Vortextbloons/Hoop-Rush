<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerStatsMobileList from '$lib/components/season/SeasonPlayerStatsMobileList.svelte';
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
   * accepted game summaries. Sort state lives here (default PPG desc).
   */

  let {
    view,
    manifest,
    shell,
    embedded = false,
  }: {
    view: SeasonPlayerStatsView;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    /** When true, the parent panel owns the section heading. */
    embedded?: boolean;
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

<section
  aria-labelledby={embedded ? undefined : 'season-stats-heading'}
  class={embedded ? 'min-w-0' : 'mt-6'}
  data-season-player-stats
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    {#if !embedded}
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
    {:else}
      <p class="font-mono text-[10px] text-muted-foreground">
        <span class="md:hidden"
          >Folded from accepted game summaries · choose a sort metric below</span
        >
        <span class="hidden md:inline"
          >Folded from accepted game summaries · tap column headers to sort</span
        >
      </p>
    {/if}
    {#if view.hasStats}
      <div
        role="group"
        aria-label="Stat measurement"
        class="flex w-full rounded-lg bg-surface-2 p-1 sm:w-auto"
      >
        <button
          type="button"
          aria-pressed={measure === 'perGame'}
          onclick={() => {
            measure = 'perGame';
          }}
          class="min-h-11 flex-1 rounded-md px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:flex-none sm:px-3 sm:py-1.5 {measure ===
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
          class="min-h-11 flex-1 rounded-md px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:flex-none sm:px-3 sm:py-1.5 {measure ===
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
    <div
      class="mt-3 rounded-xl border border-dashed border-border/70 bg-surface-1 px-4 py-8 text-center"
    >
      <p class="font-mono text-xs font-semibold text-foreground">No season stats yet</p>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Accept a block to fold per-player season stats.
      </p>
    </div>
  {:else}
    <SeasonPlayerStatsMobileList {...tableProps} />
    <div class="mt-3 hidden overflow-x-auto overscroll-x-contain md:block">
      <div class="min-w-0 overflow-hidden rounded-xl border border-border/40 bg-surface-1">
        <SeasonPlayerStatsTable {...tableProps} />
      </div>
    </div>
  {/if}
</section>
