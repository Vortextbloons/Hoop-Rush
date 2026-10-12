<script lang="ts">
  import type {
    CollectionCatalogCard,
    CollectionIndexEntry,
    CollectionRarity,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import type { Snippet } from 'svelte';
  import { asset } from '$app/paths';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { collectionCardArtOf } from './collection-card-art.ts';
  import type { CollectionCardView } from './collection-card-view.ts';

  let {
    view = null,
    card = null,
    manifest = null,
    rarity = null,
    size = 'xl',
    artwork,
    displayName = null,
    overall,
    showOverall = false,
    fallback = null,
    loading = 'eager',
  }: {
    view?: CollectionCardView | null;
    card?: CollectionCatalogCard | CollectionIndexEntry | null;
    manifest?: HoopRushManifest | null;
    rarity?: CollectionRarity | null;
    size?: 'sm' | 'md' | 'court' | 'xl';
    artwork?: string | null;
    displayName?: string | null;
    overall?: number | null;
    showOverall?: boolean;
    fallback?: Snippet | null;
    loading?: 'lazy' | 'eager';
  } = $props();

  const resolvedArtwork = $derived(
    artwork !== undefined ? artwork : collectionCardArtOf(view ?? card),
  );
  const resolvedRarity = $derived(rarity ?? view?.rarity ?? card?.rarity ?? null);
  const resolvedName = $derived(displayName ?? view?.name ?? card?.displayName ?? '');
  const cardOverall = $derived(
    card === null
      ? null
      : 'overall' in card
        ? card.overall
        : (card.summarySource?.overallRating ?? null),
  );
  const resolvedOverall = $derived(
    overall !== undefined ? overall : (view?.overall ?? cardOverall),
  );
  const player = $derived(
    view
      ? { playerId: view.playerId, playerExternalId: view.playerExternalId, altIds: null }
      : card
        ? { playerId: card.playerId, playerExternalId: card.playerExternalId, altIds: null }
        : null,
  );
  const initials = $derived(
    resolvedName
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );
  const toneClass = $derived(
    resolvedRarity ? `ur-rarity-tone-${resolvedRarity.toLowerCase()}` : '',
  );
</script>

<span class="ur-card-face {toneClass}">
  {#if resolvedArtwork}
    <img class="ur-special-art" src={asset(resolvedArtwork)} alt="" {loading} />
  {:else if player && manifest}
    <PlayerFace {player} {manifest} {size} fallbackInitials={initials} />
  {:else if fallback}
    {@render fallback()}
  {:else}
    <span class="ur-card-face-initials" aria-hidden="true">{initials}</span>
  {/if}
  {#if showOverall}
    <span class="ur-card-face-overall" aria-hidden="true">
      <small>OVR</small><strong>{resolvedOverall ?? '—'}</strong>
    </span>
  {/if}
</span>

<style>
  .ur-card-face {
    display: contents;
  }

  .ur-card-face-overall {
    position: absolute;
    z-index: 2;
    top: var(--ur-face-overall-inset, 0.7rem);
    left: var(--ur-face-overall-inset, 0.7rem);
    display: grid;
    min-width: var(--ur-face-overall-min-width, 3.25rem);
    justify-items: center;
    padding: var(--ur-face-overall-padding, 0.28rem 0.4rem 0.35rem);
    border: 1px solid
      var(
        --ur-face-overall-border,
        color-mix(in srgb, var(--ur-rarity, var(--ur-ember)) 74%, var(--ur-paper))
      );
    background: var(--ur-face-overall-bg, color-mix(in srgb, var(--ur-bg) 82%, transparent));
    color: var(--ur-rarity, var(--ur-ember));
    line-height: 0.95;
    backdrop-filter: blur(5px);
  }

  .ur-card-face-overall small {
    font-size: var(--ur-face-overall-small-size, 0.62rem);
    font-weight: 800;
  }

  .ur-card-face-overall strong {
    font-family: var(--font-display);
    font-size: var(--ur-face-overall-size, 2rem);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
</style>
