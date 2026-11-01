<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import { openService } from '#lib/service-state.js';
  import HavocSetup from '#lib/features/havoc/HavocSetup.svelte';
  import { getManifest } from '#lib/data.js';
  import { HavocDraftController } from '#lib/features/havoc/havoc-draft-state.svelte.js';
  import { getHavocService } from '#lib/features/havoc/havoc-service.js';

  let controller = $state<HavocDraftController | null>(null);
  let serviceError = $state<string | null>(null);
  let franchiseName = $state<(franchiseId: string) => string>((franchiseId) => franchiseId);

  onMount(() => {
    const opened = openService(() => new HavocDraftController(getHavocService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    let mounted = true;
    controller = instance;
    void instance.load();
    void getManifest()
      .then((manifest) => {
        if (!mounted) return;
        franchiseName = (franchiseId) =>
          manifest.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)
            ?.displayName ?? franchiseId;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      instance.destroy();
    };
  });
</script>

<svelte:head>
  <title>Hoop Havoc — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <ServiceErrorPanel
      title="Havoc is not wired yet"
      message={serviceError}
      tone="destructive"
      homeLink
    />
  </section>
{:else if controller !== null}
  <div class="multiplayer-entry">
    <a class="h-button secondary" href={resolve('/multiplayer?format=havoc')}>Play multiplayer</a>
  </div>
  <HavocSetup {controller} {franchiseName} onLocked={() => void goto(resolve('havoc/run/'))} />
{/if}

<style>
  .multiplayer-entry {
    display: flex;
    justify-content: flex-end;
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px 24px 0;
  }
  @media (max-width: 760px) {
    .multiplayer-entry {
      padding: 12px 16px 0;
    }
  }
</style>
