<script lang="ts">
  import { resolve } from '$app/paths';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import CapRushReportView from './CapRushReportView.svelte';
  import type { CapRushResultState } from './cap-rush-result-state.svelte.js';

  let { state, runId }: { state: CapRushResultState; runId: string } = $props();
</script>

<section class="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6" aria-label="Saved Cap Rush run">
  <a
    href={resolve('cap-rush/history/')}
    class="font-mono text-[11px] text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
  >
    ← Cap Rush history
  </a>

  <div class="mt-4">
    {#if state.loading}
      <div class="flex flex-col gap-2">
        <div
          class="h-3 w-40 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
        ></div>
        <div
          class="h-3 w-64 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
        ></div>
      </div>
    {:else if state.report !== null}
      <header class="mb-4">
        <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
          Cap Rush · Saved season
        </p>
        <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
          Saved report
        </h1>
        <p class="mt-1 font-mono text-[10px] break-all text-muted-foreground">{runId}</p>
      </header>
      <CapRushReportView report={state.report} />
    {:else}
      <AsyncState
        kind="error"
        title="Run unavailable"
        message={state.error ?? `No completed Cap Rush run with id ${runId} was found.`}
      >
        {#snippet actions()}
          <a
            href={resolve('cap-rush/history/')}
            class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to history
          </a>
        {/snippet}
      </AsyncState>
    {/if}
  </div>
</section>
