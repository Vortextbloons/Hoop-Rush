<script lang="ts">
  import type { CapRushBidDraft } from './cap-rush-bid-draft.svelte.js';
  let { draft, disabled = false }: { draft: CapRushBidDraft; disabled?: boolean } = $props();
</script>

<div class="grid grid-cols-4 gap-1.5" aria-label="Adjust bid amount">
  {#each [{ delta: -100000, label: '?$100K' }, { delta: 100000, label: '+$100K' }, { delta: 500000, label: '+$500K' }, { delta: 1000000, label: '+$1M' }] as step (step.delta)}
    <button
      type="button"
      class="min-h-12 touch-manipulation rounded-xl border border-border bg-surface-2 px-1 font-mono text-xs font-bold tabular-nums outline-none hover:border-primary active:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      disabled={disabled ||
        (step.delta < 0 && (draft.proposedTotal ?? draft.minimumDollars) <= draft.minimumDollars)}
      onclick={() => draft.adjust(step.delta)}>{step.label}</button
    >
  {/each}
</div>
