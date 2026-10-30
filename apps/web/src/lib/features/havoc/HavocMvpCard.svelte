<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';
  import PlayerArt from '#lib/components/PlayerArt.svelte';
  import { havocMvpFormulaLabel } from './havoc-presentation';

  let { comparison }: { comparison: HavocComparison } = $props();
  const mvp = $derived(comparison.mvp);
  const formula = $derived(havocMvpFormulaLabel(comparison.mvpIndexWeights));
</script>

<section aria-labelledby="havoc-mvp-heading" class="h-panel" data-havoc-mvp>
  <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
    Your Havoc MVP
  </p>
  <h2
    id="havoc-mvp-heading"
    class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase"
  >
    {mvp.displayName}
    <span class="text-primary">· {mvp.slot}</span>
  </h2>
  <PlayerArt
    playerId={mvp.playerId}
    playerVersionId={mvp.playerVersionId}
    displayName={mvp.displayName}
  />
  <details>
    <summary>How the MVP earned the award</summary>
    <dl class="mt-3 grid grid-cols-3 gap-2 text-sm sm:gap-3">
      <div class="min-w-0">
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          Havoc index
        </dt>
        <dd class="font-mono text-base font-bold break-words sm:text-xl" data-havoc-mvp-havoc-index>
          {mvp.havocIndex}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          Normal index
        </dt>
        <dd
          class="font-mono text-base font-bold break-words sm:text-xl"
          data-havoc-mvp-normal-index
        >
          {mvp.normalIndex}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">Gain</dt>
        <dd
          class="font-mono text-base font-bold break-words sm:text-xl {mvp.gain < 0
            ? 'text-destructive'
            : 'text-primary'}"
          data-havoc-mvp-gain
        >
          {mvp.gain >= 0 ? '+' : ''}{mvp.gain}
        </dd>
      </div>
    </dl>
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
      Index = {formula}. Each slot's starter, replacement, and clone totals are included; the
      highest gain wins. Ties use the mutated index, then draft order. The index is a transparent
      award rule, not exact causal value.
    </p>
  </details>
</section>
