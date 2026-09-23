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
    {#if view}
      <span class="ur-reveal-overall" aria-hidden="true">
        <small>OVR</small><strong>{view.overall}</strong>
      </span>
    {/if}
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
    --ur-reveal-rarity: var(--ur-ember);
    display: grid;
    width: min(100%, 24rem);
    min-height: 30rem;
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
    border: 2px solid var(--ur-reveal-rarity);
    background: var(--ur-bg);
    color: var(--ur-paper);
    clip-path: polygon(0 0, 91% 0, 100% 5%, 100% 100%, 0 100%);
  }

  .ur-reveal-card--ember {
    --ur-reveal-rarity: var(--ur-ember);
  }

  .ur-reveal-card--eruption {
    --ur-reveal-rarity: var(--ur-eruption);
    border-top-width: 5px;
  }

  .ur-reveal-card--apex {
    --ur-reveal-rarity: var(--ur-apex);
    box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--ur-reveal-rarity) 18%, transparent);
  }

  .ur-reveal-card--titan {
    --ur-reveal-rarity: var(--ur-titan);
    border-left-width: 6px;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 16px,
      color-mix(in srgb, var(--ur-reveal-rarity) 8%, transparent) 17px 18px
    );
  }

  .ur-reveal-card--eclipse {
    --ur-reveal-rarity: var(--ur-eclipse);
    box-shadow:
      inset 0 0 0 5px #211931,
      inset 0 0 0 6px color-mix(in srgb, var(--ur-reveal-rarity) 60%, transparent);
  }

  .ur-reveal-card--immortal {
    --ur-reveal-rarity: var(--ur-immortal);
    border: 4px double var(--ur-reveal-rarity);
    background-image: linear-gradient(115deg, rgb(255 233 176 / 9%), transparent 48%);
  }

  .ur-reveal-face {
    position: relative;
    display: grid;
    min-height: 16rem;
    place-items: stretch;
    overflow: hidden;
    padding: 0;
    background:
      linear-gradient(180deg, transparent 38%, rgb(8 11 14 / 76%)),
      radial-gradient(
        ellipse at 50% 18%,
        color-mix(in srgb, var(--ur-reveal-rarity) 32%, transparent),
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

  .ur-reveal-overall {
    position: absolute;
    z-index: 2;
    top: 0.7rem;
    left: 0.7rem;
    display: grid;
    min-width: 3.25rem;
    justify-items: center;
    padding: 0.28rem 0.4rem 0.35rem;
    border: 1px solid color-mix(in srgb, var(--ur-reveal-rarity) 74%, var(--ur-paper));
    background: color-mix(in srgb, var(--ur-bg) 82%, transparent);
    color: var(--ur-reveal-rarity);
    line-height: 0.95;
    backdrop-filter: blur(5px);
  }

  .ur-reveal-overall small {
    font-size: 0.62rem;
    font-weight: 800;
  }

  .ur-reveal-overall strong {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
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

  .ur-reveal-card-compact .ur-reveal-face :global(.relative) {
    min-height: 0;
  }

  .ur-reveal-card-compact .ur-reveal-overall {
    top: 0.3rem;
    left: 0.3rem;
    min-width: 1.8rem;
    padding: 0.12rem 0.2rem;
  }

  .ur-reveal-card-compact .ur-reveal-overall small {
    font-size: 0.42rem;
  }

  .ur-reveal-card-compact .ur-reveal-overall strong {
    font-size: 1.1rem;
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
