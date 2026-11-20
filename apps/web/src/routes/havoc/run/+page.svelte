<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocHub from '#lib/features/havoc/HavocHub.svelte';
  import { HavocHubState } from '#lib/features/havoc/havoc-hub-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';
  import PageShell from '#lib/components/ui/PageShell.svelte';

  let hub = $state<HavocHubState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    const opened = openService(() => new HavocHubState(getHavocService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    hub = instance;
    let mounted = true;
    void instance.load().then(async () => {
      if (!mounted || instance.error !== null) return;
      if (await instance.playSeason()) {
        if (mounted) await goto(resolve('havoc/result/'));
      }
    });
    return () => {
      mounted = false;
      instance.destroy();
    };
  });
</script>

<svelte:head>
  <title>Havoc Run — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <PageShell as="section" width="sm" padding="xl">
    <ServiceErrorPanel title="Havoc could not start" message={serviceError} homeLink />
  </PageShell>
{:else if hub !== null}
  <HavocHub
    {hub}
    onOpenResult={() => void goto(resolve('havoc/result/'))}
    onAbandoned={() => void goto(resolve('havoc/'))}
  />
{:else}
  <PageShell width="sm" padding="xl">
    <p class="text-sm text-muted-foreground" role="status">Opening your Havoc season…</p>
  </PageShell>
{/if}
