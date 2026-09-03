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
    <div class="flex flex-col gap-3 px-3 sm:flex-row sm:items-end sm:justify-between sm:px-0">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · history
        </p>
        <h1
          id="history-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Completed seasons
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">Champions on this device</p>
      </div>
    </div>

    {#if loadError !== null}
      <div
        role="alert"
        class="mx-auto mt-8 w-full max-w-xl rounded-xl border border-destructive/40 bg-destructive/10 p-6"
      >
        <h2 class="font-display text-lg font-extrabold uppercase tracking-tight">
          History could not load
        </h2>

        <p class="mt-2 font-mono text-xs text-destructive">{loadError}</p>
        <button
          type="button"
          onclick={() => void loadHistory()}
          class="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Try again
        </button>
      </div>
    {:else if entries === null}
      <p class="py-10 font-mono text-sm text-muted-foreground" aria-live="polite">
        Loading completed seasons…
      </p>
    {:else if entries.length === 0}
      <div class="mx-auto mt-8 w-full max-w-xl rounded-xl bg-surface-1 p-6 text-center">
        <p class="font-display text-lg font-extrabold uppercase tracking-tight">
          No completed seasons yet
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          Finish a Season Run through the champion to see it here — results, awards, and the final
          bracket are preserved on this device.
        </p>
        <a
          href={resolve('/season/run')}
          class="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Back to the hub
        </a>
      </div>
    {:else}
      <ul class="mt-6 flex flex-col gap-2">
        {#each entries as entry (entry.runId)}
          <li>
            <a
              href={resolve(`/season/run/history?runId=${entry.runId}`)}
              data-season-history-entry={entry.runId}
              class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-surface-1 px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2"
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
