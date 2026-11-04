<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    label,
    type = 'button',
    size = 'md',
    disabled = false,
    class: className = '',
    children,
    ...rest
  }: {
    label: string;
    size?: 'md' | 'sm';
    children: Snippet;
  } & Omit<HTMLButtonAttributes, 'children'> = $props();
</script>

<button
  {...rest}
  {type}
  {disabled}
  aria-label={label}
  class={['ui-icon-btn', className]}
  data-size={size}
>
  {@render children()}
</button>
