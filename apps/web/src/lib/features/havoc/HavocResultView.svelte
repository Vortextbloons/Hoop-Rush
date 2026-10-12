<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { resolve } from '$app/paths';
  import { ArrowRight } from '@lucide/svelte';
  import type { HavocResultState } from './havoc-result-state.svelte';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import HavocSquadReport from './HavocSquadReport.svelte';
  import HavocComparisonChart from './HavocComparisonChart.svelte';
  import HavocGameDetail from './HavocGameDetail.svelte';
  import { havocRecordLabel, havocDeltaTitle, formatSignedPoints } from './havoc-presentation';
  let { state: resultState }: { state: HavocResultState } = $props();
  const run = $derived(resultState.run);
  const comparison = $derived(resultState.comparison);
  let gameDetailsOpen = $state(false);
  let selectedGame = $state<number | null>(null);
  const completed = $derived(
    resultState.progress?.variant === 'normal'
      ? resultState.progress.gamesCompleted
      : resultState.normalGamesCompleted,
  );
</script>

<section class="h-shell" data-havoc-result>
  {#if resultState.loading}<p class="h-copy" aria-live="polite">Opening your season report…</p>
  {:else if run === null || run.phase === 'draft'}<div class="h-panel">
      <h1 class="h-title">Your story starts here.</h1>
      <a class="h-button mt-6" href={resolve('/havoc')}>Draft your squad</a>
    </div>
  {:else if !resultState.havocSeasonComplete}<div class="h-panel">
      <h1 class="h-title">Season in progress.</h1>
      <p class="h-copy mt-4">Your report arrives after all 82 games.</p>
      <a class="h-button mt-6" href={resolve('/havoc/run')}>Continue season</a>
    </div>
  {:else if !resultState.comparisonComplete && run.comparisonStatus !== 'unsupported'}
    <div class="h-panel" data-havoc-comparison-pending>
      <p class="h-eyebrow">One last thing</p>
      <h1 class="h-title mt-3">The powers. The proof.</h1>
      <p class="h-copy mt-4">
        We're playing the same season without powers. Both results will be revealed together.
      </p>
      <div
        class="h-meter"
        role="progressbar"
        aria-label="Report preparation"
        aria-valuemin={0}
        aria-valuemax={82}
        aria-valuenow={completed}
      >
        <div style:width={`${(completed / 82) * 100}%`}></div>
      </div>
      <p class="h-copy" data-havoc-comparison-progress>{completed} / 82</p>
      {#if !resultState.busy}<button
          class="h-button mt-4"
          data-havoc-run-normal
          onclick={() => void resultState.runNormalSeason()}>Finish season report</button
        >{/if}
      {#if resultState.busy}<button
          class="h-button secondary mt-4"
          disabled={resultState.cancelling}
          onclick={() => void resultState.cancelComparison()}
          >{resultState.cancelling ? 'Pausing...' : 'Pause report preparation'}</button
        >{/if}
    </div>
  {:else}
    <header class="h-panel h-result-hero">
      <p class="h-eyebrow">Hoop Havoc · Season report</p>
      <h1 class="h-subtitle mt-2">
        {comparison !== null && resultState.comparisonComplete
          ? havocDeltaTitle(comparison.winsGained)
          : 'Season complete'}
      </h1>
      <div class="h-record-comparison mt-4">
        <div>
          <p class="h-eyebrow">With powers</p>
          <p class="h-result-record" data-havoc-final-record>
            {havocRecordLabel(run.havocWins, run.havocLosses)}
          </p>
        </div>
        {#if comparison !== null && resultState.comparisonComplete}
          <div>
            <p class="h-eyebrow">Without powers</p>
            <p class="h-result-record">
              {havocRecordLabel(comparison.normal.wins, comparison.normal.losses)}
            </p>
          </div>
          <div>
            <p class="h-eyebrow">Wins delta</p>
            <p class="h-result-record" class:h-negative={comparison.winsGained < 0}>
              {formatSignedPoints(comparison.winsGained)}
            </p>
          </div>
        {/if}
      </div>
      <p class="h-copy mt-3" data-havoc-result-objective>
        {run.perfectSeason
          ? '82 wins. Zero losses. Perfect season challenge cleared.'
          : '82 games complete. See how your five finished.'}
      </p>
      {#if comparison !== null && resultState.comparisonComplete}
        <p class="h-copy text-xs mt-2">
          Same squad, opponents and seeds. Deltas compare the two seasons; individual abilities
          can't be isolated from them.
        </p>
        <dl class="h-result-metrics mt-4">
          <div>
            <dt>Scored / game</dt>
            <dd>
              {comparison.havoc.averagePointsFor.toFixed(1)} / {comparison.normal.averagePointsFor.toFixed(
                1,
              )}
            </dd>
          </div>
          <div>
            <dt>Allowed / game</dt>
            <dd>
              {comparison.havoc.averagePointsAgainst.toFixed(1)} / {comparison.normal.averagePointsAgainst.toFixed(
                1,
              )}
            </dd>
          </div>
          <div>
            <dt>Margin delta / game</dt>
            <dd>
              {formatSignedPoints(
                Number((comparison.differentialDelta / comparison.havoc.games).toFixed(1)),
              )}
            </dd>
          </div>
          <div>
            <dt>Direct power points</dt>
            <dd data-havoc-direct-mutation-points>
              {resultState.report?.directMutationPoints ??
                comparison.mutations.reduce((sum, power) => sum + power.pointsDelta, 0)}
            </dd>
          </div>
        </dl>
      {/if}
    </header>
    {#if run.comparisonStatus === 'unsupported'}
      <p class="h-alert mt-4" data-havoc-comparison-unsupported>
        This saved season uses older rules. Its results are preserved, but a matching comparison is
        unavailable.
      </p>
      {#if resultState.report !== null}<dl class="h-result-metrics mt-4">
          <div>
            <dt>Average score margin</dt>
            <dd>
              {(resultState.report.havoc.differential / resultState.report.havoc.games).toFixed(1)}
            </dd>
          </div>
          <div>
            <dt>Direct power points</dt>
            <dd>{resultState.report.directMutationPoints}</dd>
          </div>
        </dl>{/if}
    {/if}
    {#if comparison !== null && resultState.comparisonComplete}
      <HavocSquadReport {comparison} lineup={run.lineup} />
      <details class="h-panel mt-4">
        <summary>Your season, game by game · 82 matched results</summary>
        <HavocComparisonChart
          {comparison}
          {selectedGame}
          onSelect={(gameNumber) => {
            selectedGame = gameNumber;
            gameDetailsOpen = true;
          }}
        />
      </details>
    {:else}<div class="mt-6"><HavocLineupLock slots={run.lineup} /></div>{/if}
    <div class="h-actions mt-6">
      <a class="h-button" href={resolve('/havoc')}>Draft another squad <ArrowRight size={18} /></a
      ><a class="h-link" href={resolve('/havoc/history')}>Hall of Freaks</a>
    </div>
    {#if comparison !== null && resultState.comparisonComplete}<details class="h-panel mt-8">
        <summary>Explore the box scores, powers & game-by-game comparison</summary
        ><HavocComparisonView {comparison} showChart={false} />
      </details>{/if}
    <a
      class="h-link mt-6 inline-block"
      href={resolve('/havoc/history/[runId]', { runId: run.runId })}>Open full saved report</a
    >
  {/if}
  {#if resultState.error !== null}<p role="alert" class="h-alert">{resultState.error}</p>{/if}
  {#if resultState.notice !== null}<p role="status" class="h-alert">{resultState.notice}</p>{/if}
</section>
<Dialog.Root bind:open={gameDetailsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="h-result-overlay" />
    <Dialog.Content class="havoc-world h-result-dialog">
      <header class="h-header">
        <Dialog.Title class="h-subtitle">Game {selectedGame} comparison</Dialog.Title><Dialog.Close
          class="h-button secondary">Close</Dialog.Close
        >
      </header>
      <Dialog.Description class="h-copy text-xs"
        >The same matchup, with and without powers.</Dialog.Description
      >
      {#if comparison !== null && selectedGame !== null}<HavocGameDetail
          {comparison}
          gameNumber={selectedGame}
        />{/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .h-result-hero {
    border-top: 3px solid var(--h-gold);
  }
  .h-record-comparison {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    align-items: end;
  }
  .h-result-record {
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3.5rem);
    font-weight: 900;
    color: var(--h-gold);
  }
  .h-result-record.h-negative {
    color: var(--h-pink);
  }
  .h-result-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    border-top: 1px solid #465273;
    padding-top: 16px;
  }
  .h-result-metrics dt {
    font-size: 11px;
    color: #c1cae4;
  }
  .h-result-metrics dd {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 600px) {
    .h-result-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .h-record-comparison {
      gap: 8px;
    }
  }
</style>
