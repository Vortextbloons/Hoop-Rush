<script lang="ts">import { franchiseAbbreviation, resolveEraTeamIdentity, type HoopRushManifest, } from '@hoop-rush/data-contracts';
import { untrack } from 'svelte';
import TeamLogo from '../TeamLogo.svelte';
const REEL_ROW_HEIGHT_PX = 108;
const OPTION_REPEATS = 3;
const SPIN_MS = 2000;
const RESULT_MS = 800;
const FADE_MS = 250;
let { manifest, franchiseId, eraId, franchiseOptions, eraOptions, axis = 'both', spinKey = 0, spotlight = null, announceText, roundLabel = '', reducedMotion, spinDurationMs, onSettled, }: {
    manifest: HoopRushManifest;
    franchiseId: string;
    eraId: string;
    franchiseOptions: string[];
    eraOptions: string[];
    axis?: 'both' | 'franchise' | 'era';
    spinKey?: number;
    spotlight?: 'you' | 'rival' | null;
    announceText: string;
    roundLabel?: string;
    reducedMotion?: boolean;
    spinDurationMs?: number;
    onSettled: () => void;
} = $props();
let selfDetectedReduced = $state(detectReducedMotion());
let phase = $state<'idle' | 'spinning' | 'settled'>('idle');
let franchiseSpinning = $state(false);
let eraSpinning = $state(false);
let franchiseFading = $state(false);
let eraFading = $state(false);
let franchiseStartPx = $state(0);
let eraStartPx = $state(0);
let activeSpinDurationMs = $state(SPIN_MS);
let announced = $state('');
let pulseKey = $state(0);
let spinTimer: ReturnType<typeof setTimeout> | null = null;
let resultTimer: ReturnType<typeof setTimeout> | null = null;
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
function franchiseIdentityFor(id: string) {
    return resolveEraTeamIdentity(manifest, id, eraId);
}
function franchiseNameFor(id: string): string {
    return franchiseIdentityFor(id).displayLabel ?? franchiseSlotFor(id)?.displayName ?? id;
}
function franchiseAbbreviationFor(id: string): string {
    return franchiseIdentityFor(id).abbreviationLabel ?? franchiseAbbreviation(id);
}
function eraLabelFor(id: string): string {
    return manifest.eras.find((era) => era.eraId === id)?.label ?? id;
}
function jitterFor(key: number): number {
    const frac = key * 0.6180339887498949;
    return frac - Math.floor(frac);
}
function spinStartPx(optionCount: number, key: number, rowHeightPx: number): number {
    const travelRows = optionCount * OPTION_REPEATS - 1 + jitterFor(key);
    return -(travelRows * rowHeightPx);
}
function clearTimers() {
    if (spinTimer !== null) {
        clearTimeout(spinTimer);
        spinTimer = null;
    }
    if (resultTimer !== null) {
        clearTimeout(resultTimer);
        resultTimer = null;
    }
}
function startSpin(key: number) {
    const params = untrack(() => ({
        axis,
        franchiseOptions,
        eraOptions,
        reduced: reducedMotion ?? selfDetectedReduced,
        spinDurationMs,
    }));
    const franchiseActive = params.axis === 'both' || params.axis === 'franchise';
    const eraActive = params.axis === 'both' || params.axis === 'era';
    const franchiseMoves = franchiseActive && params.franchiseOptions.length > 0;
    const eraMoves = eraActive && params.eraOptions.length > 0;
    franchiseStartPx = franchiseMoves
        ? spinStartPx(params.franchiseOptions.length, key, REEL_ROW_HEIGHT_PX)
        : 0;
    eraStartPx = eraMoves
        ? spinStartPx(params.eraOptions.length, key, REEL_ROW_HEIGHT_PX)
        : 0;
    const franchiseStrip = franchiseMoves && !params.reduced;
    const eraStrip = eraMoves && !params.reduced;
    clearTimers();
    phase = 'spinning';
    franchiseSpinning = franchiseStrip;
    eraSpinning = eraStrip;
    franchiseFading = franchiseActive && !franchiseStrip;
    eraFading = eraActive && !eraStrip;
    announced = '';
    activeSpinDurationMs = params.spinDurationMs ?? SPIN_MS;
    const franchiseDuration = franchiseStrip ? activeSpinDurationMs : 0;
    const eraDuration = eraStrip ? activeSpinDurationMs : 0;
    const duration = params.reduced || (!franchiseStrip && !eraStrip)
        ? FADE_MS
        : Math.max(franchiseDuration, eraDuration);
    spinTimer = setTimeout(settle, duration);
}
function settle() {
    spinTimer = null;
    franchiseSpinning = false;
    eraSpinning = false;
    franchiseFading = false;
    eraFading = false;
    pulseKey += 1;
    announced = announceText;
    phase = 'settled';
    const reduced = reducedMotion ?? selfDetectedReduced;
    resultTimer = setTimeout(finish, reduced ? FADE_MS : RESULT_MS);
}
function finish() {
    if (resultTimer !== null) {
        clearTimeout(resultTimer);
        resultTimer = null;
    }
    phase = 'idle';
    onSettled();
}
$effect(() => {
    const key = spinKey;
    const isFirst = firstRun;
    firstRun = false;
    if (!isFirst || key > 0) {
        startSpin(key);
    }
    return () => {
        clearTimers();
    };
});
</script>

