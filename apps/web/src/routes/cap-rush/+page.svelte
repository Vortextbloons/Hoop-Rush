<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import CapRushDraftBoard from '#lib/features/cap-rush/CapRushDraftBoard.svelte';
  import CapRushSetup from '#lib/features/cap-rush/CapRushSetup.svelte';
  import { CapRushDraftController } from '#lib/features/cap-rush/cap-rush-draft-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';
  import { loadCapRushArt, type CapRushArt } from '#lib/features/cap-rush/cap-rush-art.js';

  let controller = $state<CapRushDraftController | null>(null);
  let art = $state.raw<CapRushArt | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    let mounted = true;
    let instance: CapRushDraftController;
    try {
      instance = new CapRushDraftController(getCapRushService());
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

  function choosePosition(slot: Parameters<CapRushDraftController['choosePosition']>[0]): void {
    void controller?.choosePosition(slot);
  }
  function reroll(cardId: string): void {
    void controller?.reroll(cardId);
  }
  function sign(cardId: string): void {
    void controller?.sign(cardId);
  }
  function purchaseSpin(
    purchase: Parameters<CapRushDraftController['purchaseSpin']>[0],
    targetCardId: string,
  ): void {
    void controller?.purchaseSpin(purchase, targetCardId);
  }
  function skipSpin(): void {
    void controller?.skipSpin();
  }
  function discard(): void {
    void controller?.discard();
  }
</script>

<svelte:head>
  <title>Cap Rush — Hoop Rush</title>
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
  {#if controller.loading}
    <div class="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
      <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground uppercase">
        Loading the draft room…
      </p>
      <div
        class="mt-4 h-3 w-48 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
      ></div>
      <div
        class="mt-2 h-3 w-72 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
      ></div>
    </div>
  {:else if controller.draft !== null}
    <CapRushDraftBoard
      view={controller.draft}
      busy={controller.busy}
      error={controller.error}
      unsupported={controller.unsupported}
      {art}
      onChoose={choosePosition}
      onReroll={reroll}
      onSign={sign}
      onPurchaseSpin={purchaseSpin}
      onSkipSpin={skipSpin}
      onDiscard={discard}
    />
  {:else}
    <CapRushSetup {controller} />
  {/if}
{/if}
