<script lang="ts">
  import type {
    DraftDuelCard,
    DraftDuelPresentation,
    DraftDuelRoster,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { LINEUP_STRUCTURE, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { SLOT_NAMES } from '#lib/player-positions.js';
  import { draftDuelCardView } from './draft-duel-card-view.ts';

  let {
    roster,
    presentation,
    manifest = null,
    active = false,
    compact = false,
    onmove = null,
  }: {
    roster: DraftDuelRoster;
    presentation: DraftDuelPresentation;
    manifest?: HoopRushManifest | null;
    active?: boolean;
    compact?: boolean;
    onmove?: ((card: DraftDuelCard) => void) | null;
  } = $props();

  const slots = $derived(
    LINEUP_STRUCTURE.map((position, slotIndex) => {
      const filled = roster.slots.find((slot) => slot.slotIndex === slotIndex);
      return {
        position,
        name: SLOT_NAMES[slotIndex] ?? position,
        card: filled?.card ?? null,
        view: filled ? draftDuelCardView(filled.card, presentation) : null,
      };
    }),
  );
  const filledCount = $derived(
    roster.slots.filter((slot) => slot.slotIndex >= 0 && slot.slotIndex < LINEUP_STRUCTURE.length)
      .length,
  );

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function franchiseSlotOf(franchiseId: string) {
    return manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId) ?? null;
  }

  function logoCandidatesOf(franchiseId: string, eraId: string): string[] {
    return manifest
      ? (resolveEraTeamIdentity(manifest, franchiseId, eraId).logoCandidates ?? [])
      : [];
  }
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
      {@const filledCard = slot.card}
      <li class="dd-rail-slot" data-slot={slot.position} data-filled={slot.view !== null}>
        <span class="dd-rail-chip" aria-hidden="true">{slot.position}</span>
        {#if filledCard && slot.view}
          {#if onmove && active}
            <button
              type="button"
              class="dd-rail-player dd-rail-player--move"
              aria-label={`Move ${slot.view.displayName} to another position`}
              onclick={() => onmove(filledCard)}
            >
              {@render playerBody(
                filledCard,
                slot.name,
                slot.view.displayName,
                slot.view.seasonKey,
              )}
            </button>
          {:else}
            <span class="dd-rail-player">
              {@render playerBody(
                filledCard,
                slot.name,
                slot.view.displayName,
                slot.view.seasonKey,
              )}
            </span>
          {/if}
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

{#snippet playerBody(card: DraftDuelCard, slotName: string, displayName: string, seasonKey: string)}
  {#if manifest && card.playerExternalId}
    <PlayerFace
      player={{
        playerId: card.playerId,
        playerExternalId: card.playerExternalId,
        altIds: null,
      }}
      {manifest}
      size="sm"
      fallbackInitials={initialsOf(displayName)}
    />
  {/if}
  <span class="dd-rail-text">
    <span class="dd-rail-name">{displayName}</span>
    <span class="dd-rail-meta">{seasonKey} · {slotName}</span>
  </span>
  {#if manifest && franchiseSlotOf(card.franchiseId)}
    <TeamLogo
      {manifest}
      franchiseId={card.franchiseId}
      teamExternalId={franchiseSlotOf(card.franchiseId)?.teamExternalId ?? ''}
      logoCandidates={logoCandidatesOf(card.franchiseId, card.eraId)}
      className="h-4 w-4"
    />
  {/if}
{/snippet}

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
    flex: 1;
    align-items: center;
    gap: 0.5rem;
  }

  .dd-rail-player--move {
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    outline: none;
  }

  .dd-rail-player--move:hover {
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }

  .dd-rail-player--move:focus-visible {
    box-shadow: 0 0 0 2px var(--color-ring);
  }

  .dd-rail-text {
    display: flex;
    min-width: 0;
    flex: 1;
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

  @media (max-width: 640px) {
    .dd-rail {
      gap: 0.45rem;
      padding: 0.6rem;
      border-radius: 11px;
    }
    .dd-rail-title {
      font-size: 1.02rem;
    }
    .dd-rail-slots {
      gap: 0.32rem;
    }
    .dd-rail-slot {
      gap: 0.45rem;
      padding: 0.38rem 0.45rem;
      border-radius: 8px;
    }
    .dd-rail-chip {
      width: 1.65rem;
      height: 1.65rem;
      border-radius: 6px;
      font-size: 9px;
    }
    .dd-rail-name {
      font-size: 0.9rem;
    }
    .dd-rail-meta {
      font-size: 8px;
    }
    .dd-rail-requirement {
      font-size: 0.78rem;
    }
  }
</style>
