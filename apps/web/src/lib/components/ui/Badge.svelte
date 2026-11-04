<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { BadgeTone } from './types';

  let {
    tone = 'neutral',
    class: className = '',
    children,
    ...rest
  }: {
    tone?: BadgeTone;
    children: Snippet;
  } & Omit<HTMLAttributes<HTMLSpanElement>, 'children'> = $props();
</script>

<span {...rest} class={['ui-badge', className]} data-tone={tone}>{@render children()}</span>
