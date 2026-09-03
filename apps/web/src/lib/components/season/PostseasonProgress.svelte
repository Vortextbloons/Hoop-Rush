<script lang="ts">import type { HubPostseasonProgress } from '$lib/season/season-postseason-presentation';
let { progress, onCancel, onRetry, label, }: {
    progress: HubPostseasonProgress;
    onCancel: () => void;
    onRetry: () => void;
    label: string;
} = $props();
const percent = $derived(progress.gamesTotal > 0
    ? Math.min(100, Math.round((progress.gamesCompleted / progress.gamesTotal) * 100))
    : 0);
const latest = $derived(progress.latestResult);
const latestText = $derived(latest
    ? `${latest.homeFranchiseId} ${String(latest.homeScore)} – ${String(latest.awayScore)} ${latest.awayFranchiseId}`
    : '');
</script>

{#if progress.phase === 'running' || progress.phase === 'cancelled' || progress.phase === 'failed' || progress.phase === 'complete'}
  <section
    aria-labelledby="postseason-progress-heading"
    data-season-postseason-progress
    class="rounded-xl border border-border bg-surface-1 p-4"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2
        id="postseason-progress-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        {label}
      </h2>
      <span class="font-mono text-[10px] text-muted-foreground">
        {progress.gamesTotal > 0
          ? `${String(progress.gamesCompleted)} / ${String(progress.gamesTotal)} games`
          : 'Starting…'}
      </span>
    </div>

    <div
      class="mt-3"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={progress.gamesTotal || 1}
      aria-valuenow={progress.gamesCompleted}
      aria-valuetext={progress.gamesTotal > 0
        ? `${String(progress.gamesCompleted)} of ${String(progress.gamesTotal)} postseason games`
        : 'starting'}
    >
      <div class="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>
          {progress.gamesTotal > 0
            ? `${String(progress.gamesCompleted)} of ${String(progress.gamesTotal)} games`
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

    {#if progress.phase === 'running' && latestText}
      <p class="mt-3 text-sm">
        Latest: <span class="font-semibold">{latestText}</span>
      </p>
    {/if}

    {#if progress.phase === 'running'}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={onCancel}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
        >
          Cancel
        </button>
        <span class="font-mono text-[10px] text-muted-foreground">
          Nothing saved is lost — you can run it again.
        </span>
      </div>
    {/if}

    {#if progress.phase === 'cancelled'}
      <div class="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
        <p class="font-semibold">Postseason simulation cancelled.</p>
        <p class="mt-1 text-muted-foreground">
          Games already committed stay saved. Retry continues from the current matchup.
        </p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Retry
        </button>
      </div>
    {/if}

    {#if progress.phase === 'failed' && progress.error}
      <div
        role="alert"
        class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      >
        <p class="font-semibold">The postseason simulation failed ({progress.error.code}).</p>
        <p class="mt-1 text-muted-foreground">{progress.error.message}</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Retry
        </button>
      </div>
    {/if}

    {#if progress.phase === 'complete'}
      <p class="mt-3 text-sm">
        <span class="font-semibold text-primary">Postseason simulation complete.</span>
        Results are saved.
      </p>
    {/if}

    <p class="sr-only" role="status" aria-live="polite">
      {progress.phase === 'running'
        ? `${label} started`
        : progress.phase === 'complete'
          ? `${label} complete`
          : progress.phase === 'cancelled'
            ? `${label} cancelled`
            : progress.phase === 'failed'
              ? `${label} failed`
              : ''}
    </p>
  </section>
{/if}
