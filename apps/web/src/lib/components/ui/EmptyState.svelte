<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    title,
    message = null,
    surface = 'panel',
    actions = null,
    class: className = '',
    ...rest
  }: {
    title: string;
    message?: string | null;
    surface?: 'panel' | 'none';
    actions?: Snippet | null;
  } & Omit<HTMLAttributes<HTMLDivElement>, 'title'> = $props();
</script>

<div {...rest} class={['ui-empty', className]} data-surface={surface}>
  <p class="ui-empty-title">{title}</p>
  {#if message !== null}
    <p class="ui-empty-text">{message}</p>
  {/if}
  {#if actions !== null}
    <div class="ui-empty-actions">{@render actions()}</div>
  {/if}
</div>
