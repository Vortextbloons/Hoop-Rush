<script lang="ts">
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocHistoryList from '#lib/features/havoc/HavocHistoryList.svelte';
  import { HavocHistoryState } from '#lib/features/havoc/havoc-history-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';

  let historyState = $state<HavocHistoryState | null>(null);
  let serviceError = $state<string | null>(null);

  $effect(() => {
    const opened = openService(() => new HavocHistoryState(getHavocService()));
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
  <title>Hall of Freaks — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <ServiceErrorPanel title="Havoc is not wired yet" message={serviceError} tone="destructive" />
  </section>
{:else if historyState !== null}
  <HavocHistoryList state={historyState} />
{/if}
