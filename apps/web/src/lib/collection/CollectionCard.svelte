<script lang="ts">
  import type {
    CollectionCatalog,
    CollectionIndexEntry,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { collectionCardViewOf } from './collection-card-view.ts';

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
  aria-label={`${view.name}, ${view.season}, ${view.rarity}, Overall ${view.overall}, ${formatPositions(view.positions)}, ${view.owned ? 'owned' : 'unowned'}`}
  class="ur-card group ur-card--{rarityToken}"
>
  <span class="ur-card-status" class:ur-card-status-owned={view.owned}>
    {view.owned ? 'Owned' : 'Catalog'}
  </span>
  <span class="ur-card-team">{view.franchiseId} · {view.season}</span>
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
  </span>
  <span class="ur-card-position-list" aria-label={`Positions ${formatPositions(view.positions)}`}>
    {#each view.positions.slice(0, 3) as position (position)}
      <span>{position}</span>
    {/each}
  </span>
  <span class="ur-card-nameplate">
    <span class="ur-card-name">{view.name}</span>
    <span class="ur-card-statline">
      <span class="ur-card-overall"><small>OVR</small>{view.overall}</span>
      {#if view.offense !== null && view.defense !== null}
        <span
          class="ur-card-comparison"
          aria-label={`Offense ${view.offense}, defense ${view.defense}`}
        >
          <span><small>OFF</small>{view.offense}</span>
          <span><small>DEF</small>{view.defense}</span>
        </span>
      {/if}
    </span>
  </span>
  <span class="ur-card-rarity ur-rarity ur-rarity-{rarityToken}">{view.rarity}</span>
</button>

<style>
  .ur-card {
    position: relative;
    display: flex;
    width: 100%;
    aspect-ratio: 5 / 7.2;
    min-width: 0;
    flex-direction: column;
    align-items: stretch;
    overflow: hidden;
    padding: 0.7rem;
    border: 2px solid var(--ur-rarity);
    background: linear-gradient(145deg, rgb(240 236 223 / 5%), transparent 46%), var(--ur-raised);
    color: var(--ur-paper);
    text-align: left;
    outline: none;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .ur-card:hover {
    background-color: var(--ur-surface);
  }

  .ur-card:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 3px;
  }

  .ur-card--ember {
    --ur-rarity: #c65a2e;
    border-radius: 0 1rem 0 0;
  }

  .ur-card--eruption {
    --ur-rarity: #ff5a2a;
    border-top-width: 5px;
    clip-path: polygon(0 0, 86% 0, 100% 8%, 100% 100%, 0 100%);
  }

  .ur-card--apex {
    --ur-rarity: #ffc53d;
    border-width: 3px;
    outline: 1px solid color-mix(in srgb, var(--ur-rarity) 55%, transparent);
    outline-offset: -6px;
  }

  .ur-card--titan {
    --ur-rarity: #a9b4d8;
    border-left-width: 6px;
    background-image:
      repeating-linear-gradient(135deg, transparent 0 13px, rgb(169 180 216 / 4%) 14px 15px),
      linear-gradient(145deg, rgb(240 236 223 / 5%), transparent 46%);
  }

  .ur-card--eclipse {
    --ur-rarity: #a588ff;
    border: 2px solid #a588ff;
    box-shadow:
      inset 0 0 0 4px #211931,
      inset 0 0 0 5px rgb(165 136 255 / 65%);
  }

  .ur-card--immortal {
    --ur-rarity: #ffe9b0;
    border: 3px double var(--ur-rarity);
    background-image:
      linear-gradient(
        110deg,
        rgb(255 233 176 / 7%),
        transparent 36%,
        rgb(255 233 176 / 3%) 63%,
        transparent
      ),
      linear-gradient(145deg, rgb(240 236 223 / 5%), transparent 46%);
  }

  .ur-card-status {
    position: absolute;
    z-index: 1;
    top: 0.65rem;
    right: 0.65rem;
    display: inline-flex;
    min-height: 1.55rem;
    align-items: center;
    padding-inline: 0.4rem;
    background: #252e33;
    color: #e4e6df;
    font-size: 0.62rem;
    font-weight: 800;
  }

  .ur-card-status-owned {
    background: #d9e7d9;
    color: #163423;
  }

  .ur-card-team {
    max-width: 65%;
    overflow: hidden;
    color: var(--ur-muted);
    font-size: clamp(0.62rem, 2.3vw, 0.75rem);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-card-hero {
    display: grid;
    min-height: 0;
    flex: 1;
    place-items: center;
    margin: 0.55rem -0.1rem 0.25rem;
    background:
      linear-gradient(180deg, transparent 60%, rgb(8 11 14 / 78%)),
      repeating-linear-gradient(90deg, transparent 0 37px, rgb(240 236 223 / 3%) 38px), #1b252a;
  }

  .ur-card-hero :global(.relative) {
    border: 2px solid color-mix(in srgb, var(--ur-rarity) 65%, transparent);
    border-radius: 0.75rem;
    background: #283338;
  }

  .ur-card-initials {
    color: color-mix(in srgb, var(--ur-paper) 75%, var(--ur-rarity));
    font-family: var(--font-display);
    font-size: clamp(2.6rem, 8vw, 5rem);
    font-weight: 800;
    letter-spacing: -0.04em;
  }

  .ur-card-position-list {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.15rem;
  }

  .ur-card-position-list span {
    display: inline-grid;
    min-width: 1.35rem;
    min-height: 1.3rem;
    place-items: center;
    border: 1px solid var(--ur-line-strong);
    color: var(--ur-paper);
    font-size: 0.6rem;
    font-weight: 700;
  }

  .ur-card-nameplate {
    display: block;
    min-width: 0;
    margin-top: 0.3rem;
  }

  .ur-card-name {
    display: block;
    overflow: hidden;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1rem, 3.1vw, 1.35rem);
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-card-statline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
    margin-top: 0.3rem;
  }

  .ur-card-overall {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    color: var(--ur-rarity);
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 800;
    line-height: 1;
  }

  .ur-card-overall small,
  .ur-card-comparison small {
    color: var(--ur-muted);
    font-family: var(--font-sans);
    font-size: 0.58rem;
    font-weight: 700;
  }

  .ur-card-comparison {
    display: inline-flex;
    gap: 0.45rem;
    color: var(--ur-paper);
    font-size: 0.75rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .ur-card-comparison span {
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
  }

  .ur-card-rarity {
    align-self: flex-start;
    min-height: 1.55rem;
    margin-top: 0.4rem;
    padding: 0.3rem 0.45rem;
  }

  @media (max-width: 400px) {
    .ur-card {
      padding: 0.55rem;
    }

    .ur-card-status {
      top: 0.5rem;
      right: 0.5rem;
      min-height: 1.4rem;
      font-size: 0.56rem;
    }

    .ur-card-comparison {
      gap: 0.25rem;
      font-size: 0.68rem;
    }

    .ur-card-rarity {
      font-size: 0.62rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-card {
      transition: none;
    }
  }
</style>
