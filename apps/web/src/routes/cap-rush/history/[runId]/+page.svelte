<script lang="ts">
  import { page } from '$app/state';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import CapRushRunDetail from '#lib/features/cap-rush/CapRushRunDetail.svelte';
  import { CapRushResultState } from '#lib/features/cap-rush/cap-rush-result-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let resultState = $state<CapRushResultState | null>(null);
  let serviceError = $state<string | null>(null);
  const runId = $derived(page.params.runId ?? '');

  $effect(() => {
    const id = runId;
    const opened = openService(() => new CapRushResultState(getCapRushService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
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
    <ServiceErrorPanel title="Cap Rush could not start" message={serviceError} />
  </section>
{:else if resultState !== null}
  <CapRushRunDetail state={resultState} {runId} />
{/if}
