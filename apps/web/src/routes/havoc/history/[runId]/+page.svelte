<script lang="ts">
  import { page } from '$app/state';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocRunDetail from '#lib/features/havoc/HavocRunDetail.svelte';
  import { HavocHistoryState } from '#lib/features/havoc/havoc-history-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';
  import PageShell from '#lib/components/ui/PageShell.svelte';

  let historyState = $state<HavocHistoryState | null>(null);
  let serviceError = $state<string | null>(null);
  const runId = $derived(page.params.runId ?? '');

  $effect(() => {
    const opened = openService(() => new HavocHistoryState(getHavocService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    historyState = instance;
    const id = runId;
    void instance.loadRun(id);
    return () => instance.destroy();
  });
</script>

<svelte:head>
  <title>Havoc run — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <PageShell as="section" width="sm" padding="xl">
    <ServiceErrorPanel title="Havoc could not start" message={serviceError} homeLink />
  </PageShell>
{:else if historyState !== null}
  <HavocRunDetail state={historyState} {runId} />
{/if}
