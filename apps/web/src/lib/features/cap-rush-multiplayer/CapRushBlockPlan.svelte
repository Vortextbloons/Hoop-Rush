<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { seatLabelFor } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    busy = false,
    onchoose,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    busy?: boolean;
    onchoose: (choice: 'sim' | 'simcast') => void;
  } = $props();

  const season = $derived(state.season);
  const block = $derived(season?.block ?? null);
  const localPlan = $derived(block?.plans[localSeat] ?? null);
</script>

{#if block === null}
  <p class="text-sm text-muted-foreground">The season has not started.</p>
{:else}
  <section class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Block {block.index + 1} of 4
        </p>
        <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
          Sim to {block.endpoint} games
        </h2>
      </div>
      <p class="text-xs text-muted-foreground">Both seats must choose before the block starts.</p>
    </header>

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-xl border border-border bg-surface-2 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {seatLabelFor('p1', localSeat)}
        </p>
        <p class="mt-1 text-sm font-semibold">
          {block.plans.p1 === null ? 'Choosing…' : block.plans.p1 === 'sim' ? 'Sim' : 'Simcast'}
        </p>
      </div>
      <div class="rounded-xl border border-border bg-surface-2 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {seatLabelFor('p2', localSeat)}
        </p>
        <p class="mt-1 text-sm font-semibold">
          {block.plans.p2 === null ? 'Choosing…' : block.plans.p2 === 'sim' ? 'Sim' : 'Simcast'}
        </p>
      </div>
    </div>

    {#if block.status === 'choosing' && localPlan === null}
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary
            disabled:opacity-40"
          disabled={busy}
          onclick={() => onchoose('sim')}
        >
          Sim to {block.endpoint}
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
            disabled:opacity-40"
          disabled={busy}
          onclick={() => onchoose('simcast')}
        >
          Watch Simcast
        </button>
      </div>
    {:else if block.status === 'choosing'}
      <p class="text-xs text-muted-foreground">Waiting for the other seat to choose.</p>
    {:else}
      <p class="text-xs text-muted-foreground">Block in progress.</p>
    {/if}
  </section>
{/if}
