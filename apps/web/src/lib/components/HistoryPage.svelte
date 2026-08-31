<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { clearDataLoaderCaches, getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import AsyncState from './AsyncState.svelte';
  import HistoryList from './HistoryList.svelte';
  let {
    mode,
    eyebrow,
  }: {
    mode: 'sandbox' | 'classic';
    eyebrow: string;
  } = $props();
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
  const modeLabel = $derived(mode === 'sandbox' ? 'Sandbox' : 'Classic');
  const continueHref = $derived(
    mode === 'sandbox'
      ? '/sandbox/challenge'
      : active?.mode === 'classic'
        ? '/classic/challenge'
        : null,
  );
  const resultHrefFor = $derived(
    (runId: string) => `/${mode}/result?runId=${encodeURIComponent(runId)}`,
  );
</script>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
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
      {modeLabel}
      emptyTitle="No completed challenges yet."
      emptyHref={mode === 'sandbox' ? '/sandbox' : '/classic'}
      emptyCta={mode === 'sandbox' ? 'Start a sandbox challenge' : 'Start a classic challenge'}
      {continueHref}
      {resultHrefFor}
    />
  {/if}
</section>
