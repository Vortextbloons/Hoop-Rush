<script lang="ts">
  import { page } from '$app/state';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocRunDetail from '#lib/features/havoc/HavocRunDetail.svelte';
  import { HavocHistoryState } from '#lib/features/havoc/havoc-history-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';

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
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <ServiceErrorPanel title="Havoc is not wired yet" message={serviceError} tone="destructive" />
  </section>
{:else if historyState !== null}
  <HavocRunDetail state={historyState} {runId} />
{/if}
