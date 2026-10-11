<script lang="ts">
  import type { HavocMutationId } from '@hoop-rush/data-contracts';
  import {
    HAVOC_TIER_COLORS,
    formatSignedPoints,
    mutationNameOf,
    mutationTierOf,
  } from './havoc-presentation';

  let { mutationId, pointsDelta = null }: { mutationId: HavocMutationId; pointsDelta?: number | null } =
    $props();
  const color = $derived(HAVOC_TIER_COLORS[mutationTierOf(mutationId)]);
</script>

<span
  data-havoc-mutation-badge={mutationId}
  class="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide uppercase"
  style="border-color: {color}; color: {color}; background: color-mix(in srgb, {color} 10%, transparent)"
>
  {mutationNameOf(mutationId)}
  {#if pointsDelta !== null && pointsDelta !== 0}
    <span>{formatSignedPoints(pointsDelta)}</span>
  {/if}
</span>
