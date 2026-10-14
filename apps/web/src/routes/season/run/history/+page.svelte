<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { SeasonCompletedRunIndexEntry } from '@hoop-rush/persistence';
  import { getSeasonRunRepository } from '#lib/season/season-repo.js';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '#lib/season/season-shell-context.js';
  import CompletedSeasonResult from '#lib/components/season/CompletedSeasonResult.svelte';
  import { franchiseColor } from '#lib/season/franchise-colors.js';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  const selectedRunId = $derived(page.url.searchParams.get('runId'));
  let entries = $state<SeasonCompletedRunIndexEntry[] | null>(null);
  let loadError = $state<string | null>(null);
  let loadedRunId = $state<string | null>(null);
  async function loadHistory(): Promise<void> {
    const runId = shell.run?.runId ?? null;
    if (runId !== null && runId === loadedRunId) return;
    loadedRunId = runId;
    entries = null;
    loadError = null;
    try {
      const repo = await getSeasonRunRepository();
      const list = await repo.listCompletedSeasonRuns();
      entries = list;
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }
  $effect(() => {
    void loadHistory();
  });
</script>

<svelte:head>
  <title>Season Run — History — Hoop Rush</title>
</svelte:head>

{#if selectedRunId !== null}
  <CompletedSeasonResult runId={selectedRunId} />
{:else}
  <section aria-labelledby="history-heading" class="min-w-0 pt-6">
    <div class="sr-arrive flex flex-col gap-3">
      <div class="min-w-0">
        <p class="sr-eyebrow">Season Run</p>
        <h1 id="history-heading" class="sr-page-title mt-1">Completed seasons</h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">Champions on this device</p>
      </div>
    </div>

    {#if loadError !== null}
      <div class="mx-auto mt-8 w-full max-w-xl">
        <AsyncState kind="error" title="History could not load" message={loadError}>
          {#snippet actions()}
            <button type="button" onclick={() => void loadHistory()} class="sr-btn-danger">
              Try again
            </button>
          {/snippet}
        </AsyncState>
      </div>
    {:else if entries === null}
      <div class="mx-auto mt-8 w-full max-w-xl">
        <AsyncState kind="loading" title="Loading completed seasons" />
      </div>
    {:else if entries.length === 0}
      <div class="mx-auto mt-8 w-full max-w-xl">
        <AsyncState
          kind="empty"
          title="No completed seasons yet"
          message="Finish a Season Run through the champion to see it here — results, awards, and the final bracket are preserved on this device."
        >
          {#snippet actions()}
            <a href={resolve('season/run/')} class="sr-btn-ghost">Back to the hub</a>
          {/snippet}
        </AsyncState>
      </div>
    {:else}
      <p class="sr-section-label mt-6">Finals archive</p>
      <ul class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {#each entries as entry (entry.runId)}
          <li>
            <a
              href={resolve(`season/run/history/?runId=${entry.runId}`)}
              data-season-history-entry={entry.runId}
              class="sr-gamecard flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-2"
              style="--sr-accent: {franchiseColor(entry.championFranchiseId)}"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base font-bold">
                  {shell.franchiseName(entry.championFranchiseId)}
                  <span class="font-normal text-muted-foreground">champion</span>
                </span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {shell.franchiseName(entry.humanFranchiseId)}
                </span>
              </span>
              <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                {new Date(entry.completedAtIso).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>

              <span class="shrink-0 font-mono text-xs font-bold text-primary">View →</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
