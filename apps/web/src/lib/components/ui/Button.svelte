<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { ButtonSize, ButtonTone } from './types';

  let {
    tone = 'default',
    size = 'md',
    type = 'button',
    loading = false,
    disabled = false,
    class: className = '',
    children,
    ...rest
  }: {
    tone?: ButtonTone;
    size?: ButtonSize;
    loading?: boolean;
    children: Snippet;
  } & Omit<HTMLButtonAttributes, 'children'> = $props();
</script>

<button
  {...rest}
  {type}
  disabled={disabled || loading}
  aria-busy={loading ? 'true' : undefined}
  aria-disabled={loading ? 'true' : undefined}
  class={['ui-btn', className]}
  data-tone={tone}
  data-size={size}
>
  {@render children()}
</button>
