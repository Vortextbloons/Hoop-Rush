<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import LoadingState from '#lib/components/ui/LoadingState.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import { openService } from '#lib/service-state.js';
  import CapRushReportView from '#lib/features/cap-rush/CapRushReportView.svelte';
  import { CapRushResultState } from '#lib/features/cap-rush/cap-rush-result-state.svelte.js';
  import { getCapRushService } from '#lib/features/cap-rush/cap-rush-service.js';

  let resultState = $state<CapRushResultState | null>(null);
  let serviceError = $state<string | null>(null);

  onMount(() => {
    const opened = openService(() => new CapRushResultState(getCapRushService()));
    if (!opened.ok) {
      serviceError = opened.error;
      return;
    }
    const instance = opened.value;
    resultState = instance;
    void instance.load();
    return () => instance.destroy();
  });

  async function startNewRun(): Promise<void> {
    if (resultState === null) return;
    if (await resultState.startNewRun()) await goto(resolve('cap-rush/'));
  }
</script>

<svelte:head>
  <title>Cap Rush Result — Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="lg" padding="md">
  {#if serviceError !== null}
    <ServiceErrorPanel title="Cap Rush could not start" message={serviceError} homeLink />
  {:else if resultState !== null}
    {#if resultState.loading}
      <LoadingState variant="skeleton" lines={2} />
    {:else if resultState.report !== null}
      <header class="mb-4 flex justify-end">
        <ActionRow>
          {#snippet primary()}
            <Button
              tone="primary"
              loading={resultState?.busy ?? false}
              onclick={() => void startNewRun()}
            >
              {resultState?.busy ? 'Starting another run…' : 'Start another run'}
            </Button>
          {/snippet}
        </ActionRow>
      </header>
      <CapRushReportView report={resultState.report} />
      <div class="mt-10 flex justify-center">
        <ActionLink href={resolve('cap-rush/history/')} tone="ghost" size="sm">
          Run history
        </ActionLink>
      </div>
    {:else if resultState.postseasonInProgress}
      <EmptyState
        kind="empty"
        title="The postseason is still running"
        message="Finish the bracket to unlock the champion, Finals MVP and final report."
      >
        {#snippet actions()}
          <ActionLink href={resolve('cap-rush/run/')}>Continue the postseason</ActionLink>
        {/snippet}
      </EmptyState>
    {:else if resultState.seasonInProgress}
      <EmptyState
        kind="empty"
        title="The season is not finished"
        message="Finish all 82 games to unlock the final report."
      >
        {#snippet actions()}
          <ActionLink href={resolve('cap-rush/run/')}>Continue the season</ActionLink>
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        kind="empty"
        title="No completed Cap Rush run"
        message={resultState.error ?? 'Finish an 82-game season to see its report here.'}
      >
        {#snippet actions()}
          <Button onclick={() => void goto(resolve('cap-rush/'))}>Start a Cap Rush run</Button>
        {/snippet}
      </EmptyState>
    {/if}
  {/if}
</PageShell>
