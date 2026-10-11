<script lang="ts">
  let {
    consideration,
  }: {
    consideration: { displayName: string; seasonKey: string } | null;
  } = $props();
</script>

{#if consideration}
  <p class="dd-consideration" role="status" data-selected-player={consideration.displayName}>
    <span class="dd-consideration-eyebrow">Rival considering</span>
    <span class="dd-consideration-name">{consideration.displayName}</span>
    <span class="dd-consideration-season">{consideration.seasonKey}</span>
  </p>
{/if}

<style>
  .dd-consideration {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.4rem 0.65rem;
    border: 1px dashed color-mix(in srgb, var(--color-primary) 45%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
    animation: dd-consideration-in 160ms ease both;
  }

  .dd-consideration-eyebrow {
    flex: none;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .dd-consideration-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dd-consideration-season {
    flex: none;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  @keyframes dd-consideration-in {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dd-consideration {
      animation: none;
    }
  }
</style>