{#if phase !== 'idle'}
  <div
    class="roll-overlay {phase === 'settled' ? 'roll-overlay--ready' : ''}"
    role="button"
    tabindex="0"
    aria-label={phase === 'settled' ? 'Show the rolled pool' : 'Roll in progress'}
    onclick={phase === 'settled' ? finish : undefined}
    onkeydown={(event) => {
      if (phase === 'settled' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        finish();
      }
    }}
  >
    <div class="roll-stage {spotlight ? `roll-stage--${spotlight}` : ''}">
      {#if spotlight}
        <p class="roll-spot roll-spot--{spotlight}">
          {spotlight === 'you' ? 'Your roll' : "Rival's roll"}
        </p>
      {/if}
      <p class="roll-round">{roundLabel}</p>
      {#if phase === 'spinning'}
        <div class="reels">
          <div class="reel min-w-0 flex-1" data-axis="franchise" aria-hidden="true">
            <div
              class="reel-window {franchiseSpinning || franchiseFading
                ? 'reel-window--active'
                : ''}"
            >
              <span class="reel-payline" aria-hidden="true"></span>
              <div
                class="reel-strip {franchiseSpinning ? 'reel-spinning' : ''} {franchiseFading
                  ? 'reel-fade'
                  : ''}"
                style={franchiseSpinning
                  ? `--spin-start: ${franchiseStartPx}px; --spin-settle: 0px; --spin-duration: ${activeSpinDurationMs}ms;`
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

          <div class="reel reel--era shrink-0" data-axis="era" aria-hidden="true">
            <div class="reel-window {eraSpinning || eraFading ? 'reel-window--active' : ''}">
              <span class="reel-payline" aria-hidden="true"></span>
              <div
                class="reel-strip {eraSpinning ? 'reel-spinning' : ''} {eraFading
                  ? 'reel-fade'
                  : ''}"
                style={eraSpinning
                  ? `--spin-start: ${eraStartPx}px; --spin-settle: 0px; --spin-duration: ${activeSpinDurationMs}ms;`
                  : undefined}
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
        </div>
        <p class="roll-caption">Rolling…</p>
      {:else}
        <div class="roll-result roll-result--{axis}" aria-hidden="true">
          <div class="reel-lock reel-lock--active">
            {@render franchiseRow(franchiseId)}
            <span class="roll-result-divider" aria-hidden="true"></span>
            {@render eraRow(eraId)}
          </div>
        </div>
        <p class="roll-caption">Your pool is ready</p>
        <button
          type="button"
          class="roll-continue"
          onclick={(event) => {
            event.stopPropagation();
            finish();
          }}>Continue</button
        >
      {/if}
      <p class="sr-only" aria-live="polite">{announced}</p>
    </div>
  </div>
{/if}

{#snippet franchiseRow(id: string)}
  {@const slot = franchiseSlotFor(id)}
  {@const identity = franchiseIdentityFor(id)}
  <div class="reel-franchise">
    {#if slot}
      <TeamLogo
        {manifest}
        franchiseId={id}
        teamExternalId={slot.teamExternalId}
        logoCandidates={identity.logoCandidates}
        alt=""
        className="reel-franchise-logo"
      />
    {/if}
    <span class="reel-franchise-text">
      <span class="reel-abbrev">{franchiseAbbreviationFor(id)}</span>
      <span class="reel-name">{franchiseNameFor(id)}</span>
    </span>
  </div>
{/snippet}

{#snippet eraRow(id: string)}
  <span class="reel-era-label">{eraLabelFor(id)}</span>
{/snippet}

<style>
  .roll-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right))
      max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
    background: rgba(9, 12, 17, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    touch-action: manipulation;
    overflow: hidden;
  }

  .roll-overlay--ready {
    cursor: pointer;
  }

  .roll-stage {
    width: min(560px, 100%);
    max-width: 100%;
    overflow: hidden;
    border-radius: 1.25rem;
    border: 1px solid var(--color-border-strong);
    background: var(--color-card);
    padding: 1.5rem;
    box-shadow:
      0 0 60px color-mix(in srgb, var(--color-court-rim) 18%, transparent),
      0 24px 60px rgba(0, 0, 0, 0.5);
    animation: roll-stage-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .roll-round {
    text-align: center;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
    margin-bottom: 0.875rem;
  }

  .reels {
    display: flex;
    align-items: stretch;
    gap: 12px;
  }

  .reel {
    --reel-row-h: 108px;
    position: relative;
    min-width: 0;
  }

  .reel--era {
    width: 6.25rem;
  }

  .reel-window {
    position: relative;
    height: var(--reel-row-h);
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.045);
    box-shadow: inset 0 2px 14px rgba(0, 0, 0, 0.4);
  }

  .reel-window::before,
  .reel-window::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 38%;
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

  .reel-payline {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 2px;
    transform: translateY(-50%);
    z-index: 3;
    pointer-events: none;
    background: linear-gradient(
      to right,
      transparent,
      color-mix(in srgb, var(--color-court-rim) 85%, transparent) 18%,
      color-mix(in srgb, var(--color-court-rim) 85%, transparent) 82%,
      transparent
    );
    box-shadow: 0 0 12px color-mix(in srgb, var(--color-court-rim) 60%, transparent);
  }

  .reel-window--active {
    box-shadow:
      inset 0 2px 14px rgba(0, 0, 0, 0.4),
      0 0 26px color-mix(in srgb, var(--color-court-rim) 40%, transparent);
  }

  .reel-strip {
    will-change: transform;
  }

  .reel-strip.reel-spinning {
    animation: reel-spin var(--spin-duration, 2000ms) cubic-bezier(0.16, 1, 0.3, 1) both;
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
    gap: 12px;
    height: var(--reel-row-h);
    padding: 0 16px;
    white-space: nowrap;
  }

  .reel[data-axis='franchise'] .reel-strip {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .reel[data-axis='franchise'] .reel-strip.reel-spinning {
    animation: reel-spin var(--spin-duration, 2000ms) cubic-bezier(0.12, 0.92, 0.22, 1) both;
  }

  .reel[data-axis='franchise'] .reel-row {
    width: auto;
    flex-shrink: 0;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 0 10px;
    overflow: hidden;
  }

  .reel[data-axis='franchise'] .reel-franchise {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-align: center;
    width: 100%;
    min-height: 0;
  }

  .reel[data-axis='franchise'] .reel-franchise-text {
    align-items: center;
    flex: 0 1 auto;
    width: 100%;
  }

  .reel[data-axis='franchise'] :global(.reel-franchise-logo) {
    height: 2rem;
    width: 2rem;
  }

  .reel[data-axis='franchise'] .reel-name {
    font-size: 13px;
  }

  .reel[data-axis='franchise'] .reel-row--final .reel-name {
    font-size: 14px;
  }

  .reel[data-axis='era'] .reel-row--option {
    position: relative;
  }

  .reel[data-axis='era'] .reel-row--option::before {
    content: '';
    position: absolute;
    left: 12px;
    top: 50%;
    width: 8px;
    height: 2px;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.35);
  }

  .reel[data-axis='era'] .reel-row--option::after {
    content: '';
    position: absolute;
    right: 12px;
    top: 50%;
    width: 8px;
    height: 2px;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.35);
  }

  .reel-franchise {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-width: 0;
  }

  :global(.reel-franchise-logo) {
    height: 2.5rem;
    width: 2.5rem;
    flex-shrink: 0;
  }

  .reel-franchise-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .reel-lock {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: 100%;
    min-width: 0;
    min-height: 0;
  }

  .reel[data-axis='franchise'] .reel-lock {
    flex-direction: column;
    gap: 4px;
  }

  .reel-lock--active {
    animation: reel-lock 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .reel-row--final {
    color: #fff;
    font-weight: 800;
    text-shadow: 0 0 18px color-mix(in srgb, var(--color-court-rim) 50%, transparent);
    box-shadow: inset 0 0 30px color-mix(in srgb, var(--color-court-rim) 12%, transparent);
  }

  .reel-row--option {
    color: rgba(255, 255, 255, 0.6);
  }

  .reel-abbrev {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
  }

  .reel-row--final .reel-abbrev {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.9);
  }

  .reel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    line-height: 1.15;
  }

  .reel-row--final .reel-name {
    font-size: 17px;
  }

  .reel-era-label {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
  }

  .reel-row--final .reel-era-label {
    font-size: 22px;
  }

  .roll-result {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 84px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--color-court-rim) 35%, transparent);
    background: radial-gradient(
      ellipse at center,
      color-mix(in srgb, var(--color-court-rim) 14%, transparent),
      color-mix(in srgb, var(--color-court-rim) 2%, transparent) 70%
    );
    box-shadow: 0 0 34px color-mix(in srgb, var(--color-court-rim) 25%, transparent);
    padding: 0 16px;
    animation: roll-result-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .roll-result .reel-lock {
    gap: 16px;
  }

  .roll-result .reel-franchise {
    flex: 1;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .roll-result .reel-franchise-text {
    align-items: center;
  }

  .roll-result .reel-abbrev {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.9);
  }

  .roll-result .reel-name {
    font-size: 18px;
  }

  .roll-result .reel-era-label {
    font-size: 24px;
  }

  .roll-result-divider {
    width: 1px;
    height: 34px;
    background: rgba(255, 255, 255, 0.18);
  }

  .roll-result--franchise {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    box-shadow: 0 0 48px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  .roll-result--franchise .reel-lock--active {
    animation: wall-slam 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .roll-result--era {
    border-style: dashed;
    transform: rotate(-0.5deg);
  }

  .roll-spot {
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    margin-bottom: 0.375rem;
  }

  .roll-spot--you {
    color: var(--color-primary);
  }

  .roll-spot--rival {
    color: var(--color-destructive);
  }

  .roll-stage--you {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    box-shadow:
      0 0 60px color-mix(in srgb, var(--color-primary) 25%, transparent),
      0 24px 60px rgba(0, 0, 0, 0.5);
  }

  .roll-stage--rival {
    border-color: color-mix(in srgb, var(--color-destructive) 55%, transparent);
    box-shadow:
      0 0 60px color-mix(in srgb, var(--color-destructive) 22%, transparent),
      0 24px 60px rgba(0, 0, 0, 0.5);
  }

  .roll-caption {
    margin-top: 0.875rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .roll-continue {
    display: flex;
    margin: 0.875rem auto 0;
    min-height: 2.75rem;
    min-width: 10rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.625rem;
    border: 0;
    background: var(--color-primary);
    padding: 0.625rem 1.25rem;
    font-family: var(--font-display);
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-primary-foreground);
    cursor: pointer;
    outline: none;
    touch-action: manipulation;
  }

  .roll-continue:focus-visible {
    box-shadow: 0 0 0 2px var(--color-ring);
  }

  @media (min-width: 640px) {
    .roll-overlay {
      padding: 1.5rem;
    }

    .reel--era {
      width: 10rem;
    }
  }

  @media (max-width: 639px) {
    .roll-stage {
      padding: 1rem;
      border-radius: 1rem;
    }

    .reels {
      gap: 8px;
    }

    .reel-row {
      gap: 8px;
      padding: 0 10px;
    }

    :global(.reel-franchise-logo) {
      height: 2rem;
      width: 2rem;
    }

    .reel-name {
      font-size: 13px;
    }

    .reel-row--final .reel-name {
      font-size: 14px;
    }

    .reel-era-label {
      font-size: 15px;
    }

    .reel-row--final .reel-era-label {
      font-size: 18px;
    }

    .roll-result {
      min-height: auto;
      padding: 12px;
    }

    .roll-result .reel-lock {
      flex-direction: column;
      gap: 10px;
    }

    .roll-result-divider {
      width: 3rem;
      height: 1px;
    }

    .roll-result .reel-name {
      font-size: 15px;
      text-align: center;
    }

    .roll-result .reel-era-label {
      font-size: 20px;
    }

    .roll-result .reel-franchise {
      justify-content: center;
    }
  }

  @keyframes roll-stage-in {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes roll-result-in {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes reel-spin {
    from {
      transform: translateY(var(--spin-start, 0));
    }
    to {
      transform: translateY(var(--spin-settle, 0));
    }
  }

  @keyframes wall-slam {
    0% {
      transform: scale(1.12) rotate(-1deg);
      filter: brightness(1.6);
    }
    100% {
      transform: scale(1) rotate(0deg);
      filter: brightness(1);
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
