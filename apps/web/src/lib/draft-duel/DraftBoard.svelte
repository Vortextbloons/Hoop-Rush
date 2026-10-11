<script lang="ts">
  import type {
    DraftDuelOfferedPick,
    DraftDuelPresentation,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { DRAFT_DUEL_PICK_ANIMATION_MS } from '@hoop-rush/data-contracts';
  import DraftCard from './DraftCard.svelte';

  let {
    offers,
    active,
    round,
    presentation,
    manifest = null,
    selectedSlot = null,
    disabled = false,
    onchoose,
    onconsider,
  }: {
    offers: DraftDuelOfferedPick[];
    active: boolean;
    round: number;
    presentation: DraftDuelPresentation;
    manifest?: HoopRushManifest | null;
    selectedSlot?: number | null;
    disabled?: boolean;
    onchoose?: (pick: DraftDuelOfferedPick) => void;
    onconsider?: (pick: DraftDuelOfferedPick | null) => void;
  } = $props();

  let consideringSlot = $state<number | null>(null);
  const canPick = $derived(active && !disabled);
  const boardState = $derived(disabled ? 'disabled' : active ? 'active' : 'waiting');

  function slotState(
    pick: DraftDuelOfferedPick,
  ): 'picked' | 'considering' | 'unavailable' | 'idle' {
    if (selectedSlot !== null && pick.slot === selectedSlot) return 'picked';
    if (consideringSlot === pick.slot) return 'considering';
    if (!canPick || !pick.available) return 'unavailable';
    return 'idle';
  }

  function pickCard(pick: DraftDuelOfferedPick): void {
    if (!canPick || !pick.available) return;
    onchoose?.(pick);
  }

  function considerCard(pick: DraftDuelOfferedPick | null): void {
    consideringSlot = pick?.slot ?? null;
    onconsider?.(pick);
  }
</script>

<section
  class="dd-board"
  data-state={boardState}
  data-active={active}
  data-round={round}
  data-pick-animation-ms={DRAFT_DUEL_PICK_ANIMATION_MS}
  style:--dd-pick-ms="{DRAFT_DUEL_PICK_ANIMATION_MS}ms"
  aria-label={`Round ${round} offers`}
>
  <header class="dd-board-head">
    <div class="dd-board-heading">
      <p class="dd-board-round" data-round-label>Round {round} of 5</p>
      <p class="dd-board-turn" data-turn-label>
        {disabled ? 'Picks locked' : active ? 'Your pick' : 'Opponent picking'}
      </p>
    </div>
    <span class="dd-board-dots" aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as dot (dot)}
        <span class:done={dot < round - 1} class:current={dot === round - 1}></span>
      {/each}
    </span>
  </header>
  <div class="dd-board-grid">
    {#each offers as pick (pick.slot)}
      <div
        class="dd-board-slot draft-card-enter"
        style:--draft-index={pick.slot}
        data-slot={pick.slot}
        data-state={slotState(pick)}
      >
        <DraftCard
          card={pick.card}
          {presentation}
          {manifest}
          disabled={!canPick || !pick.available}
          reason={pick.reason ?? (!active ? 'turn' : null)}
          selected={selectedSlot === pick.slot}
          considering={consideringSlot === pick.slot}
          onselect={() => pickCard(pick)}
          onconsider={(card) => considerCard(card === null ? null : pick)}
        />
      </div>
    {/each}
  </div>
</section>

<style>
  .dd-board {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.85rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    background: var(--color-surface-1);
  }

  .dd-board[data-state='active'] {
    box-shadow: inset 3px 0 0 0 var(--color-primary);
  }

  .dd-board[data-state='waiting'] {
    box-shadow: inset 3px 0 0 0 var(--color-line-strong);
  }

  .dd-board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .dd-board-heading {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
  }

  .dd-board-round {
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.05;
  }

  .dd-board-turn {
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .dd-board[data-state='active'] .dd-board-turn {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  .dd-board[data-state='waiting'] .dd-board-turn,
  .dd-board[data-state='disabled'] .dd-board-turn {
    border: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
  }

  .dd-board-dots {
    display: flex;
    flex: none;
    gap: 0.35rem;
  }

  .dd-board-dots span {
    width: 0.5rem;
    height: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
  }

  .dd-board-dots .done {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }

  .dd-board-dots .current {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }

  .dd-board-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .dd-board-slot {
    min-width: 0;
  }

  .dd-board-slot[data-state='picked'] {
    animation: dd-picked var(--dd-pick-ms, 1000ms) cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .dd-board-slot[data-state='considering'] {
    border-radius: 14px;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  @keyframes dd-picked {
    0% {
      transform: scale(1);
    }
    35% {
      transform: scale(1.03);
      filter: brightness(1.12);
    }
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
  }

  @media (min-width: 768px) {
    .dd-board-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dd-board-slot,
    .dd-board-slot[data-state='picked'] {
      animation: none;
    }
  }
</style>
