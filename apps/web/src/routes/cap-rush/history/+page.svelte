<script lang="ts">
  import { onMount } from 'svelte';
  import CapRushHistoryList from '#lib/features/cap-rush/CapRushHistoryList.svelte';
  import { CapRushHistoryState } from '#lib/features/cap-rush/cap-rush-history-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let historyState = $state<CapRushHistoryState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    let instance: CapRushHistoryState;
    try {
      instance = new CapRushHistoryState(getCapRushService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
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
    <div role="alert" class="rounded-xl border border-negative/40 bg-negative/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Cap Rush could not start
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{serviceError}</p>
    </div>
  </section>
{:else if historyState !== null}
  <CapRushHistoryList state={historyState} />
{/if}
