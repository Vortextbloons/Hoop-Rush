<script lang="ts">
  import type { HavocDraftState } from '@hoop-rush/data-contracts';
  import { HAVOC_REROLL_LIMIT } from '@hoop-rush/data-contracts';
  import HavocDraftCard from './HavocDraftCard.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';
  import { lineupSlotsFromPicks } from './havoc-presentation';

  let {
    draft,
    busy,
    error,
    franchiseName,
    onReroll,
    onPick,
    onLock,
  }: {
    draft: HavocDraftState;
    busy: boolean;
    error: string | null;
    franchiseName?: (franchiseId: string) => string;
    onReroll: () => void;
    onPick: (cardId: string) => void;
    onLock: () => void;
  } = $props();

  let mode = $state<'effective' | 'original'>('effective');
  const pickNumber = $derived(draft.picks.length + 1);
  const remainingRerolls = $derived(HAVOC_REROLL_LIMIT - (draft.rerollUsed ? 1 : 0));
  const complete = $derived(draft.status === 'complete');
  const slots = $derived(lineupSlotsFromPicks(draft.picks));
</script>

<div class="flex min-w-0 flex-col gap-4" data-havoc-draft-board>
  <section aria-labelledby="havoc-draft-heading" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          Hoop Havoc · Draft night
        </p>
        <h1
          id="havoc-draft-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Round {draft.round} of 5 · {draft.slot}
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {#if complete}
            Five picked. Lock the lineup to start the 82-game run.
          {:else}
            Pick {pickNumber} of 5 — fill the {draft.slot} slot.
          {/if}
        </p>
      </div>
      <ol class="flex items-center gap-1" aria-label="Draft progress">
        {#each [1, 2, 3, 4, 5] as slotNumber (slotNumber)}
          <li
            aria-current={slotNumber === pickNumber && !complete ? 'step' : undefined}
            class="grid h-7 w-7 place-items-center rounded-full font-mono text-[11px] font-bold {slotNumber <=
            draft.picks.length
              ? 'bg-primary text-primary-foreground'
              : slotNumber === pickNumber && !complete
                ? 'border border-primary text-primary'
                : 'bg-surface-3 text-muted-foreground'}"
          >
            {slotNumber}
          </li>
        {/each}
      </ol>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div
        class="inline-flex rounded-lg border border-border p-0.5"
        role="group"
        aria-label="Attribute view"
      >
        <button
          type="button"
          aria-pressed={mode === 'effective'}
          onclick={() => (mode = 'effective')}
          class="min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring {mode ===
          'effective'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground'}"
        >
          Effective
        </button>
        <button
          type="button"
          aria-pressed={mode === 'original'}
          onclick={() => (mode = 'original')}
          class="min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring {mode ===
          'original'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground'}"
        >
          Original
        </button>
      </div>
      {#if !complete}
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-havoc-reroll
            onclick={onReroll}
            disabled={busy || draft.rerollUsed}
            class="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-xs font-semibold outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reroll offer
          </button>
          <span class="font-mono text-[11px] text-muted-foreground" data-havoc-rerolls-remaining>
            {remainingRerolls} of {HAVOC_REROLL_LIMIT} reroll{remainingRerolls === 1 ? '' : 's'} left
          </span>
        </div>
      {/if}
    </div>

    <p class="mt-3 text-xs text-muted-foreground">
      Tiers are rarity bands, not strength promises — a Tier 3 card is not guaranteed to be stronger
      than a Tier 1 card. Every package changes the simulation in its own way.
    </p>
  </section>

  {#if !complete}
    <section aria-label="Current offer" class="min-w-0">
      <ul class="grid auto-rows-fr gap-3 lg:grid-cols-3">
        {#each draft.cards as card (card.cardId)}
          <li class="flex h-full min-w-0">
            <HavocDraftCard {card} {mode} {busy} {franchiseName} {onPick} />
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if draft.picks.length > 0}
    <HavocLineupLock {slots} />
  {/if}

  {#if complete}
    <div class="rounded-xl bg-surface-1 p-4 sm:p-5">
      <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">Lock the lineup</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        No trades, upgrades, or bench management. Once locked, the five start all 82 games together.
      </p>
      <button
        type="button"
        data-havoc-lock
        onclick={onLock}
        disabled={busy}
        class="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
      >
        {busy ? 'Locking…' : 'Lock lineup and start run'}
      </button>
    </div>
  {/if}

  {#if error !== null}
    <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
      {error}
    </p>
  {/if}
</div>
