<script lang="ts">
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocHistoryList from '#lib/features/havoc/HavocHistoryList.svelte';
  import { HavocHistoryState } from '#lib/features/havoc/havoc-history-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';
  import PageShell from '#lib/components/ui/PageShell.svelte';

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
  <PageShell as="section" width="sm" padding="xl">
    <ServiceErrorPanel title="Havoc could not start" message={serviceError} homeLink />
  </PageShell>
{:else if historyState !== null}
  <HavocHistoryList state={historyState} />
{/if}
