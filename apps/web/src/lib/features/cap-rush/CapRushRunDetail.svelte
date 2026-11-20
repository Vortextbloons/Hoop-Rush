<script lang="ts">
  import { resolve } from '$app/paths';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import LoadingState from '#lib/components/ui/LoadingState.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import CapRushReportView from './CapRushReportView.svelte';
  import type { CapRushResultState } from './cap-rush-result-state.svelte.js';

  let { state, runId }: { state: CapRushResultState; runId: string } = $props();
</script>

<PageShell as="section" width="lg" padding="md" aria-label="Saved Cap Rush run">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
    <ActionLink href={resolve('cap-rush/history/')} tone="ghost" size="sm">← Run history</ActionLink
    >
    <p class="ui-micro break-all text-muted-foreground">{runId}</p>
  </div>

  {#if state.loading}
    <LoadingState variant="skeleton" lines={2} />
  {:else if state.report !== null}
    <CapRushReportView report={state.report} />
  {:else}
    <EmptyState
      kind="error"
      title="Run unavailable"
      message={state.error ?? `No completed Cap Rush run with id ${runId} was found.`}
    >
      {#snippet actions()}
        <ActionLink href={resolve('cap-rush/history/')}>Back to history</ActionLink>
      {/snippet}
    </EmptyState>
  {/if}
</PageShell>
