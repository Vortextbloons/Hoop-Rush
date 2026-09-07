<script lang="ts">
  import type { CollectionIndexEntry, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  let {
    item,
    manifest,
    selected = false,
    onSelect,
  }: {
    item: { entry: CollectionIndexEntry; owned: boolean };
    manifest: HoopRushManifest | null;
    selected?: boolean;
    onSelect: (cardId: string) => void;
  } = $props();

  const entry = $derived(item.entry);
  const rarityClass = $derived(
    entry.rarity === 'Immortal'
      ? 'ur-rarity ur-rarity-immortal'
      : entry.rarity === 'Eclipse'
        ? 'ur-rarity ur-rarity-eclipse'
        : entry.rarity === 'Titan'
          ? 'ur-rarity ur-rarity-titan'
          : entry.rarity === 'Apex'
            ? 'ur-rarity ur-rarity-apex'
            : entry.rarity === 'Eruption'
              ? 'ur-rarity ur-rarity-eruption'
              : 'ur-rarity ur-rarity-ember',
  );
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
  onclick={() => onSelect(entry.cardId)}
  aria-pressed={selected}
  aria-label={`${entry.displayName}, ${entry.seasonKey}, ${entry.rarity}${item.owned ? '' : ', unowned'}`}
  class="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
>
  <div class="flex items-center gap-3 p-3">
    {#if manifest}
      <PlayerFace
        player={{
          playerId: entry.playerId,
          playerExternalId: entry.playerExternalId,
          altIds: null,
        }}
        {manifest}
        size="md"
        fallbackInitials={initialsOf(entry.displayName)}
      />
    {:else}
      <div
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-sm font-bold"
        aria-hidden="true"
      >
        {initialsOf(entry.displayName)}
      </div>
    {/if}
    <div class="min-w-0 flex-1">
      <p class="truncate font-display text-lg font-bold leading-tight">{entry.displayName}</p>
      <p class="truncate text-xs text-muted-foreground">
        {entry.seasonKey} · {entry.franchiseId} · {formatPositions(entry.positions)}
      </p>
    </div>
    <span class="shrink-0 text-2xl font-black tabular-nums" aria-label={`Overall ${entry.overall}`}>
      {entry.overall}
    </span>
  </div>
  <div class="flex items-center gap-1.5 px-3 pb-3">
    <span
      class="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide {rarityClass}"
    >
      {entry.rarity}
    </span>
    {#if entry.family !== 'Base'}
      <span
        class="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
      >
        {entry.family}
      </span>
    {/if}
    <span
      class="ml-auto text-[11px] font-semibold uppercase tracking-wide {item.owned
        ? 'text-positive'
        : 'text-muted-foreground'}"
    >
      {item.owned ? 'Owned' : 'Unowned'}
    </span>
  </div>
</button>
