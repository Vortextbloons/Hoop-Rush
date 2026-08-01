<script lang="ts">
  import type { FranchiseEraPool, HoopRushManifest } from '@hoop-rush/data-contracts';
  import PlayerFace from './PlayerFace.svelte';

  type PeakPlayer = FranchiseEraPool['players'][number];

  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const SLOT_NAMES = [
    'Point Guard',
    'Shooting Guard',
    'Small Forward',
    'Power Forward',
    'Center',
  ] as const;
  const SLOT_POSITIONS = [
    { left: 50, top: 77 },
    { left: 22, top: 55 },
    { left: 78, top: 55 },
    { left: 34, top: 29 },
    { left: 66, top: 29 },
  ] as const;
  const SLOT_INDEXES = [0, 1, 2, 3, 4] as const;

  let {
    slots,
    manifest,
    ready,
    onmove,
    onremove,
  }: {
    slots: (PeakPlayer | null)[];
    manifest: HoopRushManifest;
    ready: boolean;
    onmove: (player: PeakPlayer) => void;
    onremove: (index: number) => void;
  } = $props();

  const filledCount = $derived(slots.filter((p) => p !== null).length);
</script>

<div id="your-five" class="scroll-mt-4 rounded-xl border border-border bg-card">
  <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
    <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">Your five</h2>
    <span class="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
      {filledCount}/5
    </span>
  </div>
  <div class="p-2 sm:p-3">
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
              <button
                type="button"
                aria-label={`Remove ${player.displayName}`}
                onclick={() => onremove(i)}
                class="absolute top-[-8px] right-[-8px] z-10 grid h-6 w-6 place-items-center rounded-full border border-border bg-background text-xs font-bold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                ×
              </button>
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
    <div class="border-t border-border px-4 py-3">
      <p
        class="rounded-lg border border-line-strong bg-surface-2 p-3 text-xs text-muted-foreground"
      >
        Lineup ready.
      </p>
    </div>
  {/if}
</div>

<style>
  .court {
    position: relative;
    min-height: 340px;
    overflow: hidden;
    border-radius: 0.625rem;
    background: #c98c45;
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
    border: 3px solid #f04d22;
    border-radius: 50%;
  }
  .slot {
    position: absolute;
    width: 80px;
    transform: translate(-50%, -50%);
    text-align: center;
    scroll-margin-top: 3rem;
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
