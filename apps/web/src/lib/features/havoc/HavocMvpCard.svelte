<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';
  import PlayerArt from '#lib/components/PlayerArt.svelte';
  import { havocMvpFormulaLabel } from './havoc-presentation';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';

  let { comparison }: { comparison: HavocComparison } = $props();
  const mvp = $derived(comparison.mvp);
  const formula = $derived(havocMvpFormulaLabel(comparison.mvpIndexWeights));
</script>

<MvpCard label="Your Havoc MVP" name={mvp.displayName} slot={mvp.slot} data-havoc-mvp>
  {#snippet portrait()}
    <PlayerArt
      playerId={mvp.playerId}
      playerVersionId={mvp.playerVersionId}
      displayName={mvp.displayName}
    />
  {/snippet}
</MvpCard>
<Disclosure class="mt-4" summary="How the MVP earned the award">
  <StatGrid columns={3} mobile={3} gap="md">
    <StatTile
      label="Havoc index"
      size="md"
      valueClass="font-mono text-base break-words sm:text-xl"
      value={mvp.havocIndex}
      data-havoc-mvp-havoc-index
    />
    <StatTile
      label="Normal index"
      size="md"
      valueClass="font-mono text-base break-words sm:text-xl"
      value={mvp.normalIndex}
      data-havoc-mvp-normal-index
    />
    <StatTile
      label="Gain"
      size="md"
      valueClass="font-mono text-base break-words sm:text-xl"
      tone={mvp.gain < 0 ? 'negative' : 'primary'}
      value={`${mvp.gain >= 0 ? '+' : ''}${mvp.gain}`}
      data-havoc-mvp-gain
    />
  </StatGrid>
  <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
    Index = {formula}. Each slot's starter, replacement, and clone totals are included; the highest
    gain wins. Ties use the mutated index, then draft order. The index is a transparent award rule,
    not exact causal value.
  </p>
</Disclosure>
