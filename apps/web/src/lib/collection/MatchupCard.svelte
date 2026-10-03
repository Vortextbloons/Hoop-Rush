<script lang="ts">
  import type { CollectionCatalogCard } from '@hoop-rush/data-contracts';
  import { Layers, Flame, Trophy, Shield, Sparkles, Crown, UserRound } from '@lucide/svelte';

  let {
    card,
    compact = false,
    detail = '',
  }: {
    card: CollectionCatalogCard;
    compact?: boolean;
    detail?: string;
  } = $props();

  const Emblem = $derived(
    card.rarity === 'Immortal'
      ? Crown
      : card.rarity === 'Eclipse'
        ? Sparkles
        : card.rarity === 'Titan'
          ? Shield
          : card.rarity === 'Apex'
            ? Trophy
            : Flame,
  );
</script>

<article
  class="match-card"
  class:compact
  data-rarity={card.rarity.toLowerCase()}
  aria-label={`${card.displayName}, ${card.rarity}, ${card.positions.join('/')}`}
>
  <div class="card-corner">
    <strong>{card.summarySource?.overallRating ?? '—'}</strong>
    <span>{card.positions[0] ?? '—'}</span>
  </div>
  <div class="card-art" aria-hidden="true">
    <Layers class="card-outline" size={compact ? 26 : 54} strokeWidth={1} />
    <UserRound class="card-player" size={compact ? 28 : 76} strokeWidth={1.2} />
  </div>
  <div class="card-identity">
    <span class="card-rarity"><Emblem size={12} /> {card.rarity}</span>
    <h4>{card.displayName}</h4>
    <p>{detail || card.positions.join(' / ')}</p>
  </div>
</article>

<style>
  .match-card {
    --foil: #df9d76;
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--foil) 65%, #263744);
    border-radius: 0.65rem;
    background: linear-gradient(145deg, color-mix(in srgb, var(--foil) 18%, #17232d), #0b151e 70%);
    box-shadow:
      inset 0 0 0 3px #0b151e,
      inset 0 0 0 4px color-mix(in srgb, var(--foil) 25%, transparent),
      0 8px 18px #0003;
  }
  [data-rarity='eruption'] {
    --foil: #ff865b;
  }
  [data-rarity='apex'] {
    --foil: #ffcf59;
  }
  [data-rarity='titan'] {
    --foil: #a9c4e8;
  }
  [data-rarity='eclipse'] {
    --foil: #bea5ff;
  }
  [data-rarity='immortal'] {
    --foil: #ffe9b0;
  }
  .card-corner {
    position: absolute;
    top: 0.6rem;
    left: 0.65rem;
    display: grid;
    z-index: 1;
    color: var(--foil);
  }
  .card-corner strong {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1;
  }
  .card-corner span {
    font-size: 0.65rem;
    font-weight: 800;
  }
  .card-art {
    position: relative;
    display: grid;
    height: 7rem;
    place-items: end center;
    margin: 0.35rem;
    border-bottom: 1px solid color-mix(in srgb, var(--foil) 30%, transparent);
    background: repeating-linear-gradient(125deg, transparent 0 17px, #ffffff04 18px 19px);
  }
  .card-art :global(.card-outline) {
    position: absolute;
    right: 0.35rem;
    top: 0.5rem;
    color: var(--foil);
    opacity: 0.2;
    transform: rotate(12deg);
  }
  .card-art :global(.card-player) {
    color: var(--foil);
    opacity: 0.65;
  }
  .card-identity {
    padding: 0.55rem 0.65rem 0.75rem;
  }
  .card-rarity {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--foil);
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  h4 {
    margin: 0.3rem 0;
    color: #f3f6f8;
    font-family: var(--font-display);
    font-size: 0.95rem;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: #a9bbc9;
    font-size: 0.65rem;
  }
  .compact {
    flex-direction: row;
    align-items: center;
    min-height: 3.75rem;
  }
  .compact .card-corner {
    position: static;
    padding-left: 0.65rem;
    width: 2.25rem;
    flex: none;
  }
  .compact .card-corner strong {
    font-size: 1.15rem;
  }
  .compact .card-art {
    width: 2.5rem;
    height: 2.8rem;
    flex: none;
    border: 0;
  }
  .compact .card-identity {
    padding: 0.5rem;
  }
  .compact h4 {
    font-size: 0.8rem;
  }
</style>
