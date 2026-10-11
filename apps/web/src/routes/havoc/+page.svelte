<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import HavocSetup from '$lib/components/havoc/HavocSetup.svelte';
  import { getManifest } from '$lib/data';
  import { HavocDraftController } from '$lib/havoc/havoc-draft-state.svelte';
  import { getHavocService } from '$lib/havoc/havoc-service';

  let controller = $state<HavocDraftController | null>(null);
  let serviceError = $state<string | null>(null);
  let franchiseName = $state<(franchiseId: string) => string>((franchiseId) => franchiseId);

  $effect(() => {
    let instance: HavocDraftController;
    try {
      instance = new HavocDraftController(getHavocService());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
    controller = instance;
    void instance.load();
    void getManifest()
      .then((manifest) => {
        franchiseName = (franchiseId) =>
          manifest.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)
            ?.displayName ?? franchiseId;
      })
      .catch(() => undefined);
    return () => instance.destroy();
  });
</script>

<svelte:head>
  <title>Hoop Havoc — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <div role="alert" class="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Havoc is not wired yet
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{serviceError}</p>
      <a
        href={resolve('/')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to home
      </a>
    </div>
  </section>
{:else if controller !== null}
  <HavocSetup {controller} {franchiseName} onLocked={() => void goto(resolve('/havoc/run'))} />
{/if}
