<script
  lang="ts"
  generics="T extends Pick<PeakPlayerSeason, 'playerId' | 'displayName' | 'firstName' | 'lastName' | 'playerExternalId' | 'altIds'>"
>
  import type { HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
  import PlayerFace from './PlayerFace.svelte';
  import { SLOT_LABELS, SLOT_INDEXES } from '$lib/player-positions';

  const SLOT_POSITIONS = [
    { left: 50, top: 77 },
    { left: 22, top: 55 },
    { left: 78, top: 55 },
    { left: 34, top: 29 },
    { left: 66, top: 29 },
  ] as const;

  let {
    slots,
    manifest,
    ready,
    allowRemove = true,
    onmove,
    onremove,
  }: {
    slots: (T | null)[];
    manifest: HoopRushManifest;
    ready: boolean;
    allowRemove?: boolean;
    onmove: (player: T) => void;
    onremove: (index: number) => void;
  } = $props();

  const filledCount = $derived(slots.filter((p) => p !== null).length);
  let announcement = $state('');
  // This is only a comparison snapshot for the current component instance.
  // Keeping it non-reactive prevents the announcement effect from retriggering
  // itself after every new array allocation.
  let previousSlots: (string | null)[] | null = null;

  $effect(() => {
    const current = slots.map((player) => (player ? player.playerId : null));
    if (previousSlots === null) {
      previousSlots = current;
      return;
    }
    const moved = current.findIndex(
      (playerId, index) =>
        playerId !== null &&
        playerId !== previousSlots![index] &&
        previousSlots!.includes(playerId),
    );
    if (moved >= 0) {
      const playerId = current[moved]!;
      const from = previousSlots.indexOf(playerId);
      const player = slots[moved];
      if (player && from >= 0) {
        announcement = `Moved ${player.displayName} from ${SLOT_LABELS[from]} to ${SLOT_LABELS[moved]}.`;
      }
    } else {
      const added = current.findIndex(
        (playerId, index) => playerId !== null && previousSlots![index] === null,
      );
      const removed = previousSlots.findIndex(
        (playerId, index) => playerId !== null && current[index] === null,
      );
      if (added >= 0 && slots[added]) {
        announcement = `Placed ${slots[added]!.displayName} at ${SLOT_LABELS[added]}.`;
      } else if (removed >= 0) {
        announcement = `Removed player from ${SLOT_LABELS[removed]}.`;
      }
    }
    previousSlots = current;
  });
</script>

<div id="your-five" class="scroll-mt-4 px-0 sm:px-0">
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
  <div class="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-1 sm:py-3">
    <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">Your five</h2>
    <span class="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
      {filledCount}/5
    </span>
  </div>
  <div class="px-1.5 sm:p-3">
    <div class="court" role="group" aria-label="Your five on the court">
      <span class="court-arc" aria-hidden="true"></span>
      <span class="court-rim" aria-hidden="true"></span>
      {#each SLOT_INDEXES as i (i)}
        {@const player = slots[i] ?? null}
        {@const position = SLOT_POSITIONS[i]}
        {@const label = SLOT_LABELS[i]}
        <div class="slot" id="court-slot-{i}" style="left: {position.left}%; top: {position.top}%">
          {#if player}
            <span class="relative block">
              <button
                type="button"
                aria-label={`Move ${player.displayName} to another position`}
                onclick={() => onmove(player)}
                class="block h-14 w-14 rounded-full border-[3px] border-white/90 bg-[#20242c] shadow-[0_6px_16px_rgba(35,19,5,0.3)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring lg:h-16 lg:w-16"
              >
                <PlayerFace
                  {player}
                  {manifest}
                  size="court"
                  fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                />
              </button>
              <span
                class="absolute top-[-4px] left-[-6px] rounded bg-primary px-1 py-px font-mono text-[9px] font-bold text-primary-foreground"
              >
                {label}
              </span>
              {#if allowRemove}
                <button
                  type="button"
                  aria-label={`Remove ${player.displayName}`}
                  onclick={() => onremove(i)}
                  class="absolute top-[-8px] right-[-8px] z-10 grid h-6 w-6 place-items-center rounded-full border border-border bg-background text-xs font-bold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ×
                </button>
              {/if}
            </span>
            <span class="slot-name">{player.displayName}</span>
          {:else}
            <span
              class="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-white/80 font-display text-xl font-bold text-white/80 lg:h-16 lg:w-16"
            >
              +
            </span>
            <span class="slot-name">Open {label}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  {#if ready}
    <div class="px-1 py-3">
      <p class="text-xs text-muted-foreground">Lineup ready.</p>
    </div>
  {/if}
</div>

<style>
  .court {
    position: relative;
    min-height: 300px;
    overflow: hidden;
    border-radius: 0;
    background: var(--color-court-wood);
    background-image: repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.07) 0 2px,
      transparent 2px 64px
    );
    box-shadow: inset 0 0 70px rgba(78, 39, 6, 0.28);
  }
  @media (min-width: 640px) {
    .court {
      min-height: 410px;
      border-radius: 0.625rem;
    }
  }
  @media (min-width: 1024px) {
    .court {
      min-height: 480px;
    }
  }
  .court::before {
    content: '';
    position: absolute;
    left: 8%;
    right: 8%;
    top: -2px;
    height: 65%;
    border: 2px solid rgba(255, 255, 255, 0.68);
    border-top: 0;
  }
  .court::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -70px;
    width: 150px;
    height: 225px;
    transform: translateX(-50%);
    border: 2px solid rgba(255, 255, 255, 0.68);
    border-radius: 0 0 85px 85px;
  }
  .court-arc {
    position: absolute;
    left: 17%;
    top: -42%;
    width: 66%;
    height: 88%;
    border: 2px solid rgba(255, 255, 255, 0.68);
    border-radius: 50%;
  }
  .court-rim {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 73px;
    width: 52px;
    height: 12px;
    transform: translateX(-50%);
    border: 3px solid var(--color-court-rim);
    border-radius: 50%;
  }
  .slot {
    position: absolute;
    width: 80px;
    transform: translate(-50%, -50%);
    text-align: center;
    scroll-margin-top: 3rem;
    scroll-margin-bottom: 5.5rem;
  }
  @media (min-width: 640px) {
    .slot {
      width: 104px;
    }
  }
  .slot-name {
    display: block;
    margin-top: 5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #241406;
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 800;
    line-height: 1.1;
  }
  @media (min-width: 640px) {
    .slot-name {
      font-size: 11px;
    }
  }
</style>
