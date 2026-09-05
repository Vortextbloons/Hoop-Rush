<script lang="ts">
  import type { SeasonGameRule } from '@hoop-rush/data-contracts';
  let {
    rule,
    compact = false,
  }: {
    rule: SeasonGameRule | null | undefined;
    compact?: boolean;
  } = $props();
  const label: Record<Exclude<SeasonGameRule, 'standard'>, string> = {
    'deep-four': 'Deep Four',
    'twenty-second-clock': '20s Clock',
    'first-to-seven-overtime': 'First to 7 OT',
  };
  const explanation: Record<Exclude<SeasonGameRule, 'standard'>, string> = {
    'deep-four': 'Deep shots (30+ ft) score 4 points. Deep makes count separately from threes.',
    'twenty-second-clock': 'New possessions get 20 seconds; offensive rebounds reset to 14.',
    'first-to-seven-overtime': 'Ties go to an untimed race to 7 overtime points.',
  };
</script>

{#if rule !== null && rule !== undefined && rule !== 'standard'}
  <span
    title={explanation[rule]}
    class="inline-flex items-center rounded-full bg-surface-2 px-2 py-1 font-mono font-bold uppercase tracking-[0.12em] {compact
      ? 'text-[9px]'
      : 'text-[10px]'}"
  >
    {label[rule]}
  </span>
{/if}
