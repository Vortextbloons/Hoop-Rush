<script lang="ts">
  let {
    value,
    size = 'sm',
    layout = 'inline',
    align = 'right',
  }: {
    value: number;
    size?: 'sm' | 'md';
    layout?: 'inline' | 'stacked';
    align?: 'left' | 'right';
  } = $props();

  const numberClass = $derived(size === 'md' ? 'text-xl' : 'text-sm');
  const labelClass = $derived(size === 'md' ? 'text-[8px]' : 'text-[7px]');
</script>

<span
  class="inline-flex {layout === 'stacked'
    ? `flex-col leading-none ${align === 'right' ? 'items-end' : 'items-start'}`
    : 'items-baseline gap-1'} {align === 'right' ? 'text-right' : 'text-left'}"
  aria-label={`Overall ${String(value)}`}
>
  {#if layout === 'inline'}
    <span class="font-mono text-[10px] font-bold tabular-nums text-foreground">{value}</span>
    <span class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
      OVR
    </span>
  {:else}
    <span class="font-display font-extrabold tracking-tight tabular-nums {numberClass}">
      {value}
    </span>
    <span
      class="mt-0.5 font-mono font-bold tracking-[0.08em] text-muted-foreground uppercase {labelClass}"
    >
      OVR
    </span>
  {/if}
</span>
