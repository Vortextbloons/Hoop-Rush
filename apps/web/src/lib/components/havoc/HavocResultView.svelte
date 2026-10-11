<script lang="ts">
  import { resolve } from '$app/paths';
  import { Trophy, ArrowRight } from '@lucide/svelte';
  import type { HavocResultState } from '$lib/havoc/havoc-result-state.svelte';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocMvpCard from './HavocMvpCard.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import HavocSquadReport from './HavocSquadReport.svelte';
  import HavocAbilityReport from './HavocAbilityReport.svelte';
  import HavocComparisonChart from './HavocComparisonChart.svelte';
  import HavocGameDetail from './HavocGameDetail.svelte';
  import { havocRecordLabel } from './havoc-presentation';
  let { state: resultState }: { state: HavocResultState } = $props();
  const run = $derived(resultState.run);
  const comparison = $derived(resultState.comparison);
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
    </div>
  {:else}
    <header class="h-header">
      <div>
        <p class="h-eyebrow">Hoop Havoc · Final buzzer</p>
        <h1 class="h-title mt-3">
          {run.perfectSeason ? 'Perfect. Absolute havoc.' : 'That was your havoc.'}
        </h1>
      </div>
      <Trophy size={64} color="#ffd782" strokeWidth={1.5} />
    </header>
    <div class="h-panel">
      <p class="h-eyebrow">Your final record</p>
      <p class="h-score">{havocRecordLabel(run.havocWins, run.havocLosses)}</p>
      <p class="h-copy mt-3" data-havoc-result-objective>
        {run.perfectSeason
          ? '82 wins. Zero losses. Your squad cleared the perfect season challenge.'
          : 'The 82–0 challenge is over. See what your squad pulled off, then build your next five.'}
      </p>
    </div>
    {#if resultState.report !== null}<dl class="h-stats">
        <div>
          <dt>Average score margin</dt>
          <dd>{(resultState.report.havoc.differential / 82).toFixed(1)}</dd>
        </div>
        <div>
          <dt>Wins gained with powers</dt>
          <dd>
            {comparison ? `${comparison.winsGained >= 0 ? '+' : ''}${comparison.winsGained}` : '—'}
          </dd>
        </div>
        <div>
          <dt>Direct power points</dt>
          <dd data-havoc-direct-mutation-points>{resultState.report.directMutationPoints}</dd>
        </div>
      </dl>{/if}
    {#if comparison !== null && resultState.comparisonComplete}<HavocMvpCard {comparison} />
      <div class="h-panel mt-6">
        <h2 class="h-subtitle">Same squad. Without powers.</h2>
        <p class="h-copy mt-2">
          The unmutated five finished {havocRecordLabel(
            comparison.normal.wins,
            comparison.normal.losses,
          )} against the same opponents. This compares two seasons; it doesn't isolate the effect of each
          power.
        </p>
      </div>{:else}<p class="h-alert" data-havoc-comparison-unsupported>
        This saved season uses older rules. Its results are preserved, but a matching comparison is
        unavailable.
      </p>{/if}
    {#if comparison !== null && resultState.comparisonComplete}
      <dl class="h-stats">
        <div>
          <dt>Scored per game · Havoc / Normal</dt>
          <dd>
            {comparison.havoc.averagePointsFor.toFixed(1)}
            <span class="text-lg text-muted-foreground"
              >/ {comparison.normal.averagePointsFor.toFixed(1)}</span
            >
          </dd>
        </div>
        <div>
          <dt>Allowed per game · Havoc / Normal</dt>
          <dd>
            {comparison.havoc.averagePointsAgainst.toFixed(1)}
            <span class="text-lg text-muted-foreground"
              >/ {comparison.normal.averagePointsAgainst.toFixed(1)}</span
            >
          </dd>
        </div>
        <div>
          <dt>Normal record</dt>
          <dd>{havocRecordLabel(comparison.normal.wins, comparison.normal.losses)}</dd>
        </div>
      </dl>
      <HavocSquadReport {comparison} lineup={run.lineup} />
      <section class="h-panel mt-6">
        <h2 class="h-subtitle mb-4">Your season, game by game</h2>
        <HavocComparisonChart
          {comparison}
          {selectedGame}
          onSelect={(gameNumber) => (selectedGame = gameNumber)}
        />{#if selectedGame !== null}<HavocGameDetail {comparison} gameNumber={selectedGame} />{/if}
      </section>
    {:else}<div class="mt-6"><HavocLineupLock slots={run.lineup} /></div>{/if}
    {#if comparison !== null && resultState.comparisonComplete}<HavocAbilityReport
        {comparison}
      />{/if}
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
