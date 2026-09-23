<script lang="ts">
  import type {
    CollectionCatalog,
    CollectionCatalogCard,
    CollectionIndexEntry,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { resolveCollectionCard } from '@hoop-rush/engine';
  import { resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  let {
    card,
    indexEntry,
    catalog,
    manifest,
    owned,
    ownedCount,
    setTotal,
    setTitle,
    eligiblePacks,
    activeTargetPlayerId = null,
    targetingAvailable = false,
    targetBusy = false,
    targetError = null,
    onSetTarget,
    onClearTarget,
    onClose,
  }: {
    card: CollectionCatalogCard | null;
    indexEntry: CollectionIndexEntry | null;
    catalog: CollectionCatalog | null;
    manifest: HoopRushManifest;
    owned: boolean;
    ownedCount: number;
    setTotal: number;
    setTitle: string | null;
    eligiblePacks: string[];
    activeTargetPlayerId?: string | null;
    targetingAvailable?: boolean;
    targetBusy?: boolean;
    targetError?: string | null;
    onSetTarget?: (playerId: string) => void;
    onClearTarget?: () => void;
    onClose: () => void;
  } = $props();

  const resolved = $derived(card ? resolveCollectionCard(card, card) : null);
  const baseCard = $derived(
    card && catalog && card.family !== 'Base'
      ? (catalog.cards.find(
          (entry) =>
            entry.sourcePlayerVersionId === card.sourcePlayerVersionId && entry.family === 'Base',
        ) ?? null)
      : null,
  );
  const teamLabel = $derived(
    card
      ? (resolveEraTeamIdentity(manifest, card.franchiseId, card.eraId).displayLabel ??
          `${card.franchiseId} ${card.seasonKey}`)
      : (indexEntry?.seasonKey ?? ''),
  );
  function initialsOf(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
  const title = $derived(card?.displayName ?? indexEntry?.displayName ?? 'Card');
  const ratingRows = $derived(
    resolved ? (Object.entries(resolved.ratings) as Array<[string, number]>) : [],
  );
  const overlayDeltas: Record<string, number | undefined> = $derived(card?.ratingOverlay ?? {});
  const playerId = $derived(card?.playerId ?? indexEntry?.playerId ?? null);
  const playerVersionCount = $derived(
    playerId && catalog ? catalog.cards.filter((entry) => entry.playerId === playerId).length : 0,
  );
  const isActiveTarget = $derived(playerId !== null && activeTargetPlayerId === playerId);
  const activeTargetName = $derived(
    activeTargetPlayerId && catalog
      ? (catalog.cards.find((entry) => entry.playerId === activeTargetPlayerId)?.displayName ??
          activeTargetPlayerId)
      : null,
  );
  const cardKey = $derived(card?.cardId ?? indexEntry?.cardId ?? null);
  let viewMode = $state<'front' | 'details'>('front');
  let lastCardKey: string | null = null;
  $effect(() => {
    if (cardKey !== lastCardKey) {
      lastCardKey = cardKey;
      viewMode = 'front';
    }
  });
</script>

<Dialog.Root
  open={card !== null || indexEntry !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/70" />
    <Dialog.Content
      class="ur-card-dialog fixed left-1/2 top-1/2 z-50 max-h-[88svh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 outline-none"
      aria-describedby={undefined}
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <Dialog.Title class="font-display text-2xl font-extrabold leading-tight"
            >{title}</Dialog.Title
          >
          <p class="text-sm text-muted-foreground">
            {teamLabel}
            {#if card}
              · {card.seasonKey} · {formatPositions(card.positions)}
            {:else if indexEntry}
              · {indexEntry.seasonKey} · {formatPositions(indexEntry.positions)}
            {/if}
          </p>
        </div>
        <Dialog.Close
          class="rounded-lg p-2 text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close card details"
        >
          <X class="h-5 w-5" />
        </Dialog.Close>
      </div>

      <div class="ur-card-view-toggle mt-4" role="group" aria-label="Card view">
        <button
          type="button"
          aria-pressed={viewMode === 'front'}
          onclick={() => (viewMode = 'front')}
        >
          Front
        </button>
        <button
          type="button"
          aria-pressed={viewMode === 'details'}
          onclick={() => (viewMode = 'details')}
        >
          Details
        </button>
      </div>

      {#if viewMode === 'front'}
        <section
          class="ur-dialog-cardfront ur-dialog-cardfront--{indexEntry?.rarity.toLowerCase() ??
            'ember'}"
          aria-label="Card front"
        >
          <p class="ur-dialog-team">{teamLabel}</p>
          <div class="ur-dialog-face">
            {#if indexEntry}
              <PlayerFace
                player={{
                  playerId: indexEntry.playerId,
                  playerExternalId: indexEntry.playerExternalId,
                  altIds: null,
                }}
                {manifest}
                size="xl"
                fallbackInitials={initialsOf(title)}
              />
            {/if}
            <span class="ur-dialog-overall-stamp" aria-hidden="true">
              <small>OVR</small><strong>{indexEntry?.overall ?? '—'}</strong>
            </span>
          </div>
          <p class="ur-dialog-name">{title}</p>
          <p class="ur-dialog-positions">
            {formatPositions(card?.positions ?? indexEntry?.positions ?? [])}
          </p>
          <div class="ur-dialog-card-facts">
            <span class="ur-dialog-overall"><small>Overall</small>{indexEntry?.overall ?? '—'}</span
            >
            {#if card?.summarySource}
              <span class="ur-dialog-compare">
                <span><small>Offense</small>{card.summarySource.offenseRating}</span>
                <span><small>Defense</small>{card.summarySource.defenseRating}</span>
              </span>
            {/if}
          </div>
          <div class="ur-dialog-markers">
            {#if indexEntry}
              <span class="ur-rarity ur-rarity-{indexEntry.rarity.toLowerCase()}"
                >{indexEntry.rarity}</span
              >
              {#if indexEntry.family !== 'Base'}
                <span class="ur-status-badge">{indexEntry.family}</span>
              {/if}
            {/if}
            <span class="ur-status-badge">{owned ? 'Owned' : 'Unowned'}</span>
          </div>
        </section>
      {/if}

      {#if viewMode === 'details'}
        <div class="mt-4 flex items-center gap-3">
          {#if indexEntry}
            <PlayerFace
              player={{
                playerId: indexEntry.playerId,
                playerExternalId: indexEntry.playerExternalId,
                altIds: null,
              }}
              {manifest}
              size="court"
              fallbackInitials={initialsOf(title)}
            />
          {/if}
          <div class="flex flex-wrap items-center gap-1.5">
            {#if indexEntry}
              <span
                class="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
              >
                {indexEntry.rarity}
              </span>
              {#if indexEntry.family !== 'Base'}
                <span class="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold">
                  {indexEntry.family}
                </span>
              {/if}
            {/if}
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide {owned
                ? 'bg-positive/20 text-positive'
                : 'bg-surface-3 text-muted-foreground'}"
            >
              {owned ? 'Owned' : 'Unowned'}
            </span>
            {#if setTitle}
              <span class="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold">
                {setTitle}
                {ownedCount}/{setTotal}
              </span>
            {/if}
          </div>
        </div>

        {#if card && resolved}
          <h3 class="mt-5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Ratings
          </h3>
          <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {#each ratingRows as [key, value] (key)}
              <div class="flex items-baseline justify-between gap-2">
                <dt class="text-muted-foreground">{key}</dt>
                <dd class="font-semibold tabular-nums">
                  {value}{#if overlayDeltas[key] !== undefined && overlayDeltas[key] !== 0}
                    <span class="text-positive">
                      {overlayDeltas[key] > 0 ? '+' : ''}{overlayDeltas[key]}</span
                    >
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
          {#if card.anchors}
            <h3 class="mt-5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Source season
            </h3>
            <p class="mt-1 text-sm text-muted-foreground">
              {card.anchors.pointsPerGame.toFixed(1)} pts · {card.anchors.reboundsPerGame.toFixed(
                1,
              )} reb ·
              {card.anchors.assistsPerGame.toFixed(1)} ast over {card.anchors.gamesPlayed} games. Historical
              source-season facts.
            </p>
          {/if}
          {#if baseCard}
            <p class="mt-3 text-xs text-muted-foreground">
              Special variant of {baseCard.displayName}. Deltas above show special-versus-base
              differences.
            </p>
          {/if}
          {#if eligiblePacks.length > 0}
            <h3 class="mt-5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Eligible packs
            </h3>
            <p class="mt-1 text-sm">{eligiblePacks.join(', ')}</p>
          {/if}
          {#if playerId}
            <h3 class="mt-5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Targeting
            </h3>
            {#if !targetingAvailable}
              <p class="mt-1 text-sm text-muted-foreground">
                Targeting rules are unavailable, so the target cannot be changed right now.
              </p>
            {:else if isActiveTarget}
              <p class="mt-1 text-sm">
                <strong>{title}</strong> is your active target. All {playerVersionCount} catalog
                {playerVersionCount === 1 ? 'version' : 'versions'} are targeted.
              </p>
              <button
                type="button"
                onclick={onClearTarget}
                disabled={targetBusy}
                class="mt-2 min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {targetBusy ? 'Clearing…' : 'Clear target'}
              </button>
            {:else}
              <p class="mt-1 text-sm">
                Target this player to weight every version of them inside its rarity. All
                {playerVersionCount} catalog
                {playerVersionCount === 1 ? 'version is' : 'versions are'} targeted in every pack that
                contains them. Rarity odds, guarantees, and prices do not change.
              </p>
              {#if activeTargetName}
                <p class="mt-1 text-xs text-muted-foreground">Current target: {activeTargetName}</p>
              {/if}
              <button
                type="button"
                onclick={() => playerId && onSetTarget?.(playerId)}
                disabled={targetBusy}
                class="mt-2 min-h-11 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {targetBusy ? 'Setting…' : 'Target player'}
              </button>
            {/if}
            {#if targetError}
              <p role="alert" class="mt-2 text-sm text-destructive">{targetError}</p>
            {/if}
          {/if}
        {:else}
          <p class="mt-4 text-sm text-muted-foreground">Full details load with the card catalog.</p>
        {/if}
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .ur-card-dialog {
    border-color: var(--ur-line-strong);
    border-radius: 0;
    background:
      radial-gradient(
        ellipse at 100% 0%,
        color-mix(in srgb, var(--ur-apex) 8%, transparent),
        transparent 40%
      ),
      var(--ur-bg);
    color: var(--ur-paper);
    box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 62%);
  }

  .ur-card-view-toggle {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-bottom: 1px solid var(--ur-line);
  }

  .ur-card-view-toggle button {
    min-height: 2.75rem;
    border-bottom: 3px solid transparent;
    color: var(--ur-muted);
    font-size: 0.86rem;
    font-weight: 800;
  }

  .ur-card-view-toggle button[aria-pressed='true'] {
    border-bottom-color: var(--ur-apex);
    color: var(--ur-paper);
  }

  .ur-card-view-toggle button:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  .ur-dialog-cardfront {
    --ur-dialog-rarity: var(--ur-ember);
    position: relative;
    width: min(100%, 27rem);
    margin-top: 1rem;
    padding: 0.9rem;
    border: 2px solid var(--ur-dialog-rarity);
    background:
      linear-gradient(
        145deg,
        color-mix(in srgb, var(--ur-dialog-rarity) 16%, transparent),
        transparent 46%
      ),
      var(--ur-raised);
    box-shadow: 0 1rem 2rem rgb(0 0 0 / 25%);
  }

  .ur-dialog-cardfront--eruption {
    --ur-dialog-rarity: var(--ur-eruption);
    border-top-width: 5px;
  }

  .ur-dialog-cardfront--apex {
    --ur-dialog-rarity: var(--ur-apex);
    border-width: 3px;
    box-shadow:
      inset 0 0 0 3px color-mix(in srgb, var(--ur-dialog-rarity) 25%, transparent),
      0 1rem 2rem rgb(0 0 0 / 25%);
  }

  .ur-dialog-cardfront--titan {
    --ur-dialog-rarity: var(--ur-titan);
    border-left-width: 6px;
  }

  .ur-dialog-cardfront--eclipse {
    --ur-dialog-rarity: var(--ur-eclipse);
    box-shadow:
      inset 0 0 0 4px #211931,
      inset 0 0 0 5px color-mix(in srgb, var(--ur-dialog-rarity) 65%, transparent);
  }

  .ur-dialog-cardfront--immortal {
    --ur-dialog-rarity: var(--ur-immortal);
    border: 3px double var(--ur-dialog-rarity);
  }

  .ur-dialog-team {
    color: var(--ur-muted);
    font-size: 0.78rem;
  }

  .ur-dialog-face {
    position: relative;
    min-height: clamp(17rem, 52vw, 24rem);
    overflow: hidden;
    margin-block: 0.75rem;
    background:
      radial-gradient(
        ellipse at 50% 15%,
        color-mix(in srgb, var(--ur-dialog-rarity) 36%, transparent),
        transparent 60%
      ),
      linear-gradient(160deg, #293a43, #111a1e 78%);
  }

  .ur-dialog-face :global(.relative) {
    width: 100%;
    height: 100%;
    min-height: inherit;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .ur-dialog-face :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 12%;
    transform: scale(1.12);
  }

  .ur-dialog-face::after {
    position: absolute;
    inset: 35% 0 0;
    background: linear-gradient(180deg, transparent, rgb(8 11 14 / 58%));
    content: '';
    pointer-events: none;
  }

  .ur-dialog-overall-stamp {
    position: absolute;
    z-index: 2;
    top: 0.75rem;
    left: 0.75rem;
    display: grid;
    min-width: 3.4rem;
    justify-items: center;
    padding: 0.3rem 0.45rem 0.4rem;
    border: 1px solid color-mix(in srgb, var(--ur-dialog-rarity) 75%, var(--ur-paper));
    background: color-mix(in srgb, var(--ur-bg) 80%, transparent);
    color: var(--ur-dialog-rarity);
    line-height: 0.95;
    backdrop-filter: blur(5px);
  }

  .ur-dialog-overall-stamp small {
    font-size: 0.62rem;
    font-weight: 800;
  }

  .ur-dialog-overall-stamp strong {
    font-family: var(--font-display);
    font-size: 2.1rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }

  .ur-dialog-name {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 800;
    line-height: 1;
  }

  .ur-dialog-positions {
    margin-top: 0.3rem;
    color: var(--ur-muted);
    font-size: 0.8rem;
  }

  .ur-dialog-card-facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.85rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--ur-line);
  }

  .ur-dialog-overall {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    color: var(--ur-dialog-rarity, var(--ur-apex));
    font-family: var(--font-display);
    font-size: 2.5rem;
    font-weight: 800;
    line-height: 1;
  }

  .ur-dialog-overall small,
  .ur-dialog-compare small {
    color: var(--ur-muted);
    font-family: var(--font-sans);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .ur-dialog-compare {
    display: flex;
    gap: 0.75rem;
    color: var(--ur-paper);
    font-size: 0.9rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .ur-dialog-compare span {
    display: flex;
    flex-direction: column;
  }

  .ur-dialog-markers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.75rem;
  }
</style>
