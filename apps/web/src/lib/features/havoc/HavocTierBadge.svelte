<script lang="ts">
  import { Flame, Sparkles, Zap } from '@lucide/svelte';
  import type { HavocTier } from '@hoop-rush/data-contracts';
  import { HAVOC_TIER_COLORS, havocTierLabel } from './havoc-presentation';
  let { tier, size = 'md' }: { tier: HavocTier; size?: 'sm' | 'md' } = $props();
  const color = $derived(HAVOC_TIER_COLORS[tier]);
</script>

<span
  data-havoc-tier={tier}
  class="inline-flex shrink-0 items-center gap-1 rounded-full border font-mono font-bold tracking-[0.12em] uppercase {size ===
  'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-0.5 text-[11px]'}"
  style="border-color: {color}; color: {color}; background: color-mix(in srgb, {color} 12%, transparent)"
  aria-label={havocTierLabel(tier)}
>
  {#if tier === 1}
    <Sparkles class="h-3 w-3 shrink-0" aria-hidden="true" />
  {:else if tier === 2}
    <Zap class="h-3 w-3 shrink-0" aria-hidden="true" />
  {:else}
    <Flame class="h-3 w-3 shrink-0" aria-hidden="true" />
  {/if}
  {havocTierLabel(tier)}
</span>
