<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    columns = 3,
    mobile = 2,
    gap = 'sm',
    class: className = '',
    children,
    ...rest
  }: {
    columns?: 1 | 2 | 3 | 4 | 5;
    mobile?: 1 | 2 | 3;
    gap?: 'sm' | 'md';
    children: Snippet;
  } & HTMLAttributes<HTMLDListElement> = $props();
</script>

<dl
  {...rest}
  class={['ui-stat-grid', className]}
  data-columns={columns}
  data-mobile={mobile}
  data-gap={gap}
>
  {@render children()}
</dl>
