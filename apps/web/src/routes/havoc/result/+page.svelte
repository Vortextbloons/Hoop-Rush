<script lang="ts">
  import HavocResultView from '$lib/components/havoc/HavocResultView.svelte';
  import { HavocResultState } from '$lib/havoc/havoc-result-state.svelte';
  import { getHavocService } from '$lib/havoc/havoc-service';

  let resultState = $state<HavocResultState | null>(null);
  let serviceError = $state<string | null>(null);

  $effect(() => {
    let instance: HavocResultState;
    try {
      instance = new HavocResultState(getHavocService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
    resultState = instance;
    void instance.load();
    return () => instance.destroy();
  });
</script>

<svelte:head>
  <title>Havoc Result — Hoop Rush</title>
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
{:else if resultState !== null}
  <HavocResultView state={resultState} />
{/if}
