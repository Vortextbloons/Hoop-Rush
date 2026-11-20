<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    eyebrow,
    title,
    badges = null,
    hero = null,
    actions = null,
    footer = null,
    class: className = '',
    children = null,
    ...rest
  }: {
    eyebrow: string;
    title: string;
    badges?: Snippet | null;
    hero?: Snippet | null;
    actions?: Snippet | null;
    footer?: Snippet | null;
    children?: Snippet | null;
  } & Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> = $props();
</script>

<section {...rest} class={['ui-result-screen', className]}>
  <header class="ui-panel ui-result-screen-head">
    <div class="ui-result-screen-top">
      <p class="ui-label">{eyebrow}</p>
      {#if badges !== null}
        <div class="ui-result-screen-badges">{@render badges()}</div>
      {/if}
    </div>
    <h1 class="ui-result-screen-title">{title}</h1>
    {#if hero !== null}
      <div class="ui-result-screen-hero">{@render hero()}</div>
    {/if}
    {#if actions !== null}
      <div class="ui-result-screen-actions">{@render actions()}</div>
    {/if}
  </header>
  {#if children !== null}
    <div class="ui-result-screen-body">{@render children()}</div>
  {/if}
  {#if footer !== null}
    <footer class="ui-result-screen-footer">{@render footer()}</footer>
  {/if}
</section>
