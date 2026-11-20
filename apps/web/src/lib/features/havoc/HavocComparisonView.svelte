<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';
  import HavocComparisonChart from './HavocComparisonChart.svelte';
  import HavocComparisonTable from './HavocComparisonTable.svelte';
  import HavocGameDetail from './HavocGameDetail.svelte';
  import { havocRecordLabel, mutationNameOf } from './havoc-presentation';
  import type { ComparisonRow } from '#lib/components/ui/types.js';
  import ComparisonTable from '#lib/components/screens/ComparisonTable.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';

  let { comparison, showChart = true }: { comparison: HavocComparison; showChart?: boolean } =
    $props();
  let selectedGame = $state<number | null>(null);
  const activeGame = $derived(selectedGame ?? comparison.games[0]?.gameNumber ?? 1);
  const seasonRows = $derived<readonly ComparisonRow[]>([
    {
      label: 'Record',
      left: havocRecordLabel(comparison.havoc.wins, comparison.havoc.losses),
      right: havocRecordLabel(comparison.normal.wins, comparison.normal.losses),
    },
    { label: 'Points for', left: comparison.havoc.pointsFor, right: comparison.normal.pointsFor },
    {
      label: 'Points against',
      left: comparison.havoc.pointsAgainst,
      right: comparison.normal.pointsAgainst,
    },
    {
      label: 'Differential',
      left: comparison.havoc.differential,
      right: comparison.normal.differential,
    },
    {
      label: 'Avg for',
      left: formatAverage(comparison.havoc.averagePointsFor),
      right: formatAverage(comparison.normal.averagePointsFor),
    },
    {
      label: 'Avg against',
      left: formatAverage(comparison.havoc.averagePointsAgainst),
      right: formatAverage(comparison.normal.averagePointsAgainst),
    },
    {
      label: 'Largest',
      left: `${comparison.havoc.largestPointsFor}/${comparison.havoc.largestPointsAgainst}`,
      right: `${comparison.normal.largestPointsFor}/${comparison.normal.largestPointsAgainst}`,
    },
    {
      label: 'Adjustments',
      left: comparison.havoc.adjustments,
      right: comparison.normal.adjustments,
    },
  ]);

  function formatAverage(value: number): string {
    return value.toFixed(1);
  }
</script>

<div class="flex min-w-0 flex-col gap-4" data-havoc-comparison>
  <Panel as="section" padding="md" aria-labelledby="havoc-comparison-totals">
    <SectionHeading
      title="Normal / Havoc season comparison"
      headingId="havoc-comparison-totals"
      level={2}
      size="md"
    />
    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
      Two matched seeded seasons: the same 82 opponents, schedule, profiles, and game seeds. Game
      paths can still diverge, so a delta is not exact causal attribution to one mutation. "Direct
      mutation points" only count ledger adjustments.
    </p>
    <div class="havoc-scroll-x mt-3 overflow-x-auto">
      <ComparisonTable rows={seasonRows} leftLabel="Havoc" rightLabel="Normal" />
    </div>
    <p class="mt-3 text-sm font-semibold" data-havoc-comparison-deltas>
      Wins gained: {comparison.winsGained >= 0 ? '+' : ''}{comparison.winsGained} · Differential delta:
      {comparison.differentialDelta >= 0 ? '+' : ''}{comparison.differentialDelta}
    </p>
  </Panel>

  <Panel as="section" padding="md" aria-labelledby="havoc-comparison-mutations">
    <SectionHeading
      title="Mutation statistics"
      headingId="havoc-comparison-mutations"
      level={2}
      size="md"
    />
    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
      Direct ledger effects across the 82-game run: score adjustments, free throws granted, canceled
      turnovers, and earned or used extra possessions.
    </p>
    {#if comparison.mutations.length === 0}
      <EmptyState class="mt-2" title="No mutation triggers recorded" surface="none" />
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
  </Panel>

  <Panel as="section" padding="md" aria-labelledby="havoc-comparison-games">
    <SectionHeading
      title="Every matched game"
      headingId="havoc-comparison-games"
      level={2}
      size="md"
    />
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
  </Panel>
</div>
