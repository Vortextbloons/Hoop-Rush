<script lang="ts">
  import type { BlockRunState } from '$lib/season/season-hub-state';
  let {
    block,
    onCancel,
    onRetry,
    label,
  }: {
    block: BlockRunState;
    onCancel: () => void;
    onRetry: () => void;
    label: string;
  } = $props();
  const percent = $derived(
    block.gamesTotal > 0
      ? Math.min(100, Math.round((block.gamesCompleted / block.gamesTotal) * 100))
      : 0,
  );
</script>

{#if block.phase === 'running' || block.phase === 'complete' || block.phase === 'cancelled' || block.phase === 'failed'}
  <section
    aria-labelledby="block-progress-heading"
    class="rounded-xl border border-border bg-surface-1 p-4"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2
        id="block-progress-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Block {block.blockIndex !== null ? String(block.blockIndex + 1) : '—'} of 9
      </h2>
      <span class="font-mono text-[10px] text-muted-foreground">{label}</span>
    </div>

    <div
      class="mt-3"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={block.gamesTotal || 1}
      aria-valuenow={block.gamesCompleted}
      aria-valuetext={block.gamesTotal > 0
        ? `${String(block.gamesCompleted)} of ${String(block.gamesTotal)} games`
        : 'starting'}
    >
      <div class="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>
          {block.gamesTotal > 0
            ? `${String(block.gamesCompleted)} / ${String(block.gamesTotal)} games`
            : 'Starting…'}
        </span>
        <span>{percent}%</span>
      </div>
      <div class="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style="width: {percent}%"
        ></div>
      </div>
    </div>

    {#if block.phase === 'running'}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={onCancel}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
        >
          Cancel
        </button>
      </div>
    {/if}

    {#if block.phase === 'cancelled'}
      <div class="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
        <p class="font-semibold">Block cancelled between games.</p>
        <p class="mt-1 text-muted-foreground">Cancelled. Retry from last block.</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Retry block
        </button>
      </div>
    {/if}

    {#if block.phase === 'failed' && block.error}
      <div
        role="alert"
        class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      >
        <p class="font-semibold">The block failed.</p>
        <p class="mt-1 text-muted-foreground">{block.error.message}</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Retry block
        </button>
      </div>
    {/if}

    <p class="sr-only" role="status" aria-live="polite">
      {block.phase === 'running'
        ? `${label} started`
        : block.phase === 'complete'
          ? `${label} complete`
          : block.phase === 'cancelled'
            ? `${label} cancelled`
            : block.phase === 'failed'
              ? `${label} failed`
              : ''}
    </p>
  </section>
{/if}
