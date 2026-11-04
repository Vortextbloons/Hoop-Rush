<script lang="ts">
  import { browser } from '$app/env';
  import { resolve } from '$app/paths';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { errorMessageOf } from '#lib/errors.js';
  import { clearDataLoaderCaches, getManifest } from '#lib/data.js';
  import { challengeRepository } from './challenge-repo';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import HistoryList from './challenge-history-list.svelte';
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
        rows = history.filter((r) => r.mode === mode);
        active = activeCheckpoint;
        loading = false;
      },
      (e: unknown) => {
        if (cancelled) return;
        error = errorMessageOf(e);
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
  const continueHref = $derived(active?.mode === mode ? `/${mode}/challenge` : null);
</script>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <PageHeader {eyebrow} title="Challenge history">
    {#snippet actions()}
      <ActionLink href={resolve('/')} tone="ghost" size="sm">Back</ActionLink>
    {/snippet}
  </PageHeader>

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
    />
  {/if}
</section>
