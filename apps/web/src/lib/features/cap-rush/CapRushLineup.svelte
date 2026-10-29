<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import { Crown } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatMillions, initialsOf } from './cap-rush-presentation.ts';

  let { slots, art = null }: { slots: CapRushDraftView['slots']; art?: CapRushArt | null } =
    $props();
  const filled = $derived(slots.filter((slot) => slot.player !== null).length);
  const positions = [
    { left: 50, top: 78 },
    { left: 78, top: 57 },
    { left: 22, top: 57 },
    { left: 72, top: 29 },
    { left: 36, top: 29 },
  ];
</script>

<section aria-label="Your lineup" class="min-w-0">
  <div class="flex items-center justify-between gap-3 px-1 py-3">
    <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">Your five</h2>
    <span class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
      >{filled}/5</span
    >
  </div>
  <div class="court" role="group" aria-label="Your five on the court">
    <span class="court-arc" aria-hidden="true"></span>
    <span class="court-rim" aria-hidden="true"></span>
    {#each slots as slot, i (slot.slot)}
      {@const player = slot.player}
      {@const face = art !== null && player !== null ? art.faceFor(player) : null}
      <div
        class="court-slot"
        style:left={`${positions[i]?.left}%`}
        style:top={`${positions[i]?.top}%`}
      >
        <div class="relative inline-block">
          {#if player !== null}
            <span
              class="block h-14 w-14 overflow-hidden rounded-full border-[3px] border-white/90 bg-[#20242c] shadow-lg sm:h-16 sm:w-16"
            >
              {#if face !== null && art !== null}
                <PlayerFace
                  player={face}
                  manifest={art.manifest}
                  size="court"
                  fallbackInitials={initialsOf(player.displayName)}
                />
              {:else}
                <span
                  class="grid h-full w-full place-items-center font-display text-sm font-extrabold text-white"
                  >{initialsOf(player.displayName)}</span
                >
              {/if}
            </span>
          {:else}
            <span
              class="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-white/80 font-display text-xl font-bold text-white/80 sm:h-16 sm:w-16"
              >+</span
            >
          {/if}
          <span
            class="absolute -top-1 -left-1 rounded bg-primary px-1 py-px font-mono text-[9px] font-bold text-primary-foreground"
            >{slot.slot}</span
          >
          {#if slot.highestPaid}<span
              class="absolute -top-1 -right-1 rounded-full bg-card p-1 text-accent"
              title="Highest-paid player"
              ><Crown size={12} aria-hidden="true" /><span class="sr-only">Highest-paid player</span
              ></span
            >{/if}
        </div>
        <span class="slot-name">{player?.displayName ?? `Open ${slot.slot}`}</span>
        {#if player}<span class="slot-salary">{formatMillions(slot.salaryDollars)}</span>{/if}
      </div>
    {/each}
  </div>
</section>

<style>
  .court {
    position: relative;
    min-height: 300px;
    overflow: hidden;
    border-radius: 0.625rem;
    background: var(--color-court-wood);
    background-image: repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.07) 0 2px,
      transparent 2px 64px
    );
    box-shadow: inset 0 0 70px rgba(78, 39, 6, 0.28);
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
  .court-slot {
    position: absolute;
    z-index: 3;
    width: 92px;
    transform: translate(-50%, -50%);
    text-align: center;
  }
  .slot-name,
  .slot-salary {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #241406;
    font-weight: 800;
    line-height: 1.15;
  }
  .slot-name {
    margin-top: 4px;
    font-family: var(--font-display);
    font-size: 10px;
  }
  .slot-salary {
    font-family: var(--font-mono);
    font-size: 9px;
  }
  @media (min-width: 640px) {
    .court {
      min-height: 410px;
    }
    .court-slot {
      width: 104px;
    }
    .slot-name {
      font-size: 11px;
    }
  }
</style>
