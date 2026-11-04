<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    eyebrow,
    title,
    description = null,
    actions = null,
    class: className = '',
  }: {
    eyebrow: string;
    title: string;
    description?: string | null;
    actions?: Snippet | null;
    class?: string;
  } = $props();
</script>

<header class={['ui-page-header', className]}>
  <div class="ui-page-header-text">
    <p class="ui-page-eyebrow">{eyebrow}</p>
    <h1 class="ui-page-title">{title}</h1>
    {#if description !== null}
      <p class="ui-page-description">{description}</p>
    {/if}
  </div>
  {#if actions !== null}
    <div class="ui-page-actions">{@render actions()}</div>
  {/if}
</header>
