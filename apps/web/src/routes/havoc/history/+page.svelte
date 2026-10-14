<script lang="ts">
  import HavocHistoryList from '#lib/features/havoc/HavocHistoryList.svelte';
  import { HavocHistoryState } from '#lib/features/havoc/havoc-history-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';

  let historyState = $state<HavocHistoryState | null>(null);
  let serviceError = $state<string | null>(null);

  $effect(() => {
    let instance: HavocHistoryState;
    try {
      instance = new HavocHistoryState(getHavocService());
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
  <title>Hall of Freaks — Hoop Rush</title>
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
{:else if historyState !== null}
  <HavocHistoryList state={historyState} />
{/if}
