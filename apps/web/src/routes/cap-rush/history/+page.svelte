<script lang="ts">
  import { onMount } from 'svelte';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import CapRushHistoryList from '#lib/features/cap-rush/CapRushHistoryList.svelte';
  import { CapRushHistoryState } from '#lib/features/cap-rush/cap-rush-history-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let historyState = $state<CapRushHistoryState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    const opened = openService(() => new CapRushHistoryState(getCapRushService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    historyState = instance;
    void instance.load();
    return () => instance.destroy();
  });
</script>

<svelte:head>
  <title>Cap Rush History — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <ServiceErrorPanel title="Cap Rush could not start" message={serviceError} />
  </section>
{:else if historyState !== null}
  <CapRushHistoryList state={historyState} />
{/if}
