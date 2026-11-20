<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    primary = null,
    secondary = null,
    tertiary = null,
    class: className = '',
    ...rest
  }: {
    primary?: Snippet | null;
    secondary?: Snippet | null;
    tertiary?: Snippet | null;
  } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest} class={['ui-actions', className]}>
  {#if primary !== null}{@render primary()}{/if}
  {#if secondary !== null}{@render secondary()}{/if}
  {#if tertiary !== null}{@render tertiary()}{/if}
</div>
