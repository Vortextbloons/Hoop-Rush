<script lang="ts">
  import { resolve } from '$app/paths';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import HistoryEntryCard from '#lib/components/basketball/HistoryEntryCard.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
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
  <PageHeader
    eyebrow="Cap Rush · History"
    title="Every five you built."
    description="Completed Cap Rush runs with their regular-season record, cap status and postseason result."
  >
    {#snippet actions()}
      <ActionLink href={resolve('cap-rush/')} tone="secondary">Cap Rush home</ActionLink>
    {/snippet}
  </PageHeader>

  <div class="mt-4">
    {#if state.loading}
      <AsyncState kind="loading" title="Loading history" message="Reading your Cap Rush runs…" />
    {:else if state.error !== null && state.entries.length === 0}
      <AsyncState kind="error" title="History unavailable" message={state.error} />
    {:else if state.entries.length === 0}
      <AsyncState
        kind="empty"
        title="No completed runs yet"
        message="Draft five players, lock the lineup, and play the 82-game season."
      >
        {#snippet actions()}
          <ActionLink href={resolve('cap-rush/')}>Start a Cap Rush run</ActionLink>
        {/snippet}
      </AsyncState>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each state.entries as entry (entry.runId)}
          <HistoryEntryCard
            href={resolve('/cap-rush/history/[runId]', { runId: entry.runId })}
            accent="primary"
          >
            {#snippet title()}
              <span class="font-display text-3xl font-extrabold tracking-tight tabular-nums">
                {recordLabel(entry.wins, entry.losses)}
              </span>
            {/snippet}
            {#snippet badges()}
              {#if entry.perfectSeason}
                <Badge tone="accent" class="px-2 py-0.5 text-[9px]">82–0</Badge>
              {/if}
              {#if entry.postseason !== undefined}
                <Badge class="px-2 py-0.5 text-[9px] {postseasonResultClass(entry.postseason)}">
                  {postseasonOutcomeLabel(entry.postseason)}
                </Badge>
              {/if}
              <Badge class="px-2 py-0.5 text-[9px] {capStatusClass(entry.payrollStatus)}">
                {capStatusShortLabel(entry.payrollStatus)}
              </Badge>
            {/snippet}
            {#snippet meta()}
              <span class="uppercase">
                {#if entry.franchise}{entry.franchise.displayName} ·
                {/if}{variantLabel(entry.variant)} · {formatMillions(entry.payrollDollars)} payroll ·
                {new Date(entry.completedAtIso).toLocaleDateString()}
                {#if entry.postseason !== undefined && !entry.postseason.isUserChampion}
                  · Champion: {entry.postseason.championName}
                {:else if entry.postseason === undefined}
                  · Regular-season run
                {/if}
              </span>
            {/snippet}
            {#snippet trailing()}
              <span
                class="inline-flex rounded-lg border border-line-soft bg-surface-1 px-3 py-2 font-mono text-[10px] font-bold text-foreground uppercase"
              >
                Open report →
              </span>
            {/snippet}
          </HistoryEntryCard>
        {/each}
      </ul>
    {/if}
  </div>
</section>
