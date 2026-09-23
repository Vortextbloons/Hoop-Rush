<script lang="ts">
  import type { CollectionRarity, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import type { CollectionCardView } from './collection-card-view.ts';

  let {
    view,
    manifest,
    displayName,
    rarity,
    kept,
    conversionAmount,
    compact = false,
  }: {
    view: CollectionCardView | null;
    manifest: HoopRushManifest | null;
    displayName: string;
    rarity: CollectionRarity;
    kept: boolean;
    conversionAmount: number;
    compact?: boolean;
  } = $props();

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
</script>

<article
  class="ur-reveal-card ur-reveal-card--{rarity.toLowerCase()}"
  class:ur-reveal-card-compact={compact}
>
  <div class="ur-reveal-face" aria-hidden="true">
    {#if view && manifest}
      <PlayerFace
        player={{
          playerId: view.playerId,
          playerExternalId: view.playerExternalId,
          altIds: null,
        }}
        {manifest}
        size={compact ? 'sm' : 'xl'}
        fallbackInitials={initialsOf(displayName)}
      />
    {:else}
      <span class="ur-reveal-initials">{initialsOf(displayName)}</span>
    {/if}
  </div>
  <div class="ur-reveal-copy">
    <span class="ur-reveal-rarity">{rarity}</span>
    <h3>{displayName}</h3>
    {#if view}
      <p class="ur-reveal-team">{view.franchiseId} · {view.season}</p>
      <p class="ur-reveal-positions">{formatPositions(view.positions)}</p>
      <div class="ur-reveal-ratings">
        <strong><small>OVR</small>{view.overall}</strong>
        {#if view.offense !== null && view.defense !== null}
          <span><small>OFF</small>{view.offense}</span>
          <span><small>DEF</small>{view.defense}</span>
        {/if}
      </div>
    {/if}
    <p class="ur-reveal-ownership">
      {#if kept}
        New card
      {:else}
        Duplicate · +{conversionAmount} Exchange
      {/if}
    </p>
  </div>
</article>

<style>
  .ur-reveal-card {
    --ur-reveal-rarity: var(--ur-ember);
    display: grid;
    width: min(100%, 23rem);
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
    border: 2px solid var(--ur-reveal-rarity);
    background: #11191d;
    color: var(--ur-paper);
    clip-path: polygon(0 0, 91% 0, 100% 5%, 100% 100%, 0 100%);
  }

  .ur-reveal-card--ember {
    --ur-reveal-rarity: #c65a2e;
  }

  .ur-reveal-card--eruption {
    --ur-reveal-rarity: #ff5a2a;
    border-top-width: 5px;
  }

  .ur-reveal-card--apex {
    --ur-reveal-rarity: #ffc53d;
    box-shadow: inset 0 0 0 4px rgb(255 197 61 / 18%);
  }

  .ur-reveal-card--titan {
    --ur-reveal-rarity: #a9b4d8;
    border-left-width: 6px;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 16px,
      rgb(169 180 216 / 5%) 17px 18px
    );
  }

  .ur-reveal-card--eclipse {
    --ur-reveal-rarity: #a588ff;
    box-shadow:
      inset 0 0 0 5px #211931,
      inset 0 0 0 6px rgb(165 136 255 / 60%);
  }

  .ur-reveal-card--immortal {
    --ur-reveal-rarity: #ffe9b0;
    border: 4px double var(--ur-reveal-rarity);
    background-image: linear-gradient(115deg, rgb(255 233 176 / 9%), transparent 48%);
  }

  .ur-reveal-face {
    display: grid;
    min-height: 9rem;
    place-items: center;
    padding: 1.25rem 1rem 0.5rem;
    background:
      linear-gradient(180deg, transparent 52%, rgb(8 11 14 / 82%)),
      repeating-linear-gradient(90deg, transparent 0 42px, rgb(240 236 223 / 3%) 43px), #202c31;
  }

  .ur-reveal-initials {
    color: var(--ur-reveal-rarity);
    font-family: var(--font-display);
    font-size: clamp(3rem, 10vw, 5rem);
    font-weight: 800;
  }

  .ur-reveal-copy {
    padding: 0.9rem 1rem 1rem;
  }

  .ur-reveal-rarity {
    color: var(--ur-reveal-rarity);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .ur-reveal-copy h3 {
    margin-top: 0.2rem;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.65rem;
    font-weight: 800;
    line-height: 1;
  }

  .ur-reveal-team,
  .ur-reveal-positions {
    color: var(--ur-muted);
    font-size: 0.76rem;
  }

  .ur-reveal-team {
    margin-top: 0.25rem;
  }

  .ur-reveal-positions {
    margin-top: 0.12rem;
    color: var(--ur-paper);
  }

  .ur-reveal-ratings {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    margin-top: 0.5rem;
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
  }

  .ur-reveal-ratings strong {
    color: var(--ur-reveal-rarity);
    font-family: var(--font-display);
    font-size: 1.6rem;
  }

  .ur-reveal-ratings small {
    margin-right: 0.2rem;
    color: var(--ur-muted);
    font-family: var(--font-sans);
    font-size: 0.58rem;
  }

  .ur-reveal-ownership {
    margin-top: 0.65rem;
    color: var(--ur-paper);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .ur-reveal-card-compact {
    width: 100%;
    min-height: 5.5rem;
    grid-template-columns: 4.25rem minmax(0, 1fr);
    grid-template-rows: auto;
    align-items: stretch;
    clip-path: polygon(0 0, 96% 0, 100% 9%, 100% 100%, 0 100%);
  }

  .ur-reveal-card-compact .ur-reveal-face {
    min-height: 0;
    padding: 0.4rem;
    border-right: 1px solid var(--ur-reveal-rarity);
  }

  .ur-reveal-card-compact .ur-reveal-initials {
    font-size: 1.6rem;
  }

  .ur-reveal-card-compact .ur-reveal-copy {
    min-width: 0;
    padding: 0.45rem 0.6rem;
  }

  .ur-reveal-card-compact .ur-reveal-copy h3 {
    overflow: hidden;
    font-size: 1.15rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-reveal-card-compact .ur-reveal-team {
    overflow: hidden;
    margin-top: 0.1rem;
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-reveal-card-compact .ur-reveal-positions,
  .ur-reveal-card-compact .ur-reveal-ratings {
    display: none;
  }

  .ur-reveal-card-compact .ur-reveal-rarity {
    font-size: 0.59rem;
  }

  .ur-reveal-card-compact .ur-reveal-ownership {
    overflow: hidden;
    margin-top: 0.15rem;
    font-size: 0.67rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
