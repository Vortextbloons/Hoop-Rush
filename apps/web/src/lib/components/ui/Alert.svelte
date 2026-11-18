<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    tone = 'info',
    title = null,
    icon = null,
    actions = null,
    as = 'div',
    class: className = '',
    children = null,
    ...rest
  }: {
    tone?: 'info' | 'success' | 'warning' | 'danger';
    title?: string | null;
    icon?: Snippet | null;
    actions?: Snippet | null;
    as?: 'div' | 'section' | 'li';
    children?: Snippet | null;
  } & Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> = $props();

  const role = $derived(tone === 'danger' ? 'alert' : 'status');
</script>

<svelte:element this={as} {...rest} {role} class={['ui-alert', className]} data-tone={tone}>
  {#if icon !== null}
    <span class="ui-alert-icon" aria-hidden="true">{@render icon()}</span>
  {/if}
  <div class="ui-alert-body">
    {#if title !== null}
      <p class="ui-alert-title">{title}</p>
    {/if}
    {#if children !== null}
      <div class="ui-alert-text">{@render children()}</div>
    {/if}
    {#if actions !== null}
      <div class="ui-alert-actions">{@render actions()}</div>
    {/if}
  </div>
</svelte:element>
