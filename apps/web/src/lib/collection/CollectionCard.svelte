<script lang="ts">
  import type {
    CollectionCatalog,
    CollectionIndexEntry,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { collectionCardViewOf } from './collection-card-view.ts';
  import { humanizeIdentifier } from './collection-progression-view.ts';

  let {
    item,
    catalog = null,
    manifest,
    selected = false,
    onSelect,
  }: {
    item: { entry: CollectionIndexEntry; owned: boolean };
    catalog?: CollectionCatalog | null;
    manifest: HoopRushManifest | null;
    selected?: boolean;
    onSelect: (cardId: string) => void;
  } = $props();

  const catalogCard = $derived(
    catalog?.cards.find((card) => card.cardId === item.entry.cardId) ?? null,
  );
  const view = $derived(
    collectionCardViewOf({ entry: item.entry, catalogCard, owned: item.owned }),
  );
  const rarityToken = $derived(view.rarity.toLowerCase());
  const primaryPosition = $derived(view.positions[0] ?? '—');

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
</script>

<button
  type="button"
  onclick={() => onSelect(view.cardId)}
  aria-pressed={selected}
  aria-label={`${view.name}, ${view.season}, ${view.rarity}, Overall ${view.overall}, ${formatPositions(view.positions)}, active, ${view.owned ? 'owned' : 'unowned'}`}
  class="ur-card group ur-card--{rarityToken}"
  class:ur-card--unowned={!view.owned}
>
  <span class="ur-card-ovr" aria-hidden="true">
    <strong>{view.overall}</strong>
    <span class="ur-card-pos">{primaryPosition}</span>
  </span>
  <span class="ur-card-star" aria-hidden="true">
    <svg viewBox="0 0 20 20" class="ur-star-icon" class:ur-star-icon--on={selected}>
      <path
        d="M10 1.8 12.4 6.7 17.8 7.5 13.9 11.3 14.8 16.7 10 14.1 5.2 16.7 6.1 11.3 2.2 7.5 7.6 6.7Z"
        fill={selected ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  </span>
  <span class="ur-card-hero">
    {#if manifest}
      <PlayerFace
        player={{ playerId: view.playerId, playerExternalId: view.playerExternalId, altIds: null }}
        {manifest}
        size="xl"
        fallbackInitials={initialsOf(view.name)}
      />
    {:else}
      <span class="ur-card-initials" aria-hidden="true">{initialsOf(view.name)}</span>
    {/if}
    <span class="ur-card-owned" class:ur-card-owned--yes={view.owned}>
      {view.owned ? 'Owned' : 'Catalog'}
    </span>
  </span>
  <span class="ur-card-nameplate">
    <span class="ur-card-name">{view.name}</span>
    <span class="ur-card-sub">
      <span class="ur-card-team">{humanizeIdentifier(view.franchiseId)} · {view.season}</span>
      <span class="ur-card-family">{view.family}</span>
    </span>
  </span>
</button>

<style>
  .ur-card {
    position: relative;
    display: flex;
    width: 100%;
    aspect-ratio: 5 / 7.1;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border: 2px solid var(--ur-rarity, var(--ur-ember));
    border-radius: 0.6rem;
    background:
      linear-gradient(180deg, transparent 42%, rgb(8 11 14 / 88%)),
      radial-gradient(
        ellipse at 50% 12%,
        color-mix(in srgb, var(--ur-rarity) 38%, transparent),
        transparent 58%
      ),
      var(--ur-card-texture, none),
      linear-gradient(165deg, #232e35, #10161a 72%);
    color: var(--ur-paper);
    text-align: left;
    outline: none;
    box-shadow:
      0 0 1rem color-mix(in srgb, var(--ur-rarity) 32%, transparent),
      0 0.7rem 1.6rem rgb(0 0 0 / 30%);
    isolation: isolate;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease,
      transform 140ms ease;
  }

  .ur-card:hover,
  .ur-card[aria-pressed='true'] {
    border-color: color-mix(in srgb, var(--ur-rarity) 72%, white);
    box-shadow:
      0 0 1.4rem color-mix(in srgb, var(--ur-rarity) 48%, transparent),
      0 0.9rem 1.8rem rgb(0 0 0 / 36%);
  }

  @media (hover: hover) {
    .ur-card:hover {
      transform: translateY(-3px);
    }
  }

  .ur-card:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 3px;
  }

  .ur-card--ember {
    --ur-rarity: var(--ur-ember);
    --ur-card-texture: repeating-linear-gradient(
      135deg,
      transparent 0 16px,
      rgb(198 90 46 / 9%) 17px 18px
    );
  }

  .ur-card--eruption {
    --ur-rarity: var(--ur-eruption);
    --ur-card-texture: radial-gradient(
      ellipse at 85% 90%,
      rgb(255 90 42 / 30%),
      transparent 55%
    );
    border-top-width: 3px;
  }

  .ur-card--apex {
    --ur-rarity: var(--ur-apex);
    --ur-card-texture: repeating-linear-gradient(
      115deg,
      transparent 0 14px,
      rgb(255 197 61 / 10%) 15px 16px
    );
    border-width: 3px;
  }

  .ur-card--titan {
    --ur-rarity: var(--ur-titan);
    --ur-card-texture: repeating-linear-gradient(
      135deg,
      transparent 0 13px,
      rgb(169 180 216 / 10%) 14px 15px
    );
  }

  .ur-card--eclipse {
    --ur-rarity: var(--ur-eclipse);
    --ur-card-texture: radial-gradient(
        ellipse at 15% 85%,
        rgb(139 92 246 / 32%),
        transparent 55%
      ),
      radial-gradient(ellipse at 85% 15%, rgb(139 92 246 / 20%), transparent 50%);
  }

  .ur-card--immortal {
    --ur-rarity: var(--ur-immortal);
    --ur-card-texture: linear-gradient(
      115deg,
      rgb(255 233 176 / 12%),
      transparent 36%,
      rgb(255 233 176 / 6%) 67%,
      transparent
    );
    border: 3px double var(--ur-rarity);
  }

  .ur-card-ovr {
    position: absolute;
    z-index: 3;
    top: 0.5rem;
    left: 0.55rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    text-shadow:
      0 2px 6px rgb(0 0 0 / 85%),
      0 0 14px rgb(0 0 0 / 60%);
  }

  .ur-card-ovr strong {
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 4.2vw, 2.1rem);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .ur-card-pos {
    display: inline-grid;
    min-width: 1.7rem;
    min-height: 1.25rem;
    place-items: center;
    padding-inline: 0.3rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 70%, transparent);
    border-radius: 0.28rem;
    background: rgb(8 11 14 / 82%);
    color: var(--ur-apex);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }

  .ur-card-star {
    position: absolute;
    z-index: 3;
    top: 0.55rem;
    right: 0.55rem;
    color: rgb(240 236 223 / 75%);
    filter: drop-shadow(0 1px 4px rgb(0 0 0 / 70%));
  }

  .ur-star-icon {
    width: 1.15rem;
    height: 1.15rem;
  }

  .ur-star-icon--on {
    color: var(--ur-apex);
  }

  .ur-card-hero {
    position: relative;
    display: grid;
    min-height: 0;
    flex: 1 1 auto;
    place-items: stretch;
    overflow: hidden;
    margin: 0;
  }

  .ur-card-hero :global(.relative) {
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .ur-card-hero :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 12%;
    transform: scale(1.1);
  }

  .ur-card-hero :global(.absolute) {
    background: transparent;
  }

  .ur-card--unowned .ur-card-hero :global(img) {
    filter: saturate(0.55) brightness(0.82);
  }

  .ur-card-initials {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: radial-gradient(
      ellipse at 50% 32%,
      color-mix(in srgb, var(--ur-rarity) 26%, transparent),
      transparent 64%
    );
    color: color-mix(in srgb, var(--ur-paper) 75%, var(--ur-rarity));
    font-family: var(--font-display);
    font-size: clamp(2.6rem, 8vw, 5rem);
    font-weight: 800;
    letter-spacing: -0.04em;
  }

  .ur-card-owned {
    position: absolute;
    z-index: 2;
    bottom: 0.5rem;
    left: 0.55rem;
    display: inline-flex;
    min-height: 1.25rem;
    align-items: center;
    padding-inline: 0.4rem;
    border: 1px solid rgb(240 236 223 / 35%);
    border-radius: 0.3rem;
    background: rgb(8 11 14 / 78%);
    color: rgb(240 236 223 / 80%);
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .ur-card-owned--yes {
    border-color: color-mix(in srgb, var(--ur-apex) 65%, transparent);
    color: var(--ur-apex);
  }

  .ur-card-nameplate {
    display: block;
    min-width: 0;
    flex: 0 0 auto;
    padding: 0.5rem 0.6rem 0.55rem;
    border-top: 1px solid color-mix(in srgb, var(--ur-rarity) 55%, transparent);
    background: linear-gradient(180deg, rgb(10 14 17 / 88%), rgb(8 11 14 / 96%));
  }

  .ur-card-name {
    display: -webkit-box;
    min-height: 2.05em;
    overflow: hidden;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(0.92rem, 2.5vw, 1.2rem);
    font-weight: 800;
    line-height: 1.02;
    text-overflow: ellipsis;
    text-shadow: 0 1px 6px rgb(0 0 0 / 70%);
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .ur-card-sub {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
    margin-top: 0.22rem;
  }

  .ur-card-team {
    min-width: 0;
    overflow: hidden;
    color: rgb(240 236 223 / 68%);
    font-size: 0.66rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-card-family {
    flex: none;
    color: var(--ur-rarity);
    font-family: var(--font-display);
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  @media (max-width: 400px) {
    .ur-card-ovr strong {
      font-size: 1.5rem;
    }

    .ur-card-name {
      font-size: 0.92rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-card {
      transition: none;
      transform: none;
    }
  }
</style>
