<script lang="ts">
  import { page } from '$app/state';
  import HavocRunDetail from '$lib/features/havoc/HavocRunDetail.svelte';
  import { HavocHistoryState } from '$lib/features/havoc/havoc-history-state.svelte';
  import { getHavocService } from '$lib/features/havoc/havoc-service';

  let historyState = $state<HavocHistoryState | null>(null);
  let serviceError = $state<string | null>(null);
  const runId = $derived(page.params.runId ?? '');

  $effect(() => {
    let instance: HavocHistoryState;
    try {
      instance = new HavocHistoryState(getHavocService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
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
    <div role="alert" class="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Havoc is not wired yet
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{serviceError}</p>
    </div>
  </section>
{:else if historyState !== null}
  <HavocRunDetail state={historyState} {runId} />
{/if}
