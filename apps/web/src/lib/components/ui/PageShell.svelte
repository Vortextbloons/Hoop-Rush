<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    as = 'div',
    width = 'lg',
    padding = 'md',
    class: className = '',
    children,
    ...rest
  }: {
    as?: 'div' | 'section' | 'main';
    width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
    children?: Snippet;
  } & HTMLAttributes<HTMLElement> = $props();
</script>

<svelte:element
  this={as}
  {...rest}
  class={['ui-shell', className]}
  data-width={width}
  data-padding={padding}
>
  {@render children?.()}
</svelte:element>
