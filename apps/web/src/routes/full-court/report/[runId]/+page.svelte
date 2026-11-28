<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import LoadingState from '#lib/components/ui/LoadingState.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import FullCourtReportView from '#lib/features/full-court/FullCourtReportView.svelte';
  import { loadFullCourtArt, type FullCourtArt } from '#lib/features/full-court/full-court-art.ts';
  import {
    presentFullCourtHistoryEntry,
    type FullCourtHistoryEntryView,
  } from '#lib/features/full-court/full-court-history-presentation.ts';
  import {
    loadFullCourtReport,
    type FullCourtReportData,
  } from '#lib/features/full-court/full-court-report-data.ts';
  import { errorMessageOf } from '#lib/errors.js';

  const runId = $derived(page.params.runId ?? '');

  let loading = $state(true);
  let error = $state<string | null>(null);
  let missing = $state(false);
  let entry = $state.raw<FullCourtHistoryEntryView | null>(null);
  let data = $state.raw<FullCourtReportData | null>(null);
  let art = $state.raw<FullCourtArt | null>(null);

  onMount(() => {
    let active = true;
    const id = runId;
    void (async () => {
      try {
        const [report, loadedArt] = await Promise.all([
          loadFullCourtReport(id),
          loadFullCourtArt().catch(() => null),
        ]);
        if (!active) return;
        art = loadedArt;
        if (report === null) {
          // Fall back to the archived record alone: the summary is still readable.
          const { getPersistence } = await import('#lib/persistence.js');
          const record = await getPersistence().fullCourtHistoryRepository.load(id);
          if (!active) return;
          if (record === null) {
            missing = true;
            return;
          }
          entry = presentFullCourtHistoryEntry(record);
          return;
        }
        data = report;
        entry = presentFullCourtHistoryEntry(report.record);
      } catch (cause) {
        if (active) error = errorMessageOf(cause);
      } finally {
        if (active) loading = false;
      }
    })();
    return () => {
      active = false;
    };
  });
</script>

<svelte:head>
  <title>Full Court final report · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="xl" padding="md" aria-label="Full Court final report">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
    <ActionLink href={resolve('/full-court/history')} tone="ghost" size="sm">
      ← Run history
    </ActionLink>
    <ActionLink href={resolve('/full-court')} tone="ghost" size="sm">Full Court home</ActionLink>
  </div>

  {#if loading}
    <LoadingState variant="skeleton" lines={4} message="Rebuilding the saved season…" />
  {:else if error !== null}
    <EmptyState kind="error" title="Report unavailable" message={error}>
      {#snippet actions()}
        <ActionLink href={resolve('/full-court/history')}>Back to history</ActionLink>
      {/snippet}
    </EmptyState>
  {:else if missing || entry === null}
    <EmptyState
      kind="error"
      title="Run not found"
      message={`No completed Full Court run with id ${runId} was found on this device.`}
    >
      {#snippet actions()}
        <ActionLink href={resolve('/full-court/history')}>Back to history</ActionLink>
      {/snippet}
    </EmptyState>
  {:else if data !== null}
    <FullCourtReportView {entry} {data} {art} />
  {:else}
    <EmptyState
      title="Season detail unavailable"
      message="This run's archived record loaded, but the saved game rows needed for a full report are missing. Its summary is still available in run history."
    >
      {#snippet actions()}
        <ActionLink href={resolve('/full-court/history')}>Run history</ActionLink>
      {/snippet}
    </EmptyState>
  {/if}
</PageShell>
