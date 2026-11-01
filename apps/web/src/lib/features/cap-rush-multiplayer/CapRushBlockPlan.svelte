<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS } from '@hoop-rush/data-contracts';
  import { seatLabelFor, seatOrder } from './cap-rush-multiplayer-presentation.js';

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
  const otherSeat = $derived(localSeat === 'p1' ? ('p2' as const) : ('p1' as const));
  const otherPlan = $derived(block?.plans[otherSeat] ?? null);
  const orderedSeats = $derived(seatOrder(localSeat));
  const startSlot = $derived(
    block === null
      ? 0
      : block.index === 0
        ? 1
        : (CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS[block.index - 1] ?? 0) + 1,
  );

  function planLabel(plan: 'sim' | 'simcast' | null): string {
    if (plan === null) return 'Choosing…';
    return plan === 'sim' ? 'Sim' : 'Simcast';
  }

  function planDetail(plan: 'sim' | 'simcast' | null): string {
    if (plan === null) return 'No choice yet';
    return plan === 'sim' ? 'Results resolve instantly' : 'Own games play at 4×';
  }
</script>

{#if block === null || season === null}
  <p class="text-sm text-muted-foreground">The season has not started.</p>
{:else}
  <section
    class="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4"
    data-cap-rush-block-plan
  >
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <div class="min-w-0">
        <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          Block {block.index + 1} of {CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS.length}
        </p>
        <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
          Games {startSlot}–{block.endpoint}
        </h2>
      </div>
      <p class="text-xs text-muted-foreground">
        {block.status === 'choosing'
          ? 'Both seats must choose before the block runs.'
          : block.status === 'running'
            ? 'Block in progress.'
            : 'Block complete.'}
      </p>
    </header>

    <ul class="grid min-w-0 gap-2 sm:grid-cols-2">
      {#each orderedSeats as seat (seat)}
        {@const plan = block.plans[seat]}
        <li
          class="min-w-0 rounded-xl border bg-surface-2 p-3 {seat === localSeat
            ? 'border-primary/40'
            : 'border-border'}"
          data-seat={seat}
        >
          <div class="flex items-baseline justify-between gap-2">
            <p
              class="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
            >
              {seatLabelFor(seat, localSeat)}
            </p>
            <p class="shrink-0 text-right font-mono text-[10px] text-muted-foreground">
              {planDetail(plan)}
            </p>
          </div>
          <p class="mt-1 truncate font-display text-lg font-bold tracking-tight uppercase">
            {planLabel(plan)}
          </p>
        </li>
      {/each}
    </ul>

    {#if block.status === 'choosing' && localPlan === null}
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none
            focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          disabled={busy}
          onclick={() => onchoose('sim')}
        >
          Sim to game {block.endpoint}
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold outline-none
            focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          disabled={busy}
          onclick={() => onchoose('simcast')}
        >
          Simcast this block
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        Both seats choose before the host can simulate game {startSlot}.
      </p>
    {:else if block.status === 'choosing'}
      {#if otherPlan === null}
        <p class="text-xs text-muted-foreground">
          You chose {planLabel(localPlan)}. Waiting for {seatLabelFor(otherSeat, localSeat)} to choose.
        </p>
      {:else}
        <p class="text-xs text-muted-foreground">
          Both seats have chosen. The block starts with game {startSlot}.
        </p>
      {/if}
    {:else if block.status === 'running' && localPlan === 'simcast'}
      <p class="text-xs text-muted-foreground">
        You watch your own games at 4× and accept each one after the broadcast.
      </p>
    {:else if block.status === 'running'}
      <p class="text-xs text-muted-foreground">
        The host simulates league slots. Both seats accept every result.
      </p>
    {/if}
  </section>
{/if}
