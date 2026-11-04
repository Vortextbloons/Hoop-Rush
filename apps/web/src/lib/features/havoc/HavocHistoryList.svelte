<script lang="ts">
  import { resolve } from '$app/paths';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import HistoryEntryCard from '#lib/components/basketball/HistoryEntryCard.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import type { HavocHistoryState } from './havoc-history-state.svelte.js';
  import { havocCompletionStateLabel, havocRecordLabel } from './havoc-presentation';

  let { state }: { state: HavocHistoryState } = $props();
</script>

<section class="h-shell" data-havoc-history>
  <PageHeader
    eyebrow="Hoop Havoc · Hall of Freaks"
    title="Hall of Freaks"
    description="Every squad has a story. Revisit your seasons, wildest powers, and greatest runs."
  />

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
          <ActionLink href={resolve('havoc/')}>Start a Havoc run</ActionLink>
        {/snippet}
      </AsyncState>
    </div>
  {:else}
    <ul class="mt-6 flex flex-col gap-3">
      {#each state.entries as entry (entry.runId)}
        <HistoryEntryCard
          href={resolve('/havoc/history/[runId]', { runId: entry.runId })}
          data-havoc-history-entry={entry.runId}
        >
          {#snippet title()}
            <span class="font-display text-lg font-extrabold tracking-tight uppercase">
              {havocRecordLabel(entry.havocWins, entry.havocLosses)}
              {#if entry.perfectSeason}
                <span class="text-primary">· 82–0</span>
              {/if}
            </span>
          {/snippet}
          {#snippet badges()}
            <Badge tone={entry.comparisonStatus === 'complete' ? 'primary' : 'neutral'}>
              {entry.comparisonStatus === 'complete' ? 'Report ready' : 'Report partial'}
            </Badge>
          {/snippet}
          {#snippet meta()}
            <span class="block">
              {new Date(entry.createdAtIso).toLocaleDateString()}
            </span>
            <span class="block">
              {havocCompletionStateLabel(entry.completionState)} · comparison:
              {entry.comparisonStatus} · updated
              {new Date(entry.updatedAtIso).toLocaleDateString()}
            </span>
          {/snippet}
        </HistoryEntryCard>
      {/each}
    </ul>
  {/if}
</section>
