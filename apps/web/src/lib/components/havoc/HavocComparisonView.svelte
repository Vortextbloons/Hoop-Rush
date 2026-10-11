<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';
  import HavocComparisonChart from './HavocComparisonChart.svelte';
  import HavocComparisonTable from './HavocComparisonTable.svelte';
  import HavocGameDetail from './HavocGameDetail.svelte';
  import { havocRecordLabel, mutationNameOf } from './havoc-presentation';

  let { comparison, showChart = true }: { comparison: HavocComparison; showChart?: boolean } =
    $props();
  let selectedGame = $state<number | null>(null);
  const activeGame = $derived(selectedGame ?? comparison.games[0]?.gameNumber ?? 1);

  function formatAverage(value: number): string {
    return value.toFixed(1);
  }
</script>

<div class="flex min-w-0 flex-col gap-4" data-havoc-comparison>
  <section aria-labelledby="havoc-comparison-totals" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <h2
      id="havoc-comparison-totals"
      class="font-display text-lg font-extrabold tracking-tight uppercase"
    >
      Normal / Havoc season comparison
    </h2>
    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
      Two matched seeded seasons: the same 82 opponents, schedule, profiles, and game seeds. Game
      paths can still diverge, so a delta is not exact causal attribution to one mutation. "Direct
      mutation points" only count ledger adjustments.
    </p>
    <div class="havoc-scroll-x mt-3 overflow-x-auto">
      <table class="w-full min-w-[30rem] text-xs">
        <thead>
          <tr
            class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
          >
            <th scope="col" class="px-2 py-1.5 text-left font-medium">Season</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Record</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Points for</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Points against</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Differential</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Avg for</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Avg against</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Largest</th>
            <th scope="col" class="px-2 py-1.5 text-right font-medium">Adjustments</th>
          </tr>
        </thead>
        <tbody>
          <tr class="border-b border-border/40">
            <th scope="row" class="px-2 py-1.5 text-left font-semibold text-[#37B7CC]">Havoc</th>
            <td class="px-2 py-1.5 text-right font-mono">
              {havocRecordLabel(comparison.havoc.wins, comparison.havoc.losses)}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.havoc.pointsFor}</td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.havoc.pointsAgainst}</td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.havoc.differential}</td>
            <td class="px-2 py-1.5 text-right font-mono">
              {formatAverage(comparison.havoc.averagePointsFor)}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">
              {formatAverage(comparison.havoc.averagePointsAgainst)}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">
              {comparison.havoc.largestPointsFor}/{comparison.havoc.largestPointsAgainst}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.havoc.adjustments}</td>
          </tr>
          <tr class="border-b border-border/40">
            <th scope="row" class="px-2 py-1.5 text-left font-semibold text-muted-foreground">
              Normal
            </th>
            <td class="px-2 py-1.5 text-right font-mono">
              {havocRecordLabel(comparison.normal.wins, comparison.normal.losses)}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.normal.pointsFor}</td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.normal.pointsAgainst}</td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.normal.differential}</td>
            <td class="px-2 py-1.5 text-right font-mono">
              {formatAverage(comparison.normal.averagePointsFor)}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">
              {formatAverage(comparison.normal.averagePointsAgainst)}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">
              {comparison.normal.largestPointsFor}/{comparison.normal.largestPointsAgainst}
            </td>
            <td class="px-2 py-1.5 text-right font-mono">{comparison.normal.adjustments}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="mt-3 text-sm font-semibold" data-havoc-comparison-deltas>
      Wins gained: {comparison.winsGained >= 0 ? '+' : ''}{comparison.winsGained} · Differential delta:
      {comparison.differentialDelta >= 0 ? '+' : ''}{comparison.differentialDelta}
    </p>
  </section>

  <section aria-labelledby="havoc-comparison-mutations" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <h2
      id="havoc-comparison-mutations"
      class="font-display text-lg font-extrabold tracking-tight uppercase"
    >
      Mutation statistics
    </h2>
    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
      Direct ledger effects across the 82-game run: score adjustments, free throws granted, canceled
      turnovers, and earned or used extra possessions.
    </p>
    {#if comparison.mutations.length === 0}
      <p class="mt-2 text-xs text-muted-foreground">No mutation triggers recorded.</p>
    {:else}
      <div class="havoc-scroll-x mt-3 overflow-x-auto">
        <table class="w-full min-w-[34rem] text-xs" data-havoc-comparison-mutations>
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
            >
              <th scope="col" class="px-2 py-1.5 text-left font-medium">Mutation</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Owners</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Triggers</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Points Δ</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">FTs granted</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">TOs canceled</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Extra poss. earned</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Extra poss. used</th>
            </tr>
          </thead>
          <tbody>
            {#each comparison.mutations as mutation (mutation.mutationId)}
              <tr class="border-b border-border/40" data-havoc-mutation-stat={mutation.mutationId}>
                <th scope="row" class="px-2 py-1.5 text-left font-semibold">
                  {mutationNameOf(mutation.mutationId)}
                </th>
                <td class="px-2 py-1.5 text-right font-mono">{mutation.ownerCount}</td>
                <td class="px-2 py-1.5 text-right font-mono">{mutation.triggers}</td>
                <td class="px-2 py-1.5 text-right font-mono font-bold">{mutation.pointsDelta}</td>
                <td class="px-2 py-1.5 text-right font-mono">{mutation.freeThrowsGranted}</td>
                <td class="px-2 py-1.5 text-right font-mono">{mutation.turnoversCancelled}</td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {mutation.extraPossessionsEarned}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">{mutation.extraPossessionsUsed}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section aria-labelledby="havoc-comparison-games" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <h2
      id="havoc-comparison-games"
      class="font-display text-lg font-extrabold tracking-tight uppercase"
    >
      Every matched game
    </h2>
    <div class="mt-3">
      {#if showChart}
        <HavocComparisonChart
          {comparison}
          selectedGame={activeGame}
          onSelect={(gameNumber) => (selectedGame = gameNumber)}
        />{/if}
    </div>
    <div class="mt-4">
      <HavocComparisonTable
        {comparison}
        selectedGame={activeGame}
        onSelect={(gameNumber) => (selectedGame = gameNumber)}
      />
    </div>
    <div class="mt-4">
      <HavocGameDetail {comparison} gameNumber={activeGame} />
    </div>
  </section>
</div>
