<script lang="ts">
  import type { Snippet } from 'svelte';
  type StateKind = 'loading' | 'empty' | 'error';
  let {
    kind,
    title,
    message = null,
    retry,
    retryLabel = 'Try again',
    focusOnError = true,
    actions = null,
  }: {
    kind: StateKind;
    title: string;
    message?: string | null;
    retry?: () => void;
    retryLabel?: string;
    focusOnError?: boolean;
    actions?: Snippet | null;
  } = $props();
  let panel = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => {
    if (kind !== 'error' || !focusOnError) return;
    queueMicrotask(() => panel?.focus());
  });
</script>

<div
  bind:this={panel}
  tabindex="-1"
  role={kind === 'error' ? 'alert' : 'status'}
  aria-live={kind === 'error' ? 'assertive' : 'polite'}
  class="ui-panel p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring {kind === 'error'
    ? 'border-destructive/40 bg-destructive/10'
    : 'bg-card'}"
>
  <p class="font-display text-base font-extrabold tracking-tight uppercase">{title}</p>
  {#if message !== null}
    <p class="mt-1 text-sm text-muted-foreground">{message}</p>
  {/if}
  {#if actions !== null}
    <div class="mt-4 flex flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {:else if kind === 'error' && retry}
    <button type="button" onclick={retry} class="ui-btn ui-btn--sm mt-4">
      {retryLabel}
    </button>
  {/if}
</div>
