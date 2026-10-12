<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import HavocHub from '$lib/features/havoc/HavocHub.svelte';
  import { HavocHubState } from '$lib/features/havoc/havoc-hub-state.svelte';
  import { getHavocService } from '$lib/features/havoc/havoc-service';

  let hub = $state<HavocHubState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    let instance: HavocHubState;
    try {
      instance = new HavocHubState(getHavocService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
    hub = instance;
    let mounted = true;
    void instance.load().then(async () => {
      if (!mounted || instance.error !== null) return;
      if (await instance.playSeason()) {
        if (mounted) await goto(resolve('/havoc/result'));
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
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <div role="alert" class="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Havoc is not wired yet
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{serviceError}</p>
    </div>
  </section>
{:else if hub !== null}
  <HavocHub
    {hub}
    onOpenResult={() => void goto(resolve('/havoc/result'))}
    onAbandoned={() => void goto(resolve('/havoc'))}
  />
{/if}
