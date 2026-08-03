<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { clearDataLoaderCaches, getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import HistoryList from '$lib/components/HistoryList.svelte';

  /**
   * Compact completed-run history (spec/08). Rows list lineup, franchise/era,
   * record, outcome, and completion time; each row reopens the stored
   * summary. The active challenge, when one exists, is offered for continue.
   */

  let manifest = $state<HoopRushManifest | null>(null);
  let rows = $state.raw<CompletedRunIndex[]>([]);
  let active = $state.raw<ActiveRunCheckpoint | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let retryCount = $state(0);

  function loadHistory() {
    loading = true;
    error = null;
    let cancelled = false;
    Promise.all([
      getManifest(),
      challengeRepository.listCompletedRuns(),
      challengeRepository.loadActiveRunCheckpoint(),
    ]).then(
      ([m, history, activeCheckpoint]) => {
        if (cancelled) return;
        manifest = m;
        rows = history;
        active = activeCheckpoint;
        loading = false;
      },
      (e: unknown) => {
        if (cancelled) return;
        error = e instanceof Error ? e.message : String(e);
        loading = false;
      },
    );
    return () => {
      cancelled = true;
    };
  }

  $effect(() => {
    if (!browser) return;
    void retryCount;
    return loadHistory();
  });

  function retryHistory() {
    clearDataLoaderCaches();
    retryCount += 1;
  }
</script>

<svelte:head>
  <title>Challenge history — Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox</p>
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
    <div class="mt-8">
      <AsyncState
        kind="error"
        title="History unavailable"
        message={`Failed to load challenge history: ${error}`}
        retry={retryHistory}
      />
    </div>
  {:else if loading}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading history" message="Reading completed runs…" />
    </div>
  {:else}
    <HistoryList
      {manifest}
      {rows}
      {active}
      modeLabel="Sandbox"
      emptyTitle="No completed challenges yet."
      emptyHref="/sandbox"
      emptyCta="Start a sandbox challenge"
      continueHref="/sandbox/challenge"
      resultHrefFor={(runId) => `/sandbox/result?runId=${encodeURIComponent(runId)}`}
    />
  {/if}
</section>
