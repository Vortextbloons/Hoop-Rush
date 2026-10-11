<script lang="ts">
  import { resolve } from '$app/paths';
  import type { HavocDraftController } from '$lib/havoc/havoc-draft-state.svelte';
  import HavocDraftBoard from './HavocDraftBoard.svelte';
  import { havocObjectiveStatusOf, havocRecordLabel } from './havoc-presentation';

  let {
    controller,
    franchiseName,
    onLocked,
  }: {
    controller: HavocDraftController;
    franchiseName?: (franchiseId: string) => string;
    onLocked: () => void;
  } = $props();

  const run = $derived(controller.run);
  const draft = $derived(controller.draft);
  const objective = $derived(run === null ? null : havocObjectiveStatusOf(run));

  async function lock(): Promise<void> {
    const accepted = await controller.lockLineup();
    if (accepted) onLocked();
  }
</script>

<section class="mx-auto w-full max-w-5xl px-3 py-6 sm:px-6 sm:py-10" data-havoc-setup>
  {#if controller.loading}
    <p class="font-mono text-sm text-muted-foreground" aria-live="polite">
      Loading your Havoc save…
    </p>
  {:else if controller.error !== null && run === null && draft === null}
    <div
      role="alert"
      class="mx-auto w-full max-w-xl rounded-xl border border-destructive/40 bg-destructive/10 p-6"
    >
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Havoc save unavailable
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">{controller.error}</p>
      <button
        type="button"
        onclick={() => void controller.load()}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try again
      </button>
    </div>
  {:else if run !== null && run.phase === 'run'}
    <div class="mx-auto w-full max-w-2xl rounded-xl bg-surface-1 p-6">
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        Hoop Havoc · Run in progress
      </p>
      <h1 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
        Back to your run
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Record {havocRecordLabel(run.havocWins, run.havocLosses)} · game {run.havocCursor} of 82 played.
      </p>
      {#if objective !== null}
        <p class="mt-1 text-sm font-semibold">{objective.label} — {objective.detail}</p>
      {/if}
      <div class="mt-4 flex flex-wrap gap-2">
        <a
          href={resolve('/havoc/run')}
          class="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Resume run
        </a>
        <a
          href={resolve('/havoc/history')}
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Hall of Freaks
        </a>
      </div>
    </div>
  {:else if draft !== null}
    <HavocDraftBoard
      {draft}
      busy={controller.busy}
      error={controller.error}
      {franchiseName}
      onReroll={() => void controller.reroll()}
      onPick={(cardId) => void controller.pick(cardId)}
      onLock={() => void lock()}
    />
  {:else}
    <div class="mx-auto w-full max-w-3xl">
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        Mode 05 · Hoop Havoc
      </p>
      <h1 class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
        Draft freaks. Survive 82.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Draft five mutated player-seasons — one per position, PG through C — then play all 82 games
        against the frozen NBA opponents. The objective is <strong>82-0</strong>. There is no bench
        editor and no trades: the five you lock are the five you ride.
      </p>
      <ul class="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
        <li class="flex gap-2">
          <span aria-hidden="true" class="text-primary">•</span>
          Each card carries a mutation package that changes real simulation behavior: ratings, tendencies,
          dimensions, and event rules.
        </li>
        <li class="flex gap-2">
          <span aria-hidden="true" class="text-primary">•</span>
          One whole-offer reroll for the entire draft. Reloading never changes an offer.
        </li>
        <li class="flex gap-2">
          <span aria-hidden="true" class="text-primary">•</span>
          No guarantees: overpowered and disastrous combinations are both legitimate. Mutations change
          the math, they do not promise more wins.
        </li>
        <li class="flex gap-2">
          <span aria-hidden="true" class="text-primary">•</span>
          After all 82 games, a matched normal season with the same schedule and seeds reveals how the
          mutations actually changed the year.
        </li>
      </ul>
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-havoc-start
          onclick={() => void controller.createDraft()}
          disabled={controller.busy}
          class="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          {controller.busy ? 'Starting…' : 'Start draft'}
        </button>
        <a
          href={resolve('/havoc/history')}
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Hall of Freaks
        </a>
      </div>
      {#if controller.error !== null}
        <p
          role="alert"
          class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
        >
          {controller.error}
        </p>
      {/if}
    </div>
  {/if}
</section>
