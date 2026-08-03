<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { RosterDetailRow } from '$lib/roster-browser';
  import { X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import PlayerFace from './PlayerFace.svelte';

  let {
    selected,
    manifest,
    franchiseName,
    eraLabel,
    oncompare,
    onremove,
    onclear,
  }: {
    selected: RosterDetailRow[];
    manifest: HoopRushManifest;
    franchiseName: Map<string, string>;
    eraLabel: Map<string, string>;
    oncompare: (player: RosterDetailRow) => void;
    onremove: (playerId: string) => void;
    onclear: () => void;
  } = $props();

  let open = $state(false);
  let compareButton = $state<HTMLButtonElement | undefined>(undefined);
  let lastTrigger = $state<HTMLElement | null>(null);
  const ready = $derived(selected.length === 2);

  function selectionKey(player: RosterDetailRow): string {
    return `${player.franchiseId}/${player.eraId}/${player.playerId}`;
  }

  function openComparison() {
    lastTrigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : (compareButton ?? null);
    open = true;
  }

  function restoreFocus() {
    const target = lastTrigger ?? compareButton;
    lastTrigger = null;
    queueMicrotask(() => target?.focus());
  }

  function displayName(player: RosterDetailRow): string {
    return player.displayName || `${player.firstName} ${player.lastName}`;
  }

  function isSelected(player: RosterDetailRow): boolean {
    return selected.some((entry) => entry.playerId === player.playerId);
  }

  function optional(value: number | null | undefined, digits = 1): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function ratio(made: number | null, attempted: number | null): string {
    if (made === null || attempted === null || attempted <= 0) return '—';
    return `${((made / attempted) * 100).toFixed(1)}%`;
  }

  function perGame(
    player: RosterDetailRow,
    key: 'minutes' | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks',
  ): string {
    const value = player.stats[key];
    if (typeof value !== 'number' || player.stats.gamesPlayed <= 0) return '—';
    return (value / player.stats.gamesPlayed).toFixed(1);
  }

  function countValue(
    player: RosterDetailRow,
    key: 'minutes' | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks',
  ): string {
    const value = player.stats[key];
    if (typeof value !== 'number') return '—';
    return `${value.toLocaleString()} (${perGame(player, key)}/g)`;
  }

  function metricValue(player: RosterDetailRow, metric: string): string {
    const stats = player.stats;
    switch (metric) {
      case 'Games':
        return stats.gamesPlayed.toLocaleString();
      case 'Minutes':
        return countValue(player, 'minutes');
      case 'Points':
        return countValue(player, 'points');
      case 'Rebounds':
        return countValue(player, 'rebounds');
      case 'Assists':
        return countValue(player, 'assists');
      case 'Steals':
        return countValue(player, 'steals');
      case 'Blocks':
        return countValue(player, 'blocks');
      case 'FG%':
        return ratio(stats.fieldGoalsMade, stats.fieldGoalsAttempted);
      case '3P%':
        return ratio(stats.threesMade, stats.threesAttempted);
      case 'FT%':
        return ratio(stats.freeThrowsMade, stats.freeThrowsAttempted);
      case 'TS%':
        return stats.tsPct === null ? '—' : `${(stats.tsPct * 100).toFixed(1)}%`;
      case 'PER':
        return optional(stats.per);
      case 'Usage':
        return stats.usageRate === null ? '—' : `${stats.usageRate.toFixed(1)}%`;
      default:
        return '—';
    }
  }

  const metrics = [
    'Games',
    'Minutes',
    'Points',
    'Rebounds',
    'Assists',
    'Steals',
    'Blocks',
    'FG%',
    '3P%',
    'FT%',
    'TS%',
    'PER',
    'Usage',
  ];
</script>

{#if selected.length > 0}
  <div
    class="fixed inset-x-3 bottom-3 z-30 rounded-xl border border-primary/35 bg-card/95 p-3 shadow-2xl shadow-black/25 backdrop-blur sm:sticky sm:inset-x-auto sm:bottom-5 sm:mt-4 sm:flex sm:items-center sm:gap-4"
  >
    <div class="min-w-0 flex-1">
      <p class="font-mono text-[10px] font-bold tracking-[0.14em] text-primary uppercase">
        Compare tray · {selected.length}/2
      </p>
      <div class="mt-2 flex min-w-0 flex-wrap gap-2">
        {#each selected as player (selectionKey(player))}
          <span
            class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold"
          >
            <span class="truncate">{displayName(player)}</span>
            <button
              type="button"
              aria-label={`Remove ${displayName(player)} from comparison`}
              onclick={() => onremove(selectionKey(player))}
              class="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X class="h-3 w-3" />
            </button>
          </span>
        {/each}
      </div>
    </div>
    <div class="mt-3 flex shrink-0 gap-2 sm:mt-0">
      <button
        type="button"
        bind:this={compareButton}
        disabled={!ready}
        onclick={openComparison}
        class="flex-1 rounded-md bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
      >
        Compare players
      </button>
      <button
        type="button"
        onclick={onclear}
        class="rounded-md border border-border px-3 py-2 font-mono text-xs font-bold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
      >
        Clear
      </button>
    </div>
    <p class="sr-only" role="status" aria-live="polite">
      {selected.length} player{selected.length === 1 ? '' : 's'} selected for comparison.
    </p>
  </div>
{/if}

<Dialog.Root
  open={open && ready}
  onOpenChange={(value) => {
    open = value;
    if (!value) restoreFocus();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-5"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <Dialog.Title class="font-display text-xl font-extrabold tracking-tight uppercase">
            Player comparison
          </Dialog.Title>
          <p class="mt-1 text-xs text-muted-foreground">
            Side-by-side facts from the selected player-seasons.
          </p>
        </div>
        <Dialog.Close
          aria-label="Close comparison"
          class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X class="h-4 w-4" />
        </Dialog.Close>
      </div>

      <div class="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:gap-4">
        {#each selected as player (selectionKey(player))}
          <section class="min-w-0 rounded-lg border border-border bg-surface-1 p-3 sm:p-4">
            <div class="flex items-center gap-2.5">
              <PlayerFace
                {player}
                {manifest}
                size="sm"
                fallbackInitials={player.firstName[0]! + player.lastName[0]!}
              />
              <div class="min-w-0">
                <h3 class="truncate text-sm font-bold">{displayName(player)}</h3>
                <p class="font-mono text-[10px] text-muted-foreground">
                  {franchiseAbbreviation(player.franchiseId)} · {eraLabel.get(player.eraId) ??
                    player.eraId}
                </p>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px]">
              <span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary"
                >Overall {player.overall}</span
              >
              <span class="rounded bg-surface-3 px-1.5 py-0.5">Offense {player.offense}</span>
              <span class="rounded bg-surface-3 px-1.5 py-0.5">Defense {player.defense}</span>
            </div>
            <dl class="mt-3 space-y-1.5 text-[11px]">
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Franchise</dt>
                <dd class="text-right font-semibold">
                  {franchiseName.get(player.franchiseId) ?? player.franchiseId}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Decade</dt>
                <dd class="font-mono font-semibold">
                  {eraLabel.get(player.eraId) ?? player.eraId}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Peak season</dt>
                <dd class="font-mono font-semibold">{player.seasonKey}</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt class="text-muted-foreground">Positions</dt>
                <dd class="font-mono font-semibold">{player.positionsCanonical.join('/')}</dd>
              </div>
            </dl>
          </section>
        {/each}
      </div>

      <div class="mt-4 overflow-hidden rounded-lg border border-border">
        <div
          class="grid grid-cols-[minmax(6rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] bg-surface-2 font-mono text-[10px] font-bold uppercase"
        >
          <div class="px-2.5 py-2 text-muted-foreground">Stat</div>
          {#each selected as player (selectionKey(player))}
            <div class="truncate px-2.5 py-2 text-right">{displayName(player)}</div>
          {/each}
        </div>
        {#each metrics as metric (metric)}
          <div
            class="grid grid-cols-[minmax(6rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] border-t border-border/70 text-xs"
          >
            <div class="px-2.5 py-2 text-muted-foreground">{metric}</div>
            {#each selected as player (selectionKey(player))}
              <div class="px-2.5 py-2 text-right font-mono font-semibold tabular-nums">
                {metricValue(player, metric)}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
