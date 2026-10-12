<script lang="ts">
  import type { CollectionRarity, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import CollectionCardFace from './CollectionCardFace.svelte';
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

  const rarityToken = $derived(rarity.toLowerCase());
</script>

<article class="ur-reveal-card ur-rarity-tone-{rarityToken}" class:ur-reveal-card-compact={compact}>
  <div class="ur-reveal-face" aria-hidden="true">
    <CollectionCardFace
      {view}
      {manifest}
      {rarity}
      size={compact ? 'sm' : 'xl'}
      {displayName}
      showOverall={view !== null}
    />
  </div>
  <div class="ur-reveal-copy">
    <span class="ur-reveal-rarity">{rarity}</span>
    <h3>{displayName}</h3>
    {#if view}
      <p class="ur-reveal-team">{view.franchiseId} · {view.season}</p>
      <p class="ur-reveal-positions">{formatPositions(view.positions)}</p>
      <div class="ur-reveal-ratings">
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
    display: grid;
    width: min(100%, 24rem);
    min-height: var(--ur-pack-card-height, 30rem);
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
    border: 2px solid var(--ur-rarity, var(--ur-ember));
    background: var(--ur-bg);
    color: var(--ur-paper);
    clip-path: polygon(0 0, 91% 0, 100% 5%, 100% 100%, 0 100%);
  }

  .ur-reveal-card.ur-rarity-tone-eruption {
    border-top-width: 5px;
  }

  .ur-reveal-card.ur-rarity-tone-apex {
    box-shadow: inset 0 0 0 4px
      color-mix(in srgb, var(--ur-rarity, var(--ur-ember)) 18%, transparent);
  }

  .ur-reveal-card.ur-rarity-tone-titan {
    border-left-width: 6px;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 16px,
      color-mix(in srgb, var(--ur-rarity, var(--ur-ember)) 8%, transparent) 17px 18px
    );
  }

  .ur-reveal-card.ur-rarity-tone-eclipse {
    box-shadow:
      inset 0 0 0 5px #211931,
      inset 0 0 0 6px color-mix(in srgb, var(--ur-rarity, var(--ur-ember)) 60%, transparent);
  }

  .ur-reveal-card.ur-rarity-tone-immortal {
    border: 4px double var(--ur-rarity, var(--ur-ember));
    background-image: linear-gradient(115deg, rgb(255 233 176 / 9%), transparent 48%);
  }

  .ur-reveal-face {
    position: relative;
    display: grid;
    min-height: var(--ur-pack-face-height, 16rem);
    place-items: stretch;
    overflow: hidden;
    padding: 0;
    background:
      linear-gradient(180deg, transparent 38%, rgb(8 11 14 / 76%)),
      radial-gradient(
        ellipse at 50% 18%,
        color-mix(in srgb, var(--ur-rarity, var(--ur-ember)) 32%, transparent),
        transparent 62%
      ),
      repeating-linear-gradient(90deg, transparent 0 42px, rgb(240 236 223 / 3%) 43px),
      linear-gradient(160deg, #29383e, #11191d 78%);
  }

  .ur-reveal-face :global(.relative) {
    width: 100%;
    height: 100%;
    min-height: inherit;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .ur-reveal-face :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 12%;
    transform: scale(1.12);
  }

  .ur-reveal-face :global(.ur-special-art) {
    position: absolute;
    inset: 0;
    object-position: center;
    transform: none;
  }

  .ur-reveal-face :global(.ur-card-face-initials) {
    color: var(--ur-rarity, var(--ur-ember));
    font-family: var(--font-display);
    font-size: clamp(3rem, 10vw, 5rem);
    font-weight: 800;
  }

  .ur-reveal-copy {
    padding: 0.9rem 1rem 1rem;
  }

  .ur-reveal-rarity {
    color: var(--ur-rarity, var(--ur-ember));
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
    --ur-face-overall-inset: 0.3rem;
    --ur-face-overall-min-width: 1.8rem;
    --ur-face-overall-padding: 0.12rem 0.2rem;
    --ur-face-overall-size: 1.1rem;
    --ur-face-overall-small-size: 0.42rem;
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
    border-right: 1px solid var(--ur-rarity, var(--ur-ember));
  }

  .ur-reveal-card-compact .ur-reveal-face :global(.relative) {
    min-height: 0;
  }

  .ur-reveal-card-compact .ur-reveal-face :global(.ur-card-face-initials) {
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
