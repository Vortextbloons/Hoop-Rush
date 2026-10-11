<script lang="ts">
  import { DRAFT_DUEL_ROUND_REVEAL_MS } from '@hoop-rush/data-contracts';

  let { visible, round }: { visible: boolean; round: number } = $props();

  let showing = $state(false);
  const reducedMotion = $derived(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  $effect(() => {
    if (!visible) {
      showing = false;
      return;
    }
    showing = true;
    const timer = setTimeout(() => {
      showing = false;
    }, DRAFT_DUEL_ROUND_REVEAL_MS);
    return () => {
      clearTimeout(timer);
    };
  });
</script>

{#if visible && showing}
  <div
    class="dd-reveal"
    role="status"
    data-reveal-ms={DRAFT_DUEL_ROUND_REVEAL_MS}
    data-reduced-motion={reducedMotion}
    style:--dd-reveal-ms="{DRAFT_DUEL_ROUND_REVEAL_MS}ms"
  >
    <div class="dd-reveal-plate">
      <p class="dd-reveal-eyebrow">Round</p>
      <p class="dd-reveal-round">{round}</p>
      <p class="dd-reveal-caption">of 5 · picks open</p>
      <div class="dd-reveal-track" aria-hidden="true"><span></span></div>
    </div>
  </div>
{/if}

<style>
  .dd-reveal {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: color-mix(in srgb, var(--color-background) 78%, transparent);
    pointer-events: none;
    animation: dd-reveal-in 220ms ease both;
  }

  .dd-reveal-plate {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    padding: 1.5rem 2.5rem 1.35rem;
    border: 1px solid color-mix(in srgb, var(--color-court-wood) 55%, transparent);
    border-radius: 14px;
    background: var(--color-surface-1);
    box-shadow: 0 18px 48px hsl(0 0% 0% / 55%);
    animation: dd-reveal-plate-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .dd-reveal-eyebrow {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.32em;
    text-transform: uppercase;
  }

  .dd-reveal-round {
    color: var(--color-court-wood);
    font-family: var(--font-display);
    font-size: clamp(4.5rem, 18vw, 7rem);
    font-weight: 900;
    letter-spacing: -0.04em;
    line-height: 0.85;
    font-variant-numeric: tabular-nums;
  }

  .dd-reveal-caption {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .dd-reveal-track {
    width: 8.5rem;
    height: 0.35rem;
    margin-top: 0.6rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-surface-3);
  }

  .dd-reveal-track span {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 999px;
    background: var(--color-court-wood);
    transform-origin: left center;
    animation: dd-reveal-progress var(--dd-reveal-ms, 3000ms) linear both;
  }

  @keyframes dd-reveal-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes dd-reveal-plate-in {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes dd-reveal-progress {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dd-reveal,
    .dd-reveal-plate,
    .dd-reveal-track span {
      animation: none;
    }
  }
</style>
