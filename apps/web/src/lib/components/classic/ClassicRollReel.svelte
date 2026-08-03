<script lang="ts">
  import { franchiseAbbreviation, type HoopRushManifest } from '@hoop-rush/data-contracts';
  import { untrack } from 'svelte';
  import TeamLogo from '../TeamLogo.svelte';

  const ROW_HEIGHT_PX = 56;
  const OPTION_REPEATS = 3;
  const SPIN_MS = 900;
  const FADE_MS = 250;

  let {
    manifest,
    franchiseId,
    eraId,
    franchiseOptions,
    eraOptions,
    axis = 'both',
    spinKey = 0,
    announceText,
    reducedMotion,
    onSettled,
  }: {
    manifest: HoopRushManifest;
    franchiseId: string;
    eraId: string;
    franchiseOptions: string[];
    eraOptions: string[];
    axis?: 'both' | 'franchise' | 'era';
    spinKey?: number;
    announceText: string;
    reducedMotion?: boolean;
    onSettled: () => void;
  } = $props();

  let selfDetectedReduced = $state(detectReducedMotion());

  let franchiseSpinning = $state(false);
  let eraSpinning = $state(false);
  let franchiseFading = $state(false);
  let eraFading = $state(false);
  let franchiseStartPx = $state(0);
  let eraStartPx = $state(0);
  let announced = $state('');
  let pulseKey = $state(0);

  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let firstRun = true;

  const franchiseCycle = $derived([...franchiseOptions, ...franchiseOptions, ...franchiseOptions]);
  const eraCycle = $derived([...eraOptions, ...eraOptions, ...eraOptions]);

  function detectReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function franchiseSlotFor(id: string) {
    return manifest.modernFranchiseSlots.find((slot) => slot.franchiseId === id);
  }

  function franchiseNameFor(id: string): string {
    return franchiseSlotFor(id)?.displayName ?? id;
  }

  function eraLabelFor(id: string): string {
    return manifest.eras.find((era) => era.eraId === id)?.label ?? id;
  }

  /** Deterministic fractional jitter per spin so consecutive spins start differently. */
  function jitterFor(key: number): number {
    const frac = key * 0.6180339887498949;
    return frac - Math.floor(frac);
  }

  /** Strip start offset (px) so several option rows pass before the final row locks in. */
  function spinStartPx(optionCount: number, key: number): number {
    const travelRows = optionCount * OPTION_REPEATS - 1 + jitterFor(key);
    return -(travelRows * ROW_HEIGHT_PX);
  }

  function startSpin(key: number) {
    const params = untrack(() => ({
      axis,
      franchiseOptions,
      eraOptions,
      reduced: reducedMotion ?? selfDetectedReduced,
    }));

    const franchiseActive = params.axis === 'both' || params.axis === 'franchise';
    const eraActive = params.axis === 'both' || params.axis === 'era';
    const franchiseMoves = franchiseActive && params.franchiseOptions.length > 0;
    const eraMoves = eraActive && params.eraOptions.length > 0;

    franchiseStartPx = franchiseMoves ? spinStartPx(params.franchiseOptions.length, key) : 0;
    eraStartPx = eraMoves ? spinStartPx(params.eraOptions.length, key) : 0;

    const franchiseStrip = franchiseMoves && !params.reduced;
    const eraStrip = eraMoves && !params.reduced;

    franchiseSpinning = franchiseStrip;
    eraSpinning = eraStrip;
    franchiseFading = franchiseActive && !franchiseStrip;
    eraFading = eraActive && !eraStrip;
    announced = '';

    const duration = params.reduced || (!franchiseStrip && !eraStrip) ? FADE_MS : SPIN_MS;

    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(settle, duration);
  }

  function settle() {
    pendingTimer = null;
    franchiseSpinning = false;
    eraSpinning = false;
    franchiseFading = false;
    eraFading = false;
    pulseKey += 1;
    announced = announceText;
    onSettled();
  }

  $effect(() => {
    const key = spinKey;
    if (firstRun) {
      firstRun = false;
      return;
    }
    startSpin(key);
    return () => {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };
  });
</script>

