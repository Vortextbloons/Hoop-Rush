<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    label,
    value = null,
    note = null,
    size = 'md',
    tone = 'default',
    surface = 'none',
    valueClass = '',
    class: className = '',
    children,
    ...rest
  }: {
    label: string;
    value?: string | number | null;
    note?: string | null;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    tone?: 'default' | 'muted' | 'primary' | 'accent' | 'negative';
    surface?: 'none' | 'tile';
    valueClass?: string;
    children?: Snippet;
  } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest} class={['ui-stat', className]} data-surface={surface}>
  <dt class="ui-micro">{label}</dt>
  <dd class={['ui-stat-value', valueClass]} data-size={size} data-tone={tone}>
    {#if children !== undefined}
      {@render children()}
    {:else}
      {value}
    {/if}
  </dd>
  {#if note !== null}
    <dd class="ui-stat-note">{note}</dd>
  {/if}
</div>
