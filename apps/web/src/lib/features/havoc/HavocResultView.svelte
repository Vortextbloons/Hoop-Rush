<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { resolve } from '$app/paths';
  import { ArrowRight } from '@lucide/svelte';
  import type { HavocResultState } from './havoc-result-state.svelte.js';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import HavocSquadReport from './HavocSquadReport.svelte';
  import HavocComparisonChart from './HavocComparisonChart.svelte';
  import HavocGameDetail from './HavocGameDetail.svelte';
  import AchievementReveal from '#lib/features/profile/AchievementReveal.svelte';
  import { havocRecordLabel, havocDeltaTitle, formatSignedPoints } from './havoc-presentation';
  import Button from '#lib/components/ui/Button.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
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

<PageShell as="section" width="xl" padding="lg" data-havoc-result>
  {#if resultState.loading}<p class="text-sm text-muted-foreground" aria-live="polite">
      Opening your season report…
    </p>
  {:else if run === null || run.phase === 'draft'}<Panel padding="md">
      <SectionHeading title="Your story starts here." level={1} size="lg" align="start" />
      <ActionRow class="mt-6">
        {#snippet primary()}
          <ActionLink href={resolve('havoc/')}>Draft your squad</ActionLink>
        {/snippet}
      </ActionRow>
    </Panel>
  {:else if !resultState.havocSeasonComplete}<Panel padding="md">
      <SectionHeading
        title="Season in progress."
        description="Your report arrives after both 82-game seasons: with powers, then the same schedule without them."
        level={1}
        size="lg"
        align="start"
      />
      <ActionRow class="mt-6">
        {#snippet primary()}
          <ActionLink href={resolve('havoc/run/')}>Resume season</ActionLink>
        {/snippet}
      </ActionRow>
    </Panel>
  {:else if !resultState.comparisonComplete && run.comparisonStatus !== 'unsupported'}
    <Panel padding="md" data-havoc-comparison-pending>
      <SectionHeading
        eyebrow="One last thing"
        title="The powers. The proof."
        description="We're playing the same season without powers. Both results will be revealed together."
        level={1}
        size="lg"
        align="start"
      />
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

      <p class="text-sm text-muted-foreground" data-havoc-comparison-progress>{completed} / 82</p>
      <ActionRow class="mt-4">
        {#snippet primary()}
          {#if !resultState.busy}<Button
              data-havoc-run-normal
              onclick={() => void resultState.runNormalSeason()}>Finish season report</Button
            >
          {:else}<Button
              tone="secondary"
              disabled={resultState.cancelling}
              onclick={() => void resultState.cancelComparison()}
              >{resultState.cancelling ? 'Pausing...' : 'Pause report preparation'}</Button
            >
          {/if}
        {/snippet}
      </ActionRow>
    </Panel>
  {:else}
    <ResultScreen
      eyebrow="Hoop Havoc · Season report"
      title={comparison !== null && resultState.comparisonComplete
        ? havocDeltaTitle(comparison.winsGained)
        : 'Season complete'}
    >
      {#snippet hero()}
        <ResultHero
          score={havocRecordLabel(run.havocWins, run.havocLosses)}
          caption="With powers"
          meta={comparison !== null && resultState.comparisonComplete
            ? `Without powers ${havocRecordLabel(
                comparison.normal.wins,
                comparison.normal.losses,
              )} · Wins delta ${formatSignedPoints(comparison.winsGained)}`
            : null}
          secondary={run.perfectSeason
            ? '82 wins. Zero losses. Perfect season challenge cleared.'
            : '82 games complete. See how your five finished.'}
          data-havoc-final-record
          data-havoc-result-objective
        />
      {/snippet}

      <AchievementReveal bindingId={`havoc:${run.runId}`} />

      {#if run.comparisonStatus === 'unsupported'}
        <Alert tone="warning" data-havoc-comparison-unsupported>
          This saved season uses older rules. Its results are preserved, but a matching comparison
          is unavailable.
        </Alert>
        {#if resultState.report !== null}<StatGrid class="mt-4" columns={4} mobile={2}>
            <StatTile
              label="Average score margin"
              size="sm"
              valueClass="font-sans text-base font-bold"
              value={(
                resultState.report.havoc.differential / resultState.report.havoc.games
              ).toFixed(1)}
            />
            <StatTile
              label="Direct power points"
              size="sm"
              valueClass="font-sans text-base font-bold"
              value={resultState.report.directMutationPoints}
            />
          </StatGrid>{/if}
      {/if}

      {#if comparison !== null && resultState.comparisonComplete}
        <p class="text-xs text-muted-foreground">
          Same squad, opponents and seeds. Deltas compare the two seasons; individual abilities
          can't be isolated from them.
        </p>
        <StatGrid class="mt-4" columns={4} mobile={2}>
          <StatTile
            label="Scored / game"
            size="sm"
            valueClass="font-sans text-base font-bold"
            value={`${comparison.havoc.averagePointsFor.toFixed(1)} / ${comparison.normal.averagePointsFor.toFixed(1)}`}
          />
          <StatTile
            label="Allowed / game"
            size="sm"
            valueClass="font-sans text-base font-bold"
            value={`${comparison.havoc.averagePointsAgainst.toFixed(1)} / ${comparison.normal.averagePointsAgainst.toFixed(1)}`}
          />
          <StatTile
            label="Margin delta / game"
            size="sm"
            valueClass="font-sans text-base font-bold"
            value={formatSignedPoints(
              Number((comparison.differentialDelta / comparison.havoc.games).toFixed(1)),
            )}
          />
          <StatTile
            label="Direct power points"
            size="sm"
            valueClass="font-sans text-base font-bold"
            value={resultState.report?.directMutationPoints ??
              comparison.mutations.reduce((sum, power) => sum + power.pointsDelta, 0)}
            data-havoc-direct-mutation-points
          />
        </StatGrid>
        <HavocSquadReport {comparison} lineup={run.lineup} />
        <Disclosure summary="Your season, game by game · 82 matched results">
          <HavocComparisonChart
            {comparison}
            {selectedGame}
            onSelect={(gameNumber) => {
              selectedGame = gameNumber;
              gameDetailsOpen = true;
            }}
          />
        </Disclosure>
      {:else}
        <HavocLineupLock slots={run.lineup} />
      {/if}

      <ActionRow class="mt-2">
        {#snippet primary()}
          <ActionLink href={resolve('havoc/')}
            >Draft another squad <ArrowRight size={18} /></ActionLink
          >
        {/snippet}
        {#snippet tertiary()}
          <ActionLink tone="ghost" href={resolve('havoc/history/')}>Run history</ActionLink>
        {/snippet}
      </ActionRow>

      {#if comparison !== null && resultState.comparisonComplete}
        <Disclosure summary="Explore the box scores, powers & game-by-game comparison">
          <HavocComparisonView {comparison} showChart={false} />
        </Disclosure>
      {/if}

      <div>
        <ActionLink tone="ghost" href={resolve('/havoc/history/[runId]', { runId: run.runId })}
          >Open full saved report</ActionLink
        >
      </div>
    </ResultScreen>
  {/if}
  {#if resultState.error !== null}<Alert class="mt-4" tone="danger">{resultState.error}</Alert>{/if}
  {#if resultState.notice !== null}<Alert class="mt-4" tone="info">{resultState.notice}</Alert>{/if}
</PageShell>
<Dialog.Root bind:open={gameDetailsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="h-result-overlay" />
    <Dialog.Content class="havoc-world h-result-dialog">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <Dialog.Title class="font-display text-xl font-extrabold tracking-tight uppercase"
          >Game {selectedGame} comparison</Dialog.Title
        ><Dialog.Close class="ui-btn" data-tone="secondary">Close</Dialog.Close>
      </header>

      <Dialog.Description class="mt-2 text-xs text-muted-foreground"
        >The same matchup, with and without powers.</Dialog.Description
      >

      {#if comparison !== null && selectedGame !== null}
        <HavocGameDetail {comparison} gameNumber={selectedGame} />
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
