<script lang="ts">
  import type { CapRushDraftController } from './cap-rush-draft-state.svelte.js';
  import { ArrowRight, Dices, Shuffle, Trophy } from '@lucide/svelte';

  let { controller }: { controller: CapRushDraftController } = $props();

  const variants = [
    {
      id: 'clash' as const,
      name: 'Cap Clash',
      icon: Trophy,
      accent: 'border-border hover:border-primary',
      iconClass: 'bg-primary/10 text-primary',
    },
    {
      id: 'roulette' as const,
      name: 'Cap Roulette',
      icon: Dices,
      tagline: 'One paid spin. One mutation.',
      description:
        'Everything in Cap Clash, plus one optional paid mutation spin after the draft. The cheaper the roster, the higher the tier you can afford.',
      highlights: [
        'Standard $15M · 60/30/10',
        'Premium $30M · 35/40/25',
        'One mutation, permanently',
      ],
      accent: 'border-border hover:border-accent',
      iconClass: 'bg-accent/10 text-accent',
    },
  ];
  const steps = [
    {
      title: '1 · Pick a slot',
      body: 'Choose any exact position — PG, SG, SF, PF or C — in any order.',
    },
    {
      title: '2 · Sign a card',
      body: 'Eight cards appear. One signing per slot. Two protected rerolls for the whole draft.',
    },
    {
      title: '3 · Live with the bill',
      body: 'Your five salaries set the apron. The highest-paid starter becomes the target.',
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
        class="group flex flex-col rounded-2xl border bg-card p-6 transition-colors {variant.accent}"
      >
        <span class="grid h-12 w-12 place-items-center rounded-xl {variant.iconClass}">
          <Icon size={22} aria-hidden="true" />
        </span>
        <h2 class="font-display mt-5 text-3xl font-extrabold tracking-tight uppercase">
          {variant.name}
        </h2>
        {#if variant.tagline}
          <p class="mt-1 text-sm font-semibold">{variant.tagline}</p>
        {/if}
        {#if variant.description}
          <p class="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
            {variant.description}
          </p>
        {:else}
          <div class="flex-1"></div>
        {/if}
        {#if variant.highlights?.length}
          <ul class="mt-4 space-y-1.5">
            {#each variant.highlights as highlight (highlight)}
              <li class="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span class="h-1 w-1 rounded-full bg-primary"></span>
                {highlight}
              </li>
            {/each}
          </ul>
        {/if}
        <button
          type="button"
          class="mt-5 inline-flex min-h-11 items-center justify-between rounded-xl border border-line-strong px-4 text-sm font-bold outline-none transition-colors group-hover:border-primary group-hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          disabled={controller.busy}
          onclick={() => void controller.createDraft(variant.id)}
        >
          {controller.busy ? 'Opening draft…' : `Start with ${variant.name}`}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    {/each}
  </div>

  <ol class="mt-8 grid gap-3 sm:grid-cols-3">
    {#each steps as step (step.title)}
      <li class="rounded-xl border border-border bg-card p-4">
        <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-primary uppercase">
          {step.title}
        </p>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
      </li>
    {/each}
  </ol>

  <details class="mt-6 rounded-2xl border border-border bg-card p-5">
    <summary class="cursor-pointer font-display text-sm font-extrabold tracking-tight uppercase">
      How the apron reshapes your five
    </summary>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <div>
        <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-accent uppercase">
          First apron · $120M–$135M
        </p>
        <p class="mt-1 text-xs font-semibold">Superstar Syndrome + Give Me the Ball</p>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          Passing, ball handling, offensive and defensive IQ, perimeter and interior defense, and
          shooting take a smaller hit. Every sixth possession becomes a forced isolation.
        </p>
      </div>
      <div>
        <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-primary uppercase">
          Second apron · $135M–$150M
        </p>
        <p class="mt-1 text-xs font-semibold">
          Locker Room Meltdown + Hero Ball + Defensive Strike
        </p>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          The smaller hit becomes a larger one, inside scoring and rebounding are cut, every third
          possession is forced isolation, and every sixth defensive possession loses your target.
        </p>
      </div>
    </div>
    <p class="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
      <Shuffle size={13} aria-hidden="true" />
      Rerolls are shared across the draft. Protect one card to keep its player, salary, bucket and spot.
    </p>
  </details>

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
