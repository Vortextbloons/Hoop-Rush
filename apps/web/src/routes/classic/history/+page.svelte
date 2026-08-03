<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import HistoryList from '$lib/components/HistoryList.svelte';

  /**
   * Classic challenge history: the shared completed-run list. Rows identify
   * the information variant; the active card only offers continue when the
   * active run is itself a classic run.
   */

  let manifest = $state<HoopRushManifest | null>(null);
  let rows = $state.raw<CompletedRunIndex[]>([]);
  let active = $state.raw<ActiveRunCheckpoint | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) manifest = m;
      },
      () => {
        // History renders without the manifest (names fall back to ids).
      },
    );
    Promise.all([
      challengeRepository.listCompletedRuns(),
      challengeRepository.loadActiveRunCheckpoint(),
    ]).then(
      ([history, activeCheckpoint]) => {
        if (cancelled) return;
        rows = history;
        active = activeCheckpoint;
      },
      (e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      },
    );
    return () => {
      cancelled = true;
    };
  });

  const continueHref = $derived(active?.mode === 'classic' ? '/classic/challenge' : null);
</script>

<svelte:head>
  <title>Challenge history — Classic — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
        Classic · Challenge history
      </p>
      <h1
        class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
      >
        Challenge history
      </h1>
    </div>
    <a
      href={resolve('/')}
      class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
    >
      Back
    </a>
  </div>

  {#if error}
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      {error}
    </p>
  {:else}
    <HistoryList
      {manifest}
      {rows}
      {active}
      modeLabel="Classic"
      emptyTitle="No completed challenges yet."
      emptyHref="/classic"
      emptyCta="Start a classic challenge"
      {continueHref}
      resultHrefFor={(runId) => `/classic/result?runId=${encodeURIComponent(runId)}`}
    />
  {/if}
</section>
