<script lang="ts">
  import { resolve } from '$app/paths';
  import { Rocket } from '@lucide/svelte';
  import type { HavocHubState } from './havoc-hub-state.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  let {
    hub,
    onOpenResult,
    onAbandoned,
  }: { hub: HavocHubState; onOpenResult: () => void; onAbandoned: () => void } = $props();
  let abandonOpen = $state(false);
  const run = $derived(hub.run);
  const baseline = $derived(hub.progress?.variant === 'normal' || (run?.havocCursor ?? 0) >= 82);
  const completed = $derived(
    hub.progress?.gamesCompleted ?? (baseline ? run?.normalCursor : run?.havocCursor) ?? 0,
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
  {:else if run === null || run.phase === 'draft'}<div class="h-panel">
      <h1 class="h-title">Your squad awaits.</h1>
      <a class="h-button mt-6" href={resolve('havoc/')}>Continue to draft</a>
    </div>
  {:else}
    <header class="h-header">
      <div>
        <p class="h-eyebrow">
          Hoop Havoc · {baseline ? 'Preparing your report' : 'Season in motion'}
        </p>
        <h1 class="h-title mt-3">
          {baseline ? 'What did the powers change?' : 'Let the freaks cook.'}
        </h1>
        <p class="h-copy mt-4">
          {baseline
            ? 'Playing the same season without mutations to reveal the difference. Your full report is up next.'
            : 'Your starting five are taking on the league. All 82 games play automatically.'}
        </p>
      </div>
      <Rocket size={64} color="#ffd782" strokeWidth={1.25} />
    </header>
    <section class="h-panel" aria-label="Season progress" aria-busy={hub.busy}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="h-subtitle">{baseline ? 'Building the final report' : 'Playing your season'}</h2>
        <span class="h-eyebrow" data-havoc-progress-label>{completed} / 82</span>
      </div>
      <div
        class="h-meter"
        role="progressbar"
        aria-label={baseline ? 'Comparison season progress' : 'Havoc season progress'}
        aria-valuemin={0}
        aria-valuemax={82}
        aria-valuenow={completed}
      >
        <div style:width={`${Math.min(100, (completed / 82) * 100)}%`}></div>
      </div>
      <p class="h-copy text-xs">
        {hub.busy ? 'Games are saved as they finish.' : 'Your progress is saved.'}
      </p>
      {#if hub.busy}<button
          class="h-link mt-4"
          data-havoc-cancel
          disabled={hub.cancelling}
          onclick={() => void hub.cancel()}>{hub.cancelling ? 'Pausing…' : 'Pause season'}</button
        >
      {:else if run.comparisonStatus === 'complete' || run.comparisonStatus === 'unsupported'}<button
          class="h-button mt-4"
          data-havoc-open-result
          onclick={onOpenResult}>Reveal season report</button
        >
      {:else}<button class="h-button mt-4" data-havoc-resume onclick={() => void resume()}
          >Continue automatic season</button
        >{/if}
    </section>
    {#if hub.error !== null}<p class="h-alert" role="alert">{hub.error}</p>{/if}
    {#if hub.error !== null && hub.isUnsupportedVersionError()}<button
        class="h-button mt-4"
        data-havoc-discard-stale
        onclick={() => void discardStale()}>Discard outdated run and start fresh</button
      >{/if}
    {#if hub.notice !== null}<p class="h-alert" role="status">{hub.notice}</p>{/if}
    <div class="mt-6"><HavocLineupLock slots={run.lineup} /></div>
    {#if !hub.busy}<button
        class="h-link mt-6"
        data-havoc-abandon
        onclick={() => (abandonOpen = true)}>Retire this squad</button
      >
    {/if}

    {#if abandonOpen}
      <div class="h-panel mt-4" role="group" aria-label="Retire squad confirmation">
        <h2 class="h-subtitle">Retire this squad?</h2>
        <p class="h-copy mt-2">
          This ends the run. The games you've played stay in the Hall of Freaks.
        </p>
        <div class="h-actions mt-4">
          <button class="h-button" onclick={() => void abandon()}>Retire squad</button><button
            class="h-button secondary"
            onclick={() => (abandonOpen = false)}>Keep playing</button
          >
        </div>
      </div>{/if}
  {/if}
</section>
