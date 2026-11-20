<script lang="ts">
  import { resolve } from '$app/paths';
  import { Rocket } from '@lucide/svelte';
  import { HAVOC_GAME_COUNT } from '@hoop-rush/data-contracts';
  import type { HavocHubState } from './havoc-hub-state.svelte.js';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  let {
    hub,
    onOpenResult,
    onAbandoned,
  }: { hub: HavocHubState; onOpenResult: () => void; onAbandoned: () => void } = $props();
  let abandonOpen = $state(false);
  const run = $derived(hub.run);
  const baseline = $derived((run?.havocCursor ?? 0) >= HAVOC_GAME_COUNT);
  const completed = $derived((run?.havocCursor ?? 0) + (run?.normalCursor ?? 0));
  const total = HAVOC_GAME_COUNT * 2;
  const finalizing = $derived(completed === total && run?.comparisonStatus !== 'complete');
  const comparisonSeason = $derived(
    baseline && !finalizing && ((run?.normalCursor ?? 0) > 0 || hub.progress?.variant === 'normal'),
  );
  async function resume() {
    if (await hub.playSeason()) onOpenResult();
  }
  async function abandon() {
    if (await hub.abandon()) onAbandoned();
  }
  async function discardStale() {
    if (await hub.discardStaleRun()) onAbandoned();
  }
</script>

<PageShell as="section" width="xl" padding="lg" data-havoc-hub>
  {#if hub.loading && run === null}<p class="text-sm text-muted-foreground" aria-live="polite">
      Getting your squad ready…
    </p>
  {:else if run === null && hub.error !== null}
    <EmptyState kind="error" title="Havoc run unavailable" message={hub.error}>
      {#snippet actions()}
        <Button size="sm" tone="secondary" onclick={() => void hub.load()}>Try again</Button>
        {#if hub.isUnsupportedVersionError()}
          <Button size="sm" tone="secondary" onclick={() => void discardStale()}
            >Discard outdated run</Button
          >
        {/if}
        <ActionLink href={resolve('havoc/')} tone="secondary">Back to Havoc</ActionLink>
      {/snippet}
    </EmptyState>
  {:else if run === null || run.phase === 'draft'}<Panel padding="md">
      <SectionHeading title="Your squad awaits." level={1} size="lg" align="start" />
      <ActionRow class="mt-6">
        {#snippet primary()}
          <ActionLink href={resolve('havoc/')}>Continue to draft</ActionLink>
        {/snippet}
      </ActionRow>
    </Panel>
  {:else}
    <PageHeader
      eyebrow={`Hoop Havoc · ${
        finalizing
          ? 'Preparing your report'
          : comparisonSeason
            ? 'Comparison season'
            : baseline
              ? 'Havoc season complete'
              : 'Season in motion'
      }`}
      title={baseline ? 'What did the powers change?' : 'Let the freaks cook.'}
      description={finalizing
        ? 'All games are saved. Crunching your comparison and MVP next.'
        : comparisonSeason
          ? 'Playing the same season without mutations to reveal the difference. Your full report is up next.'
          : baseline
            ? 'Continue to replay the schedule without powers, then reveal the full comparison.'
            : 'Your starting five are taking on the league. All 82 havoc games play automatically, then the same schedule replays without powers.'}
    >
      {#snippet actions()}
        <Rocket size={64} color="#ffd782" strokeWidth={1.25} aria-hidden="true" />
      {/snippet}
    </PageHeader>
    <Panel as="section" padding="md" class="mt-6" aria-label="Season progress" aria-busy={hub.busy}>
      <SectionHeading
        title={finalizing
          ? 'Finishing your report'
          : baseline
            ? 'Playing the comparison season'
            : 'Playing your season'}
        level={2}
        size="md"
      >
        {#snippet actions()}
          <p class="ui-label" data-havoc-progress-label>{completed} / {total}</p>
        {/snippet}
      </SectionHeading>
      <div
        class="h-meter"
        role="progressbar"
        aria-label="Saved games across both seasons"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
      >
        <div style:width={`${Math.min(100, (completed / total) * 100)}%`}></div>
      </div>
      <p class="text-xs text-muted-foreground">
        {finalizing && hub.busy
          ? 'All games are saved. Preparing your comparison and MVP.'
          : hub.busy
            ? 'Games are saved as they finish. Progress includes both 82-game seasons.'
            : 'Your progress is saved.'}
      </p>
      <ActionRow class="mt-4">
        {#snippet primary()}
          {#if hub.busy}<Button
              tone="ghost"
              data-havoc-cancel
              disabled={hub.cancelling}
              onclick={() => void hub.cancel()}
              >{hub.cancelling ? 'Pausing…' : 'Pause season'}</Button
            >
          {:else if run.comparisonStatus === 'complete' || run.comparisonStatus === 'unsupported'}<Button
              data-havoc-open-result
              onclick={onOpenResult}>Reveal season report</Button
            >
          {:else}<Button data-havoc-resume onclick={() => void resume()}>Resume season</Button>{/if}
        {/snippet}
      </ActionRow>
    </Panel>
    {#if hub.error !== null}<Alert class="mt-4" tone="danger">{hub.error}</Alert>{/if}
    {#if hub.error !== null && hub.isUnsupportedVersionError()}<Button
        class="mt-4"
        data-havoc-discard-stale
        onclick={() => void discardStale()}>Discard outdated run and start fresh</Button
      >{/if}
    {#if hub.notice !== null}<Alert class="mt-4" tone="info">{hub.notice}</Alert>{/if}
    <div class="mt-6"><HavocLineupLock slots={run.lineup} /></div>
    {#if !hub.busy}
      <ActionRow class="mt-6">
        {#snippet tertiary()}
          <Button tone="ghost" data-havoc-abandon onclick={() => (abandonOpen = true)}
            >Retire this squad</Button
          >
        {/snippet}
      </ActionRow>
    {/if}

    {#if abandonOpen}
      <Panel padding="md" class="mt-4" role="group" aria-label="Retire squad confirmation">
        <SectionHeading title="Retire this squad?" level={2} size="md" />
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
          This ends the run. The games you've played stay in the Hall of Freaks.
        </p>
        <ActionRow class="mt-4">
          {#snippet primary()}
            <Button onclick={() => void abandon()}>Retire squad</Button>
          {/snippet}
          {#snippet secondary()}
            <Button tone="secondary" onclick={() => (abandonOpen = false)}>Keep playing</Button>
          {/snippet}
        </ActionRow>
      </Panel>{/if}
  {/if}
</PageShell>
