<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { SeasonCompletedRunIndexEntry } from '@hoop-rush/persistence';
  import { getSeasonRunRepository } from '$lib/season/season-repo';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import CompletedSeasonResult from '$lib/components/season/CompletedSeasonResult.svelte';
  import { franchiseColor } from '$lib/season/franchise-colors';
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
        <h1
          id="history-heading"
          class="sr-page-title mt-1"
        >
          Completed seasons
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">Champions on this device</p>
      </div>
    </div>

    {#if loadError !== null}
      <div
        role="alert"
        class="sr-panel mx-auto mt-8 w-full max-w-xl p-6"
      >
        <p class="sr-eyebrow">Season archive</p>
        <h2 class="font-display mt-1 text-lg font-extrabold uppercase tracking-tight">
          History could not load
        </h2>

        <p class="mt-2 font-mono text-xs text-destructive">{loadError}</p>
        <button
          type="button"
          onclick={() => void loadHistory()}
          class="sr-btn-danger mt-4"
        >
          Try again
        </button>
      </div>
    {:else if entries === null}
      <p class="py-10 font-mono text-sm text-muted-foreground" aria-live="polite">
        Loading completed seasons…
      </p>
    {:else if entries.length === 0}
      <div class="sr-panel mx-auto mt-8 w-full max-w-xl p-6 text-center">
        <p class="sr-eyebrow">Nothing archived yet</p>
        <p class="font-display mt-1 text-lg font-extrabold uppercase tracking-tight">
          No completed seasons yet
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          Finish a Season Run through the champion to see it here — results, awards, and the final
          bracket are preserved on this device.
        </p>
        <a
          href={resolve('/season/run')}
          class="sr-btn-ghost mt-4"
        >
          Back to the hub
        </a>
      </div>
    {:else}
      <p class="sr-section-label mt-6">Finals archive</p>
      <ul class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {#each entries as entry (entry.runId)}
          <li>
            <a
              href={resolve(`/season/run/history?runId=${entry.runId}`)}
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
              <span class="shrink-0 font-mono text-xs font-bold text-primary">View &rarr;</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}