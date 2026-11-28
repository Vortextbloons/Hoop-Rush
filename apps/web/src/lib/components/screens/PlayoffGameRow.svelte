<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    ordinal,
    home,
    won,
    latest,
    score,
    children,
  }: {
    ordinal: number;
    home: boolean;
    won: boolean;
    latest: boolean;
    score: Snippet;
    children?: Snippet;
  } = $props();
</script>

<li
  class={[
    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-soft bg-surface-1 px-3 py-2',
    { latest },
  ]}
>
  <span class="font-mono text-[9px] font-bold text-muted-foreground uppercase">Game {ordinal}</span>
  <span class="font-mono text-[10px] text-muted-foreground uppercase">{home ? 'Home' : 'Away'}</span
  >
  {@render score()}
  <span
    class="rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase {won
      ? 'border-positive/40 bg-positive/10 text-positive'
      : 'border-negative/40 bg-negative/10 text-negative'}">{won ? 'Win' : 'Loss'}</span
  >
  {@render children?.()}
</li>

<style>
  .latest {
    animation: score-in 320ms ease-out both;
  }
  @keyframes score-in {
    from {
      transform: translateY(4px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .latest {
      animation: none;
    }
  }
</style>
