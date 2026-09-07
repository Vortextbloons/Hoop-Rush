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
      class="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 outline-none"
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
            {card.anchors.pointsPerGame.toFixed(1)} pts · {card.anchors.reboundsPerGame.toFixed(1)} reb
            ·
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
      {:else}
        <p class="mt-4 text-sm text-muted-foreground">Full details load with the card catalog.</p>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