<div class="flex items-stretch gap-3">
  <div class="reel min-w-0 flex-1" data-axis="franchise" aria-hidden="true">
    <div class="reel-window {franchiseSpinning || franchiseFading ? 'reel-window--active' : ''}">
      <div
        class="reel-strip {franchiseSpinning ? 'reel-spinning' : ''} {franchiseFading
          ? 'reel-fade'
          : ''}"
        style={franchiseSpinning
          ? `--spin-start: ${franchiseStartPx}px; --spin-settle: 0px;`
          : undefined}
      >
        <div class="reel-row reel-row--final">
          {#key pulseKey}
            <div class="reel-lock {pulseKey > 0 ? 'reel-lock--active' : ''}">
              {@render franchiseRow(franchiseId)}
            </div>
          {/key}
        </div>
        {#each franchiseCycle as optionId, i (i)}
          <div class="reel-row reel-row--option">{@render franchiseRow(optionId)}</div>
        {/each}
      </div>
    </div>
  </div>

  <div class="reel w-36 shrink-0" data-axis="era" aria-hidden="true">
    <div class="reel-window {eraSpinning || eraFading ? 'reel-window--active' : ''}">
      <div
        class="reel-strip {eraSpinning ? 'reel-spinning' : ''} {eraFading ? 'reel-fade' : ''}"
        style={eraSpinning ? `--spin-start: ${eraStartPx}px; --spin-settle: 0px;` : undefined}
      >
        <div class="reel-row reel-row--final">
          {#key pulseKey}
            <div class="reel-lock {pulseKey > 0 ? 'reel-lock--active' : ''}">
              {@render eraRow(eraId)}
            </div>
          {/key}
        </div>
        {#each eraCycle as optionId, i (i)}
          <div class="reel-row reel-row--option">{@render eraRow(optionId)}</div>
        {/each}
      </div>
    </div>
  </div>

  <p class="sr-only" aria-live="polite">{announced}</p>
</div>

{#snippet franchiseRow(id: string)}
  {@const slot = franchiseSlotFor(id)}
  {#if slot}
    <TeamLogo
      {manifest}
      franchiseId={id}
      teamExternalId={slot.teamExternalId}
      alt=""
      className="h-6 w-6"
    />
  {/if}
  <span class="reel-abbrev">{franchiseAbbreviation(id)}</span>
  <span class="reel-name">{franchiseNameFor(id)}</span>
{/snippet}

{#snippet eraRow(id: string)}
  <span class="reel-era-label">{eraLabelFor(id)}</span>
{/snippet}

<style>
  .reel {
    --reel-row-h: 56px;
    position: relative;
    min-width: 0;
  }

  .reel-window {
    position: relative;
    height: var(--reel-row-h);
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.35);
  }

  .reel-window--active {
    box-shadow:
      inset 0 2px 10px rgba(0, 0, 0, 0.35),
      0 0 20px rgba(240, 77, 34, 0.35);
  }

  .reel-window::before,
  .reel-window::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 34%;
    z-index: 2;
    pointer-events: none;
  }

  .reel-window::before {
    top: 0;
    background: linear-gradient(to bottom, rgba(9, 12, 17, 0.95), rgba(9, 12, 17, 0));
  }

  .reel-window::after {
    bottom: 0;
    background: linear-gradient(to top, rgba(9, 12, 17, 0.95), rgba(9, 12, 17, 0));
  }

  .reel-strip {
    will-change: transform;
  }

  .reel-strip.reel-spinning {
    animation: reel-spin 900ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .reel-strip.reel-fade {
    animation: reel-fade 250ms ease-out both;
  }

  .reel-spinning .reel-row {
    filter: blur(1.5px);
  }

  .reel-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: var(--reel-row-h);
    padding: 0 18px;
    white-space: nowrap;
  }

  .reel-lock {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 0;
  }

  .reel-lock--active {
    animation: reel-lock 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .reel-row--final {
    color: #fff;
    font-weight: 800;
    text-shadow: 0 0 14px rgba(240, 77, 34, 0.45);
    box-shadow: inset 0 0 24px rgba(240, 77, 34, 0.12);
  }

  .reel-row--option {
    color: rgba(255, 255, 255, 0.62);
  }

  .reel-abbrev {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  .reel-row--final .reel-abbrev {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.85);
  }

  .reel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-display);
    font-size: 13px;
  }

  .reel-row--final .reel-name {
    font-size: 14px;
  }

  .reel-era-label {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
  }

  .reel-row--final .reel-era-label {
    font-size: 16px;
  }

  @keyframes reel-spin {
    from {
      transform: translateY(var(--spin-start, 0));
    }
    to {
      transform: translateY(var(--spin-settle, 0));
    }
  }

  @keyframes reel-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes reel-lock {
    0% {
      transform: scale(1.07);
      filter: brightness(1.45);
    }
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
  }
</style>
