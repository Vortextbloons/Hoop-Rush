<script lang="ts">
  import type { Snippet } from 'svelte';
  import DialogShell from '#lib/components/DialogShell.svelte';

  let {
    open,
    onOpenChange,
    header,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    header: Snippet;
    children: Snippet;
  } = $props();
</script>

<DialogShell
  {open}
  {onOpenChange}
  {header}
  layout="sheet"
  size="lg"
  grabHandle={true}
  closeLabel="Close bid details"
  contentClass="cap-rush-bid-sheet"
  overlayClass="cap-rush-bid-sheet-overlay"
>
  {@render children()}
</DialogShell>

<style>
  :global(.cap-rush-bid-sheet[data-state='open']) {
    animation: bid-sheet-fade 180ms ease-out;
  }
  :global(.cap-rush-bid-sheet-overlay[data-state='open']) {
    animation: bid-sheet-fade 180ms ease-out;
  }
  @media (max-width: 639px) {
    :global(.cap-rush-bid-sheet[data-state='open']) {
      animation: bid-sheet-rise 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }
  }
  @keyframes bid-sheet-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes bid-sheet-rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.cap-rush-bid-sheet),
    :global(.cap-rush-bid-sheet-overlay) {
      animation: none;
    }
  }
</style>
