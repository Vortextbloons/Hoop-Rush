<script lang="ts">
  import { resolve } from '$app/paths';
  import type { HavocHistoryState } from './havoc-history-state.svelte';
  import { havocCompletionStateLabel, havocRecordLabel } from './havoc-presentation';

  let { state }: { state: HavocHistoryState } = $props();
</script>

<section class="h-shell" data-havoc-history>
  <header>
    <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
      Hoop Havoc · Hall of Freaks
    </p>
    <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase">
      Hall of Freaks
    </h1>
    <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
      Every squad has a story. Revisit your seasons, wildest powers, and greatest runs.
    </p>
  </header>

  {#if state.loading}
    <p class="mt-6 font-mono text-sm text-muted-foreground" aria-live="polite">Loading history…</p>
  {:else if state.error !== null && state.entries.length === 0}
    <p
      role="alert"
      class="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
    >
      {state.error}
    </p>
  {:else if state.entries.length === 0}
    <div class="mt-6 rounded-xl bg-surface-1 p-6">
      <p class="text-sm text-muted-foreground">
        No Havoc runs yet. Draft a lineup and play the 82-game challenge.
      </p>
      <a
        href={resolve('/havoc')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Start a Havoc run
      </a>
    </div>
  {:else}
    <ul class="mt-6 flex flex-col gap-3">
      {#each state.entries as entry (entry.runId)}
        <li>
          <a
            href={resolve('/havoc/history/[runId]', { runId: entry.runId })}
            data-havoc-history-entry={entry.runId}
            class="h-panel flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <span class="min-w-0 flex-1">
              <span
                class="font-display block truncate text-lg font-extrabold tracking-tight uppercase"
              >
                {havocRecordLabel(entry.havocWins, entry.havocLosses)}
                {#if entry.perfectSeason}
                  <span class="text-primary">· 82–0</span>
                {/if}
              </span>
              <span class="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {new Date(entry.createdAtIso).toLocaleDateString()}
              </span>
              <span class="mt-0.5 block text-xs text-muted-foreground">
                {havocCompletionStateLabel(entry.completionState)} · comparison:
                {entry.comparisonStatus} · updated
                {new Date(entry.updatedAtIso).toLocaleDateString()}
              </span>
            </span>
            <span
              class="shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {entry.comparisonStatus ===
              'complete'
                ? 'border-primary text-primary'
                : 'border-border text-muted-foreground'}"
            >
              {entry.comparisonStatus === 'complete' ? 'Report ready' : 'Report partial'}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
