<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  let {
    href,
    title,
    meta = null,
    badges = null,
    leading = null,
    trailing = null,
    accent = 'none',
    class: className = '',
    ...rest
  }: {
    href: string;
    title: Snippet;
    meta?: Snippet | null;
    badges?: Snippet | null;
    leading?: Snippet | null;
    trailing?: Snippet | null;
    accent?: 'none' | 'primary';
  } & Omit<HTMLAnchorAttributes, 'href' | 'title' | 'children'> = $props();
</script>

<li class="ui-history-entry-item">
  <a {...rest} {href} class={['ui-panel', 'ui-history-entry', className]} data-accent={accent}>
    {#if leading !== null}
      <span class="ui-history-entry-leading">{@render leading()}</span>
    {/if}
    <span class="ui-history-entry-body">
      <span class="ui-history-entry-title-row">
        <span class="ui-history-entry-title">{@render title()}</span>
        {#if badges !== null}
          <span class="ui-history-entry-badges">{@render badges()}</span>
        {/if}
      </span>
      {#if meta !== null}
        <span class="ui-history-entry-meta">{@render meta()}</span>
      {/if}
    </span>
    {#if trailing !== null}
      <span class="ui-history-entry-trailing">{@render trailing()}</span>
    {/if}
  </a>
</li>

<style>
  .ui-history-entry-item {
    list-style: none;
  }

  .ui-history-entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    min-height: 5rem;
    padding: 1.25rem;
    color: inherit;
    text-decoration: none;
    outline: none;
    transition:
      border-color 150ms ease,
      background-color 150ms ease;
  }

  .ui-history-entry:hover {
    border-color: var(--color-line-strong);
  }

  .ui-history-entry:focus-visible {
    outline: 2px solid var(--ui-focus);
    outline-offset: 2px;
  }

  .ui-history-entry[data-accent='primary'] {
    border-left: 3px solid var(--color-primary);
  }

  .ui-history-entry-leading {
    display: grid;
    flex: none;
    place-items: center;
  }

  .ui-history-entry-body {
    min-width: 0;
    flex: 1 1 14rem;
  }

  .ui-history-entry-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
  }

  .ui-history-entry-badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .ui-history-entry-meta {
    display: block;
    margin-top: 0.15rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    line-height: 1.5;
  }

  .ui-history-entry-trailing {
    flex: none;
  }
</style>
