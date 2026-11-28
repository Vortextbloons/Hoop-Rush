<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import FullCourtRunSummary from '#lib/features/full-court/FullCourtRunSummary.svelte';
  import { errorMessageOf } from '#lib/errors.js';
  import {
    presentFullCourtHistoryEntry,
    type FullCourtHistoryEntryView,
  } from '#lib/features/full-court/full-court-history-presentation.js';
  import { getPersistence } from '#lib/persistence.js';

  let loading = $state(true);
  let error = $state<string | null>(null);
  let entries = $state.raw<FullCourtHistoryEntryView[]>([]);

  onMount(() => {
    let active = true;
    void getPersistence()
      .fullCourtHistoryRepository.list()
      .then((records) => {
        if (!active) return;
        entries = records.map(presentFullCourtHistoryEntry);
      })
      .catch((cause) => {
        if (!active) return;
        error = errorMessageOf(cause);
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });
</script>

<svelte:head>
  <title>Full Court History · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="lg" padding="md" aria-label="Full Court history">
  <PageHeader
    eyebrow="Full Court · History"
    title="Completed seasons."
    description="Finished Full Court runs with their variant, roster, coaching strategy, economy, playoff finish, and achievements."
  >
    {#snippet actions()}
      <ActionLink href={resolve('/full-court')} tone="secondary">Full Court home</ActionLink>
      <ActionLink href={resolve('/profile')} tone="secondary">Profile</ActionLink>
    {/snippet}
  </PageHeader>

  <div class="mt-4">
    {#if loading}
      <EmptyState
        kind="loading"
        title="Loading history"
        message="Reading your completed Full Court runs…"
      />
    {:else if error !== null && entries.length === 0}
      <EmptyState kind="error" title="History unavailable" message={error} />
    {:else if entries.length === 0}
      <EmptyState
        kind="empty"
        title="No completed Full Court runs yet"
        message="Complete the 82-game regular season and playoffs in Full Court to archive a run here."
      >
        {#snippet actions()}
          <ActionLink href={resolve('/full-court')}>Open Full Court</ActionLink>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each entries as entry (entry.runId)}
          <li class="space-y-2">
            <FullCourtRunSummary {entry} />
            <div class="flex flex-wrap gap-2 px-1">
              <ActionLink
                href={resolve('/full-court/report/[runId]', { runId: entry.runId })}
                size="sm"
              >
                Open final report
              </ActionLink>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</PageShell>
