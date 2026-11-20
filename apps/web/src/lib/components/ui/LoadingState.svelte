<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    variant = 'text',
    title = null,
    message = null,
    lines = 3,
    class: className = '',
    ...rest
  }: {
    variant?: 'skeleton' | 'text';
    title?: string | null;
    message?: string | null;
    lines?: number;
  } & Omit<HTMLAttributes<HTMLDivElement>, 'title'> = $props();

  const bars = $derived(
    variant === 'skeleton'
      ? Array.from({ length: Math.max(0, Math.floor(lines)) }, (_, index) => index)
      : [],
  );
</script>

<div
  {...rest}
  class={['ui-loading', className]}
  data-variant={variant}
  role="status"
  aria-live="polite"
  aria-busy="true"
>
  {#if title !== null}
    <p class="ui-loading-title">{title}</p>
  {/if}
  {#if message !== null}
    <p class="ui-loading-text">{message}</p>
  {/if}
  {#if variant === 'skeleton'}
    <div class="ui-loading-bars" aria-hidden="true">
      {#each bars as bar (bar)}
        <span class="ui-loading-bar"></span>
      {/each}
    </div>
  {/if}
  {#if title === null && message === null}
    <span class="sr-only">Loading…</span>
  {/if}
</div>
