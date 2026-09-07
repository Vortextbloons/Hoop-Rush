<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PlayoffPrepSummary } from '$lib/season/season-playoff-hub-view';
  import type { AvailabilityStripRow } from '$lib/season/season-health-view';
  let {
    prep,
    healthRows,
    gameLabel,
    rehabCount = 0,
  }: {
    prep: PlayoffPrepSummary | null;
    healthRows: AvailabilityStripRow[];
    gameLabel: string;
    rehabCount?: number;
  } = $props();
  const outCount = $derived(healthRows.filter((r) => r.status === 'active').length);
  const healthLabel = $derived(
    outCount === 0 ? 'All rotation players available' : `${String(outCount)} player${outCount === 1 ? '' : 's'} out`,
  );
  const rotationReady = $derived(prep !== null && prep.minutesOk && prep.closersOk && !prep.invalid);
</script>

<section aria-labelledby="game-prep-heading" id="playoff-prep" class="flex scroll-mt-24 flex-col gap-3">
  <div class="flex flex-wrap items-baseline justify-between gap-2 px-1">
    <h2 id="game-prep-heading" class="font-display text-lg font-extrabold uppercase tracking-tight">
      Game prep
    </h2>
    <p class="font-mono text-[10px] text-muted-foreground">{gameLabel}</p>
  </div>
  <div class="grid gap-3 md:grid-cols-3">
    <div class="rounded-2xl border border-border bg-surface-1 p-4">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Rotation</p>
      {#if prep === null}
        <p class="mt-2 animate-pulse text-xs text-muted-foreground">Loading rotation…</p>
      {:else}
        <p class="mt-2 font-display text-xl font-extrabold tabular-nums">{prep.rotationLabel}</p>
        <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{prep.startersLabel}</p>
        {#if prep.invalid && prep.firstFailure !== null}
          <p role="alert" class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">{prep.firstFailure}</p>
        {:else if rotationReady}
          <p class="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-positive"><span class="inline-block h-1.5 w-1.5 rounded-full bg-positive" aria-hidden="true"></span>Ready</p>
        {:else}
          <p class="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">Needs a fix</p>
        {/if}
      {/if}
      <a href={resolve('/season/run/team' as any)} class="mt-3 inline-flex min-h-10 items-center gap-1 text-xs font-bold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline">
        Edit rotation <span aria-hidden="true">→</span>
      </a>
    </div>
    <div class="rounded-2xl border border-border bg-surface-1 p-4">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Health</p>
      <p class="mt-2 font-display text-xl font-extrabold">{healthLabel}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {#if rehabCount > 0}{rehabCount} risky rehab option{rehabCount === 1 ? '' : 's'} below{:else}No rehab decisions needed{/if}
      </p>
      <a href={resolve('/season/run/team' as any)} class="mt-3 inline-flex min-h-10 items-center gap-1 text-xs font-bold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline">
        Review health <span aria-hidden="true">→</span>
      </a>
    </div>
    <div class="rounded-2xl border border-border bg-surface-1 p-4">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Closers</p>
      <p class="mt-2 font-display text-xl font-extrabold tabular-nums">{prep === null ? '—' : `${String(prep.closersSet)}/5 set`}</p>
      <p class="mt-1 text-xs text-muted-foreground">Closing five finishes tight playoff games.</p>
      <a href={resolve('/season/run/team' as any)} class="mt-3 inline-flex min-h-10 items-center gap-1 text-xs font-bold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline">
        Adjust closers <span aria-hidden="true">→</span>
      </a>
    </div>
  </div>
</section>
