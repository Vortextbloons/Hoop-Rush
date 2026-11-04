<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import type { ButtonSize, ButtonTone } from './types';

  let {
    href,
    tone = 'default',
    size = 'md',
    class: className = '',
    children,
    ...rest
  }: {
    href: string;
    tone?: ButtonTone;
    size?: ButtonSize;
    children: Snippet;
  } & Omit<HTMLAnchorAttributes, 'href' | 'children'> = $props();
</script>

<a {...rest} {href} class={['ui-btn', className]} data-tone={tone} data-size={size}>
  {@render children()}
</a>
