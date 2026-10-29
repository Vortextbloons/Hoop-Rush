<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CapRushDraftBoard from '#lib/features/cap-rush/CapRushDraftBoard.svelte';
  import CapRushSetup from '#lib/features/cap-rush/CapRushSetup.svelte';
  import { CapRushDraftController } from '#lib/features/cap-rush/cap-rush-draft-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';
  import { loadCapRushArt, type CapRushArt } from '#lib/features/cap-rush/cap-rush-art.js';
  import { variantLabel } from '#lib/features/cap-rush/cap-rush-presentation.js';

  let controller = $state<CapRushDraftController | null>(null);
  let art = $state.raw<CapRushArt | null>(null);
  let serviceError = $state<string | null>(null);
  let leaving = $state(false);

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
  function lock(): void {
    void controller?.lockLineup();
  }
  function discard(): void {
    void controller?.discard();
  }

  const stage = $derived(controller?.draft?.draft.stage ?? null);
  const handedOff = $derived(stage === 'locked' || stage === 'completed');

  $effect(() => {
    const current = stage;
    if (controller === null || leaving || !handedOff) return;
    leaving = true;
    void goto(resolve(current === 'completed' ? 'cap-rush/result/' : 'cap-rush/run/')).catch(() => {
      leaving = false;
    });
  });
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
  {:else if controller.draft !== null && stage === 'abandoned'}
    <section class="mx-auto w-full max-w-xl px-3 py-10 sm:px-6">
      <div class="rounded-2xl border border-border bg-card p-6">
        <p
          class="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground uppercase"
        >
          {variantLabel(controller.draft.draft.variant)} · Run abandoned
        </p>
        <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase">
          This run is over.
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
          The five you signed never finished the season, so it has no report. Clear it to start a
          fresh draft.
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex min-h-11 items-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={controller.busy}
            onclick={discard}>Start a new draft</button
          >
          <a
            href={resolve('cap-rush/history/')}
            class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cap Rush history
          </a>
        </div>
        {#if controller.error !== null}
          <p role="alert" class="mt-3 text-xs font-semibold text-negative">{controller.error}</p>
        {/if}
      </div>
    </section>
  {:else if controller.draft !== null && handedOff}
    <div class="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
      <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-muted-foreground uppercase">
        Opening the {stage === 'completed' ? 'season report' : 'season'}…
      </p>
      <div
        class="mt-4 h-3 w-48 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
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
      onLock={lock}
      onDiscard={discard}
    />
  {:else}
    <CapRushSetup {controller} />
  {/if}
{/if}
