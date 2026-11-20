<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import Button from './Button.svelte';

  let {
    title,
    message = null,
    surface = 'panel',
    kind = 'empty',
    retry = undefined,
    retryLabel = 'Try again',
    focusOnError = true,
    actions = null,
    class: className = '',
    ...rest
  }: {
    title: string;
    message?: string | null;
    surface?: 'panel' | 'none';
    kind?: 'empty' | 'loading' | 'error';
    retry?: (() => void) | undefined;
    retryLabel?: string;
    focusOnError?: boolean;
    actions?: Snippet | null;
  } & Omit<HTMLAttributes<HTMLDivElement>, 'title'> = $props();

  let panel = $state<HTMLDivElement | undefined>(undefined);
  const errorAttributes = $derived(kind === 'error' ? { tabindex: -1 } : {});

  $effect(() => {
    if (kind !== 'error' || !focusOnError) return;
    queueMicrotask(() => panel?.focus());
  });
</script>

<div
  bind:this={panel}
  {...rest}
  {...errorAttributes}
  class={['ui-empty', className]}
  data-surface={surface}
  data-kind={kind}
  role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
  aria-live={kind === 'error' ? 'assertive' : kind === 'loading' ? 'polite' : undefined}
>
  <p class="ui-empty-title">{title}</p>
  {#if message !== null}
    <p class="ui-empty-text">{message}</p>
  {/if}
  {#if actions !== null}
    <div class="ui-empty-actions">{@render actions()}</div>
  {:else if kind === 'error' && retry}
    <div class="ui-empty-actions">
      <Button size="sm" onclick={retry}>{retryLabel}</Button>
    </div>
  {/if}
</div>
