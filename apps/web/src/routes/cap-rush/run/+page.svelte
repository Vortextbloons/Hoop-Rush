<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
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
    let instance: CapRushSeasonController;
    try {
      instance = new CapRushSeasonController(getCapRushService(), new CapRushRunner());
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
      return;
    }
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

  async function play(): Promise<void> {
    if (controller === null) return;
    if (await controller.playSeason()) await goto(resolve('cap-rush/result/'));
  }

  function cancel(): void {
    controller?.cancel();
  }

  async function postseason(): Promise<void> {
    if (controller === null) return;
    if (await controller.advancePostseason()) await goto(resolve('cap-rush/result/'));
  }
</script>

<svelte:head>
  <title>Cap Rush Run — Hoop Rush</title>
</svelte:head>

{#if serviceError !== null}
  <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
    <div role="alert" class="rounded-xl border border-negative/40 bg-negative/10 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Cap Rush could not start
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
  <CapRushRunView
    {controller}
    {art}
    onPlay={() => void play()}
    onCancel={cancel}
    onReport={() => void goto(resolve('cap-rush/result/'))}
    onNewRun={() => void goto(resolve('cap-rush/'))}
    onPostseason={() => void postseason()}
  />
{/if}
