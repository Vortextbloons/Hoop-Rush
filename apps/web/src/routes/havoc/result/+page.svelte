<script lang="ts">
  import { onMount } from 'svelte';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocResultView from '#lib/features/havoc/HavocResultView.svelte';
  import { HavocResultState } from '#lib/features/havoc/havoc-result-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';

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
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <ServiceErrorPanel title="Havoc is not wired yet" message={serviceError} tone="destructive" />
  </section>
{:else if resultState !== null}
  <HavocResultView state={resultState} />
{/if}
