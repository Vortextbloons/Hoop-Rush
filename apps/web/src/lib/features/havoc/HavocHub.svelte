<script lang="ts">
  import { resolve } from '$app/paths';
  import { Rocket } from '@lucide/svelte';
  import { HAVOC_GAME_COUNT } from '@hoop-rush/data-contracts';
  import type { HavocHubState } from './havoc-hub-state.svelte.js';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
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

<section class="h-shell" data-havoc-hub>
  {#if hub.loading && run === null}<p class="h-copy" aria-live="polite">
      Getting your squad ready…
    </p>
  {:else if run === null || run.phase === 'draft'}<Panel padding="md">
      <h1 class="h-title">Your squad awaits.</h1>
      <ActionLink class="mt-6" href={resolve('havoc/')}>Continue to draft</ActionLink>
    </Panel>
  {:else}
    <header class="h-header">
      <div>
        <p class="h-eyebrow">
          Hoop Havoc · {finalizing
            ? 'Preparing your report'
            : comparisonSeason
              ? 'Comparison season'
              : baseline
                ? 'Havoc season complete'
                : 'Season in motion'}
        </p>
        <h1 class="h-title mt-3">
          {baseline ? 'What did the powers change?' : 'Let the freaks cook.'}
        </h1>
        <p class="h-copy mt-4">
          {finalizing
            ? 'All games are saved. Crunching your comparison and MVP next.'
            : comparisonSeason
              ? 'Playing the same season without mutations to reveal the difference. Your full report is up next.'
              : baseline
                ? 'Continue to replay the schedule without powers, then reveal the full comparison.'
                : 'Your starting five are taking on the league. All 82 havoc games play automatically, then the same schedule replays without powers.'}
        </p>
      </div>
      <Rocket size={64} color="#ffd782" strokeWidth={1.25} />
    </header>
    <Panel as="section" padding="md" aria-label="Season progress" aria-busy={hub.busy}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="h-subtitle">
          {finalizing
            ? 'Finishing your report'
            : baseline
              ? 'Playing the comparison season'
              : 'Playing your season'}
        </h2>
        <span class="h-eyebrow" data-havoc-progress-label>{completed} / {total}</span>
      </div>
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
      <p class="h-copy text-xs">
        {finalizing && hub.busy
          ? 'All games are saved. Preparing your comparison and MVP.'
          : hub.busy
            ? 'Games are saved as they finish. Progress includes both 82-game seasons.'
            : 'Your progress is saved.'}
      </p>
      {#if hub.busy}<button
          class="h-link mt-4"
          data-havoc-cancel
          disabled={hub.cancelling}
          onclick={() => void hub.cancel()}>{hub.cancelling ? 'Pausing…' : 'Pause season'}</button
        >
      {:else if run.comparisonStatus === 'complete' || run.comparisonStatus === 'unsupported'}<Button
          class="mt-4"
          data-havoc-open-result
          onclick={onOpenResult}>Reveal season report</Button
        >
      {:else}<Button class="mt-4" data-havoc-resume onclick={() => void resume()}
          >Continue automatic season</Button
        >{/if}
    </Panel>
    {#if hub.error !== null}<Alert tone="danger">{hub.error}</Alert>{/if}
    {#if hub.error !== null && hub.isUnsupportedVersionError()}<Button
        class="mt-4"
        data-havoc-discard-stale
        onclick={() => void discardStale()}>Discard outdated run and start fresh</Button
      >{/if}
    {#if hub.notice !== null}<Alert tone="info">{hub.notice}</Alert>{/if}
    <div class="mt-6"><HavocLineupLock slots={run.lineup} /></div>
    {#if !hub.busy}<button
        class="h-link mt-6"
        data-havoc-abandon
        onclick={() => (abandonOpen = true)}>Retire this squad</button
      >
    {/if}

    {#if abandonOpen}
      <Panel padding="md" class="mt-4" role="group" aria-label="Retire squad confirmation">
        <h2 class="h-subtitle">Retire this squad?</h2>
        <p class="h-copy mt-2">
          This ends the run. The games you've played stay in the Hall of Freaks.
        </p>
        <div class="h-actions mt-4">
          <Button onclick={() => void abandon()}>Retire squad</Button><Button
            tone="secondary"
            onclick={() => (abandonOpen = false)}>Keep playing</Button
          >
        </div>
      </Panel>{/if}
  {/if}
</section>
