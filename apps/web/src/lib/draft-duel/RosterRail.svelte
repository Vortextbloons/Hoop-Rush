<script lang="ts">
  import type { DraftDuelPresentation, DraftDuelRoster } from '@hoop-rush/data-contracts';
  import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
  import { SLOT_NAMES } from '$lib/player-positions';
  import { draftDuelCardView } from './draft-duel-card-view.ts';

  let {
    roster,
    presentation,
    active = false,
    compact = false,
  }: {
    roster: DraftDuelRoster;
    presentation: DraftDuelPresentation;
    active?: boolean;
    compact?: boolean;
  } = $props();

  const slots = $derived(
    LINEUP_STRUCTURE.map((position, slotIndex) => {
      const filled = roster.slots.find((slot) => slot.slotIndex === slotIndex);
      return {
        position,
        name: SLOT_NAMES[slotIndex] ?? position,
        view: filled ? draftDuelCardView(filled.card, presentation) : null,
      };
    }),
  );
  const filledCount = $derived(
    roster.slots.filter((slot) => slot.slotIndex >= 0 && slot.slotIndex < LINEUP_STRUCTURE.length)
      .length,
  );
</script>

<section
  class="dd-rail"
  class:dd-rail-active={active}
  class:dd-rail-compact={compact}
  data-filled={filledCount}
  aria-label="Draft lineup"
>
  <header class="dd-rail-head">
    <h3 class="dd-rail-title">Lineup</h3>
    <span class="dd-rail-count">{filledCount}/5</span>
  </header>
  <ol class="dd-rail-slots">
    {#each slots as slot (slot.position)}
      <li class="dd-rail-slot" data-slot={slot.position} data-filled={slot.view !== null}>
        <span class="dd-rail-chip" aria-hidden="true">{slot.position}</span>
        {#if slot.view}
          <span class="dd-rail-player">
            <span class="dd-rail-name">{slot.view.displayName}</span>
            <span class="dd-rail-meta">{slot.view.seasonKey} · {slot.name}</span>
          </span>
        {:else}
          <span class="dd-rail-empty">
            <span class="dd-rail-need">Open</span>
            <span class="dd-rail-requirement">{slot.name}</span>
          </span>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .dd-rail {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    background: var(--color-card);
  }

  .dd-rail-active {
    border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-line-soft));
  }

  .dd-rail-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .dd-rail-title {
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  .dd-rail-count {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
  }

  .dd-rail-slots {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .dd-rail-slot {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 9px;
    background: var(--color-surface-2);
  }

  .dd-rail-slot[data-filled='false'] {
    border-style: dashed;
    border-color: var(--color-line-soft);
    background: transparent;
  }

  .dd-rail-chip {
    display: grid;
    width: 1.9rem;
    height: 1.9rem;
    flex: none;
    place-items: center;
    border-radius: 7px;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  .dd-rail-slot[data-filled='true'] .dd-rail-chip {
    background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface-3));
    color: var(--color-foreground);
  }

  .dd-rail-player {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.1rem;
  }

  .dd-rail-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 0.98rem;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dd-rail-meta {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  .dd-rail-empty {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.4rem;
  }

  .dd-rail-need {
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .dd-rail-requirement {
    overflow: hidden;
    color: var(--color-muted-foreground);
    font-size: 0.85rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dd-rail-compact {
    gap: 0.35rem;
    padding: 0.5rem;
  }

  .dd-rail-compact .dd-rail-slot {
    padding: 0.3rem 0.4rem;
  }

  .dd-rail-compact .dd-rail-name {
    font-size: 0.88rem;
  }

  .dd-rail-compact .dd-rail-chip {
    width: 1.6rem;
    height: 1.6rem;
  }
</style>
