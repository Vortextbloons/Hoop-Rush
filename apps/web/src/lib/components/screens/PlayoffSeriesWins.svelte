<script lang="ts">
  let { wins, won }: { wins: number; won: boolean } = $props();
</script>

{#key wins}
  <span
    class="series-wins font-display block text-4xl font-extrabold leading-none tabular-nums {won
      ? 'text-accent'
      : 'text-foreground'}">{wins}</span
  >
{/key}

<style>
  .series-wins {
    animation: win-bump 280ms ease-out;
  }
  @keyframes win-bump {
    0% {
      transform: scale(1.35);
      color: var(--color-accent);
    }
    100% {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .series-wins {
      animation: none;
    }
  }
</style>
