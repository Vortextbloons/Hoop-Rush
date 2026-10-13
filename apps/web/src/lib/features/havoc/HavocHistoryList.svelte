<script lang="ts">
  import { resolve } from '$app/paths';
  import AsyncState from '$lib/components/AsyncState.svelte';
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
    <div class="mt-6">
      <AsyncState kind="loading" title="Loading history" message="Reading your Havoc runs…" />
    </div>
  {:else if state.error !== null && state.entries.length === 0}
    <div class="mt-6">
      <AsyncState kind="error" title="History unavailable" message={state.error} />
    </div>
  {:else if state.entries.length === 0}
    <div class="mt-6">
      <AsyncState
        kind="empty"
        title="No Havoc runs yet"
        message="Draft a lineup and play the 82-game challenge."
      >
        {#snippet actions()}
          <a href={resolve('/havoc')} class="h-button">Start a Havoc run</a>
        {/snippet}
      </AsyncState>
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
