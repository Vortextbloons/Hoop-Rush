<script lang="ts">
  import type { SeasonTradeValueTrend } from '@hoop-rush/data-contracts';
  import { valueTrendToneLabel } from '$lib/season/season-presentation';

  let {
    trend,
    basis,
    playerName = null,
  }: {
    trend: SeasonTradeValueTrend;
    basis: string;
    playerName?: string | null;
  } = $props();

  const tone = $derived(valueTrendToneLabel(trend.trend));
  const accent = $derived(
    trend.trend === 'rising' ? 'text-positive border-positive/30 bg-positive/10' : trend.trend === 'falling' ? 'text-destructive border-destructive/30 bg-destructive/10' : 'text-muted-foreground border-border bg-surface-2',
  );
</script>

<div
  class="flex items-start gap-2 rounded-lg border px-2.5 py-2 {accent}"
  role="cell"
  aria-label="{playerName ?? trend.playerVersionId} value trend {tone} — {basis}"
  tabindex="0"
>
  <span class="mt-1 h-2 w-2 shrink-0 rounded-full {trend.trend === 'rising' ? 'bg-positive' : trend.trend === 'falling' ? 'bg-destructive' : 'bg-muted-foreground'}"></span>
  <div class="min-w-0">
    <p class="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">{tone}</p>
    <p class="text-xs leading-snug text-muted-foreground line-clamp-2">{basis}</p>
  </div>
</div>
