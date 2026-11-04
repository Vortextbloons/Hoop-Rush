<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    as = 'div',
    padding = 'none',
    class: className = '',
    children,
    ...rest
  }: {
    as?: 'div' | 'section' | 'article' | 'li';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    children?: Snippet;
  } & HTMLAttributes<HTMLElement> = $props();
</script>

<svelte:element this={as} {...rest} class={['ui-panel', className]} data-padding={padding}>
  {@render children?.()}
</svelte:element>
