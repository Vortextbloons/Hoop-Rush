<script lang="ts">
  import type { AvailabilityStripRow } from '$lib/season/season-health-view';
  let {
    rows,
    title = 'Health',
  }: {
    rows: AvailabilityStripRow[];
    title?: string;
  } = $props();
  const outCount = $derived(rows.filter((row) => row.status === 'active').length);
  const returnedCount = $derived(rows.filter((row) => row.status === 'returned').length);
  const summary = $derived(
    `${String(outCount)} player${outCount === 1 ? '' : 's'} out, ${String(returnedCount)} returning from injury`,
  );
</script>

<section aria-labelledby="health-strip-heading" class="sr-panel-quiet p-4">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="health-strip-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight text-foreground"
    >
      {title}
    </h2>
    <span class="sr-section-label">{summary}</span>
  </div>
  {#if rows.length === 0}
    <p class="mt-2 text-sm text-muted-foreground">No roster data yet.</p>
  {:else}
    <ul class="mt-2 flex flex-col divide-y divide-border/50">
      {#each rows as row (row.playerVersionId)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span class="min-w-0 flex-1 truncate font-semibold">{row.displayName}</span>
          {#if row.status === 'active'}
            <span class="sr-badge" data-tone="loss"> Out </span>
          {:else if row.status === 'returned'}
            <span class="sr-badge" data-tone="win"> Back </span>
          {:else}
            <span class="sr-badge"> Available </span>
          {/if}
          {#if row.returnRange !== null && row.returnRange.min !== null}
            <span class="font-mono text-[10px] text-muted-foreground">
              back around R{row.returnRange.min}
            </span>
          {/if}
          {#if row.recurrence}
            <span class="sr-badge" data-tone="warn" title="Recurrence risk window after return">
              Recurrence risk
            </span>
          {/if}
          {#if row.nextGameConsequence !== null}
            <span class="min-w-0 font-mono text-[10px] text-muted-foreground">
              {row.nextGameConsequence}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">{summary}</p>
</section>
