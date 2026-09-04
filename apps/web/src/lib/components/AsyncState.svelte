<script lang="ts">type StateKind = 'loading' | 'empty' | 'error';
let { kind, title, message, retry, retryLabel = 'Try again', focusOnError = true, }: {
    kind: StateKind;
    title: string;
    message: string;
    retry?: () => void;
    retryLabel?: string;
    focusOnError?: boolean;
} = $props();
let panel = $state<HTMLDivElement | undefined>(undefined);
$effect(() => {
    if (kind !== 'error' || !focusOnError)
        return;
    queueMicrotask(() => panel?.focus());
});
</script>

<div
  bind:this={panel}
  tabindex="-1"
  role={kind === 'error' ? 'alert' : 'status'}
  aria-live={kind === 'error' ? 'assertive' : 'polite'}
  class="rounded-xl border p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring {kind ===
  'error'
    ? 'border-destructive/40 bg-destructive/10'
    : 'border-border bg-card'}"
>
  <p class="font-display text-base font-extrabold tracking-tight uppercase">{title}</p>
  <p class="mt-1 text-sm text-muted-foreground">{message}</p>
  {#if kind === 'error' && retry}
    <button
      type="button"
      onclick={retry}
      class="mt-4 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs font-bold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
    >
      {retryLabel}
    </button>
  {/if}
</div>
