<script lang="ts">
  import { page } from '$app/state';
  import CapRushRunDetail from '#lib/features/cap-rush/CapRushRunDetail.svelte';
  import { CapRushResultState } from '#lib/features/cap-rush/cap-rush-result-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let resultState = $state<CapRushResultState | null>(null);
  let serviceError = $state<string | null>(null);
  const runId = $derived(page.params.runId ?? '');

  $effect(() => {
    const id = runId;
    let instance: CapRushResultState;
    try {
      instance = new CapRushResultState(getCapRushService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
    resultState = instance;
    void instance.loadRun(id);
    return () => instance.destroy();
  });
</script>

<svelte:head>
  <title>Cap Rush run — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <div role="alert" class="rounded-xl border border-negative/40 bg-negative/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Cap Rush could not start
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{serviceError}</p>
    </div>
  </section>
{:else if resultState !== null}
  <CapRushRunDetail state={resultState} {runId} />
{/if}
