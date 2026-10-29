<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import CapRushReportView from '#lib/features/cap-rush/CapRushReportView.svelte';
  import { CapRushResultState } from '#lib/features/cap-rush/cap-rush-result-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let resultState = $state<CapRushResultState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    let instance: CapRushResultState;
    try {
      instance = new CapRushResultState(getCapRushService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
    resultState = instance;
    void instance.load();
    return () => instance.destroy();
  });

  async function startNewRun(): Promise<void> {
    if (resultState === null) return;
    if (await resultState.startNewRun()) await goto(resolve('cap-rush/'));
  }
</script>

<svelte:head>
  <title>Cap Rush Result — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
  {#if serviceError !== null}
    <div role="alert" class="rounded-xl border border-negative/40 bg-negative/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Cap Rush could not start
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{serviceError}</p>
    </div>
  {:else if resultState !== null}
    {#if resultState.loading}
      <div class="flex flex-col gap-2">
        <div
          class="h-3 w-40 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
        ></div>
        <div
          class="h-3 w-64 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
        ></div>
      </div>
    {:else if resultState.report !== null}
      <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
            Cap Rush · Final report
          </p>
          <h1
            class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl"
          >
            The season is in the books.
          </h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <a
            href={resolve('cap-rush/history/')}
            class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            History
          </a>
          <button
            type="button"
            class="inline-flex min-h-11 items-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={resultState.busy}
            onclick={() => void startNewRun()}
          >
            {resultState.busy ? 'Opening a new draft…' : 'Start another run'}
          </button>
        </div>
      </header>
      <CapRushReportView report={resultState.report} />
    {:else if resultState.seasonInProgress}
      <AsyncState
        kind="empty"
        title="The season is not finished"
        message="Finish all 82 games to unlock the final report."
      >
        {#snippet actions()}
          <a
            href={resolve('cap-rush/run/')}
            class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            Continue the season
          </a>
        {/snippet}
      </AsyncState>
    {:else}
      <AsyncState
        kind="empty"
        title="No completed Cap Rush run"
        message={resultState.error ?? 'Finish an 82-game season to see its report here.'}
      >
        {#snippet actions()}
          <button
            type="button"
            class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            onclick={() => void goto(resolve('cap-rush/'))}>Start a Cap Rush run</button
          >
        {/snippet}
      </AsyncState>
    {/if}
  {/if}
</section>
