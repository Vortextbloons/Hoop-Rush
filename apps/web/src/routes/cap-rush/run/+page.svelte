<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import CapRushRunView from '#lib/features/cap-rush/CapRushRunView.svelte';
  import { loadCapRushArt, type CapRushArt } from '#lib/features/cap-rush/cap-rush-art.js';
  import { CapRushRunner } from '#lib/features/cap-rush/cap-rush-runner.js';
  import { CapRushSeasonController } from '#lib/features/cap-rush/cap-rush-season-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let controller = $state<CapRushSeasonController | null>(null);
  let art = $state.raw<CapRushArt | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    let mounted = true;
    const opened = openService(
      () => new CapRushSeasonController(getCapRushService(), new CapRushRunner()),
    );
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    controller = instance;
    void instance.load();
    void loadCapRushArt()
      .then((loaded) => {
        if (mounted) art = loaded;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      instance.destroy();
    };
  });
</script>

<svelte:head>
  <title>Cap Rush Run — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <ServiceErrorPanel title="Cap Rush could not start" message={serviceError} homeLink />
  </section>
{:else if controller !== null}
  <CapRushRunView
    {controller}
    {art}
    onReport={() => void goto(resolve('cap-rush/result/'))}
    onNewRun={() => void goto(resolve('cap-rush/'))}
  />
{/if}
