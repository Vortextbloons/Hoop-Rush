<script lang="ts">
  import { Trophy } from '@lucide/svelte';
  import { seasonTierFromWins } from '$lib/season-tier';
  interface Props {
    wins: number;
    size?: 'default' | 'large';
  }
  let { wins, size = 'default' }: Props = $props();
  const tier = $derived(seasonTierFromWins(wins));
  const large = $derived(size === 'large');
</script>

<p
  class="inline-flex items-center gap-2 rounded-full border font-mono tracking-[0.14em] uppercase {tier.badgeClass} {large
    ? 'mt-2 px-4 py-1 text-xs sm:text-sm'
    : 'px-3 py-0.5 text-[11px]'}"
>
  <Trophy class={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
  {tier.label}
</p>
