<script lang="ts">
  import { arenaRivalTurn, arenaYourTurn } from '$lib/arena-sound';
  let {
    turn,
    label = '',
    ordinal = 0,
    total = 10,
    mode = 'duel',
  }: {
    turn: 'you' | 'rival' | null;
    label?: string;
    ordinal?: number;
    total?: number;
    mode?: string;
  } = $props();

  let lastTurn = $state<string | null>(null);
  let slamKey = $state(0);

  $effect(() => {
    if (turn && turn !== lastTurn) {
      lastTurn = turn;
      slamKey += 1;
      if (turn === 'you') arenaYourTurn();
      else arenaRivalTurn();
    }
    if (!turn) lastTurn = null;
  });
</script>

{#if turn}
  {#key slamKey}
    <div
      class="turn-veil {turn === 'you' ? 'turn-veil--you' : 'turn-veil--rival'}"
      role="status"
      aria-live="polite"
      aria-label={turn === 'you' ? `Your pick, ${label}` : `Rival picking, ${label}`}
    >
      <span class="turn-sweep" aria-hidden="true"></span>
      <span class="turn-flood turn-flood--a" aria-hidden="true"></span>
      <span class="turn-flood turn-flood--b" aria-hidden="true"></span>
      <div class="turn-inner">
        <p class="turn-kicker">
          <span class="turn-dot" aria-hidden="true"></span>
          {mode === 'duel'
            ? 'Duel draft'
            : mode === 'sandbox-shared-82'
              ? 'Sandbox build'
              : 'Shared draft'}
          · {ordinal + 1}/{total}
        </p>
        <p class="turn-jumbo">{turn === 'you' ? 'You’re up' : 'Rival’s pick'}</p>
        <p class="turn-sub">{label}</p>
        <div class="turn-rail" aria-hidden="true">
          {#each Array.from({ length: total }, (_, i) => i) as i (i)}
            <span
              class="turn-pip"
              data-done={i < ordinal ? 'true' : 'false'}
              data-now={i === ordinal ? 'true' : 'false'}
            ></span>
          {/each}
        </div>
      </div>
    </div>
  {/key}
{/if}

<style>
  .turn-veil {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    border-radius: 1rem;
    border: 1px solid var(--color-border);
    padding: 0.9rem 1rem 0.8rem;
    background: var(--color-surface-1);
    animation: veil-slam 0.38s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .turn-veil--you {
    border-color: color-mix(in srgb, var(--color-primary) 60%, transparent);
    box-shadow:
      0 0 34px color-mix(in srgb, var(--color-primary) 28%, transparent),
      inset 0 3px 0 0 var(--color-primary);
  }
  .turn-veil--rival {
    border-color: color-mix(in srgb, var(--color-destructive) 55%, transparent);
    box-shadow:
      0 0 30px color-mix(in srgb, var(--color-destructive) 22%, transparent),
      inset 0 3px 0 0 var(--color-destructive);
  }
  .turn-inner {
    position: relative;
    z-index: 2;
  }
  .turn-kicker {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .turn-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: currentColor;
    animation: dot-blink 1s ease-in-out infinite;
  }
  .turn-veil--you .turn-dot {
    color: var(--color-primary);
    box-shadow: 0 0 12px var(--color-primary);
  }
  .turn-veil--rival .turn-dot {
    color: var(--color-destructive);
    box-shadow: 0 0 12px var(--color-destructive);
  }
  .turn-jumbo {
    font-family: var(--font-display);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: -0.04em;
    line-height: 0.9;
    font-size: clamp(2.2rem, 7vw, 3.4rem);
    margin-top: 0.15rem;
    animation: jumbo-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .turn-veil--you .turn-jumbo {
    color: var(--color-foreground);
    text-shadow: 0 0 24px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }
  .turn-veil--rival .turn-jumbo {
    color: var(--color-muted-foreground);
  }
  .turn-sub {
    margin-top: 0.2rem;
    font-size: 12px;
    color: var(--color-muted-foreground);
  }
  .turn-rail {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.6rem;
  }
  .turn-pip {
    height: 0.4rem;
    flex: 1;
    border-radius: 999px;
    background: var(--color-surface-3);
    border: 1px solid var(--color-border);
  }
  .turn-pip[data-done='true'] {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
  .turn-pip[data-now='true'] {
    background: var(--color-accent);
    border-color: var(--color-accent);
    animation: pip-pulse 1s ease-in-out infinite;
  }
  .turn-veil--rival .turn-pip[data-done='true'] {
    background: var(--color-destructive);
    border-color: var(--color-destructive);
  }
  .turn-sweep {
    position: absolute;
    inset: -40% -20%;
    z-index: 1;
    background: linear-gradient(
      100deg,
      transparent 42%,
      color-mix(in srgb, white 16%, transparent) 50%,
      transparent 58%
    );
    animation: sweep 0.9s ease both;
    pointer-events: none;
  }
  .turn-flood {
    position: absolute;
    top: -30%;
    width: 46%;
    height: 160%;
    z-index: 0;
    opacity: 0.14;
    filter: blur(18px);
    pointer-events: none;
  }
  .turn-flood--a {
    left: -10%;
    transform: rotate(14deg);
    background: var(--color-primary);
  }
  .turn-flood--b {
    right: -10%;
    transform: rotate(-14deg);
    background: var(--color-accent);
  }
  .turn-veil--rival .turn-flood--a {
    background: var(--color-destructive);
  }
  @keyframes veil-slam {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  @keyframes jumbo-in {
    from {
      opacity: 0;
      clip-path: inset(0 60% 0 0);
      transform: translateX(-12px) skewX(-6deg);
    }
    to {
      opacity: 1;
      clip-path: inset(0 0 0 0);
      transform: translateX(0) skewX(0);
    }
  }
  @keyframes sweep {
    from {
      transform: translateX(-60%);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    to {
      transform: translateX(60%);
      opacity: 0;
    }
  }
  @keyframes pip-pulse {
    0%,
    100% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(1.7);
    }
  }
  @keyframes dot-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .turn-veil,
    .turn-jumbo,
    .turn-sweep,
    .turn-dot,
    .turn-pip[data-now='true'] {
      animation: none;
    }
  }
</style>
