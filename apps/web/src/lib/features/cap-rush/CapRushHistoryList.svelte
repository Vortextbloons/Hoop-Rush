<script lang="ts">
  import { resolve } from '$app/paths';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import type { CapRushHistoryState } from './cap-rush-history-state.svelte.js';
  import {
    capStatusClass,
    capStatusShortLabel,
    formatMillions,
    postseasonOutcomeLabel,
    postseasonResultClass,
    recordLabel,
    variantLabel,
  } from './cap-rush-presentation.ts';

  let { state }: { state: CapRushHistoryState } = $props();
</script>

<section class="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6" aria-label="Cap Rush history">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
        Cap Rush · History
      </p>
      <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
        Every five you built.
      </h1>
      <p class="mt-2 max-w-xl text-sm text-muted-foreground">
        Completed Cap Rush runs with their regular-season record, cap status and postseason result.
      </p>
    </div>
    <a
      href={resolve('cap-rush/')}
      class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Cap Rush home
    </a>
  </header>

  <div class="mt-4">
    {#if state.loading}
      <div class="flex flex-col gap-2">
        <div
          class="h-3 w-40 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
        ></div>
        <div
          class="h-3 w-64 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
        ></div>
      </div>
    {:else if state.error !== null && state.entries.length === 0}
      <AsyncState kind="error" title="History unavailable" message={state.error} />
    {:else if state.entries.length === 0}
      <AsyncState
        kind="empty"
        title="No completed runs yet"
        message="Draft five players, lock the lineup, and play the 82-game season."
      >
        {#snippet actions()}
          <a
            href={resolve('cap-rush/')}
            class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start a Cap Rush run
          </a>
        {/snippet}
      </AsyncState>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each state.entries as entry (entry.runId)}
          <li>
            <a
              href={resolve('/cap-rush/history/[runId]', { runId: entry.runId })}
              class="history-card flex min-h-20 flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border bg-card p-5 outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-baseline gap-2">
                  <span class="font-display text-3xl font-extrabold tracking-tight tabular-nums">
                    {recordLabel(entry.wins, entry.losses)}
                  </span>
                  {#if entry.perfectSeason}
                    <span
                      class="rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] text-accent uppercase"
                      >82–0</span
                    >
                  {/if}
                  {#if entry.postseason !== undefined}
                    <span
                      class="rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] uppercase {postseasonResultClass(
                        entry.postseason,
                      )}">{postseasonOutcomeLabel(entry.postseason)}</span
                    >
                  {/if}
                  <span
                    class="rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] uppercase {capStatusClass(
                      entry.payrollStatus,
                    )}">{capStatusShortLabel(entry.payrollStatus)}</span
                  >
                </span>
                <span class="mt-0.5 block font-mono text-[10px] text-muted-foreground uppercase">
                  {#if entry.franchise}{entry.franchise.displayName} ·
                  {/if}{variantLabel(entry.variant)} · {formatMillions(entry.payrollDollars)} payroll
                  ·
                  {new Date(entry.completedAtIso).toLocaleDateString()}
                  {#if entry.postseason !== undefined && !entry.postseason.isUserChampion}
                    · Champion: {entry.postseason.championName}
                  {:else if entry.postseason === undefined}
                    · Regular-season run
                  {/if}
                </span>
              </span>
              <span
                class="shrink-0 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 font-mono text-[10px] font-bold text-foreground uppercase"
                >Open report →</span
              >
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .history-card {
    border-left: 3px solid var(--color-primary);
  }
</style>
