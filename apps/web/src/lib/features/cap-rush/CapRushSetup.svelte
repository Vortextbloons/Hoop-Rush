<script lang="ts">
  import type { CapRushDraftController } from './cap-rush-draft-state.svelte.js';
  import { ArrowRight, Dices, Trophy } from '@lucide/svelte';

  let { controller }: { controller: CapRushDraftController } = $props();

  const variants = [
    {
      id: 'clash' as const,
      name: 'Cap Clash',
      description: 'Draft your five and manage the cap.',
      icon: Trophy,
      accent: 'border-border hover:border-primary',
      iconClass: 'bg-primary/10 text-primary',
    },
    {
      id: 'roulette' as const,
      name: 'Cap Roulette',
      description: 'Draft your five and buy mutation spins.',
      icon: Dices,
      accent: 'border-border hover:border-accent',
      iconClass: 'bg-accent/10 text-accent',
    },
  ];
</script>

<section class="mx-auto w-full max-w-5xl px-4 pt-10 pb-24 sm:px-6 md:pt-16 md:pb-12">
  <div class="max-w-3xl">
    <p class="font-mono text-[10px] font-bold tracking-[0.2em] text-primary uppercase">Cap Rush</p>
    <h1
      class="font-display mt-3 text-4xl leading-[0.92] font-extrabold tracking-tight uppercase sm:text-5xl md:text-6xl"
    >
      Build a contender.<br />
      <span class="text-primary">Mind the apron.</span>
    </h1>
  </div>

  <div class="mt-8 grid gap-4 md:grid-cols-2">
    {#each variants as variant (variant.id)}
      {@const Icon = variant.icon}
      <div
        class="mode-card group flex flex-col rounded-2xl border bg-card p-6 transition-colors {variant.accent}"
      >
        <span class="grid h-12 w-12 place-items-center rounded-xl {variant.iconClass}">
          <Icon size={22} aria-hidden="true" />
        </span>
        <h2 class="font-display mt-5 text-3xl font-extrabold tracking-tight uppercase">
          {variant.name}
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">{variant.description}</p>
        <button
          type="button"
          class="mt-5 inline-flex min-h-12 items-center justify-between rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          disabled={controller.busy}
          onclick={() => void controller.createDraft(variant.id)}
        >
          {controller.busy ? 'Opening draft…' : `Start with ${variant.name}`}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    {/each}
  </div>

  {#if controller.error !== null}
    <div
      role="alert"
      class="mt-5 rounded-xl border border-negative/40 bg-negative/10 p-4 text-sm text-negative"
    >
      {controller.error}
      {#if controller.unsupported}
        <button
          type="button"
          class="mt-3 inline-flex min-h-10 items-center rounded-lg border border-negative/50 px-3 text-xs font-bold uppercase"
          disabled={controller.busy}
          onclick={() => void controller.discard()}>Discard outdated draft and start fresh</button
        >
      {/if}
    </div>
  {/if}
</section>

<style>
  .mode-card {
    border-top: 3px solid var(--color-primary);
  }
</style>
