<script lang="ts">
  import type { CapRushPlayoffStatus, CapRushPlayoffRow } from './cap-rush-playoff-presentation.ts';
  import { sampleLabel } from './cap-rush-playoff-presentation.ts';

  let {
    row,
    status = 'active',
    size = 'sm',
  }: {
    row: CapRushPlayoffRow | null;
    status?: CapRushPlayoffStatus;
    size?: 'sm' | 'md';
  } = $props();

  const direction = $derived(row?.direction ?? 'neutral');
  const glyph = $derived(
    status === 'legacy' || status === 'no-sample' || row === null
      ? '–'
      : direction === 'up'
        ? '▲'
        : direction === 'down'
          ? '▼'
          : '=',
  );
  const tone = $derived(
    status === 'legacy' || status === 'no-sample' || row === null
      ? 'muted'
      : status === 'pending'
        ? 'armed'
        : direction === 'up'
          ? 'up'
          : direction === 'down'
            ? 'down'
            : 'flat',
  );
  const label = $derived.by(() => {
    if (status === 'legacy') return 'No playoff adjustment: this run predates playoff performance.';
    if (status === 'no-sample' || row === null)
      return 'No recorded playoff sample for this season, so no playoff adjustment.';
    const verb = direction === 'up' ? 'improves' : direction === 'down' ? 'declines' : 'is neutral';
    const sample = sampleLabel(row.row);
    if (status === 'pending')
      return `Playoff form ${verb} (${sample}). Applies in the playoffs only.`;
    return `Playoff form ${verb} in this postseason (${sample}).`;
  });
</script>

<span
  class="playoff-mark"
  data-tone={tone}
  data-size={size}
  role="img"
  aria-label={label}
  title={label}
>
  <span class="playoff-mark-glyph" aria-hidden="true">{glyph}</span>
  <span class="playoff-mark-text" aria-hidden="true">PO</span>
</span>

<style>
  .playoff-mark {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    flex: none;
    border: 1px solid var(--color-line-strong);
    border-radius: 0.25rem;
    padding: 0 0.2rem;
    font-family: var(--font-mono);
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: 0.04em;
  }
  .playoff-mark[data-size='md'] {
    font-size: 0.5625rem;
    padding: 0.05rem 0.3rem;
  }
  .playoff-mark[data-size='sm'] {
    font-size: 0.45rem;
  }
  .playoff-mark-glyph {
    font-size: 0.7em;
    line-height: 1;
  }
  .playoff-mark[data-tone='up'] {
    border-color: color-mix(in srgb, var(--color-positive) 55%, transparent);
    background: color-mix(in srgb, var(--color-positive) 12%, transparent);
    color: var(--color-positive);
  }
  .playoff-mark[data-tone='down'] {
    border-color: color-mix(in srgb, var(--color-negative) 55%, transparent);
    background: color-mix(in srgb, var(--color-negative) 12%, transparent);
    color: var(--color-negative);
  }
  .playoff-mark[data-tone='armed'] {
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .playoff-mark[data-tone='flat'] {
    border-color: var(--color-line-strong);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
  }
  .playoff-mark[data-tone='muted'] {
    border-color: var(--color-line-soft);
    background: transparent;
    color: var(--color-muted-foreground);
    opacity: 0.7;
  }
</style>
