<script lang="ts">
  import { Trophy } from '@lucide/svelte';

  let {
    team,
    label,
    celebrate = true,
  }: {
    team: string;
    label: string;
    celebrate?: boolean;
  } = $props();
</script>

<div
  class="relative overflow-hidden rounded-2xl border border-accent/50 bg-accent/10 p-5 sm:p-7 {celebrate
    ? 'trophy-banner'
    : ''}"
  role="status"
>
  {#if celebrate}
    <div class="confetti" aria-hidden="true">
      {#each Array.from({ length: 14 }, (_, index) => index) as piece (piece)}
        <span style="--i:{piece}"></span>
      {/each}
    </div>
  {/if}
  <div class="relative flex items-center gap-4">
    <Trophy size={40} class="shrink-0 text-accent" aria-hidden="true" />
    <div class="min-w-0">
      <p class="ui-label text-accent">{label}</p>
      <h2 class="font-display text-3xl font-extrabold tracking-tight uppercase">
        {team}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Four rounds. Four wins each. The championship is yours.
      </p>
    </div>
  </div>
</div>

<style>
  .trophy-banner {
    animation: trophy-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .confetti {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .confetti span {
    position: absolute;
    top: -10%;
    left: calc((var(--i) + 0.5) * 7%);
    width: 6px;
    height: 10px;
    border-radius: 1px;
    background: var(--color-accent);
    opacity: 0.8;
    animation: confetti-fall 1600ms ease-in both;
    animation-delay: calc(var(--i) * 35ms);
  }
  .confetti span:nth-child(3n) {
    background: var(--color-primary);
  }
  .confetti span:nth-child(4n) {
    background: var(--color-foreground);
  }
  @keyframes trophy-in {
    from {
      transform: translateY(10px) scale(0.98);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes confetti-fall {
    0% {
      transform: translateY(-20%) rotate(0deg);
      opacity: 0;
    }
    15% {
      opacity: 0.9;
    }
    100% {
      transform: translateY(780%) rotate(540deg);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .trophy-banner {
      animation: none;
    }
    .confetti {
      display: none;
    }
  }
</style>
