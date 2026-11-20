<script lang="ts">
  import { onMount } from 'svelte';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocResultView from '#lib/features/havoc/HavocResultView.svelte';
  import { HavocResultState } from '#lib/features/havoc/havoc-result-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';
  import PageShell from '#lib/components/ui/PageShell.svelte';

  let resultState = $state<HavocResultState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    const opened = openService(() => new HavocResultState(getHavocService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    resultState = instance;
    let mounted = true;
    void instance.load().then(async () => {
      if (!mounted || instance.error !== null || !instance.havocSeasonComplete) return;
      if (!instance.comparisonComplete && instance.run?.comparisonStatus !== 'unsupported') {
        await instance.runNormalSeason();
      }
    });
    return () => {
      mounted = false;
      instance.destroy();
    };
  });
</script>

<svelte:head>
  <title>Havoc Result — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <PageShell as="section" width="sm" padding="xl">
    <ServiceErrorPanel title="Havoc could not start" message={serviceError} homeLink />
  </PageShell>
{:else if resultState !== null}
  <HavocResultView state={resultState} />
{:else}
  <PageShell width="sm" padding="xl">
    <p class="text-sm text-muted-foreground" role="status">Opening your season report…</p>
  </PageShell>
{/if}
