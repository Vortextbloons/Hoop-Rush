<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultFullCourtCoachingRotation } from '@hoop-rush/engine';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import FullCourtCoachingView from '#lib/features/full-court/FullCourtCoachingView.svelte';
  import FullCourtDraftView from '#lib/features/full-court/FullCourtDraftView.svelte';
  import FullCourtSeasonView from '#lib/features/full-court/FullCourtSeasonView.svelte';
  import { FullCourtController } from '#lib/features/full-court/full-court-controller.svelte.js';
  import { openService } from '#lib/service-state.js';

  let controller = $state.raw<FullCourtController | null>(null);
  let startupError = $state<string | null>(null);
  let coachingOpen = $state(false);

  onMount(() => {
    const opened = openService(() => new FullCourtController());
    if (!opened.ok) {
      startupError = opened.error;
      return;
    }
    const instance = opened.value;
    controller = instance;
    void instance.load();
    return () => instance.dispose();
  });

  const current = $derived(controller);
  const draft = $derived(current?.draft);
  const season = $derived(current?.season);
  const playoff = $derived(current?.playoffs?.view ?? null);
  const league = $derived(season?.lock.season);
  const userTeam = $derived(league?.teams.find((team) => team.teamId === league.userTeamId));
  const defaultRotation = $derived(userTeam && defaultFullCourtCoachingRotation(userTeam));
</script>

<svelte:head>
  <title>Full Court · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="xl" padding="xl">
  {#if draft?.stage !== 'drafting'}
    <PageHeader class="mb-6" eyebrow="Full Court" title="Full Court" />
  {/if}
  {#if startupError !== null}
    <ServiceErrorPanel title="Full Court could not start" message={startupError} homeLink />
  {:else if current === null}
    <p role="status" class="text-sm text-muted-foreground">Opening Full Court…</p>
  {:else}
    {#if current.error !== null}
      <Alert tone="danger" class="mb-4">
        {current.error}
        {#snippet actions()}
          <Button size="sm" tone="secondary" onclick={() => void current.load()}>Reload save</Button
          >
        {/snippet}
      </Alert>
    {/if}

    {#if season}
      {#if userTeam && defaultRotation && (playoff === null || playoff.userOutcome.status === 'pending')}
        <details bind:open={coachingOpen} class="ui-panel mb-4">
          <summary
            class="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring"
          >
            Coaching plan
          </summary>
          {#if coachingOpen}
            <FullCourtCoachingView
              roster={userTeam.roster}
              {defaultRotation}
              plan={season.coaching}
              busy={current.busy}
              onSave={(plan) => current.saveCoaching(plan)}
            />
          {/if}
        </details>
      {/if}
      {#if current.simulating}
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <p role="status" class="text-sm text-muted-foreground">
            {current.stopRequested ? 'Saving the current game…' : 'Simulating…'}
          </p>
          <Button
            size="sm"
            tone="secondary"
            disabled={current.stopRequested}
            onclick={() => current.stopAfterGame()}>Stop after this game</Button
          >
        </div>
      {/if}
      <FullCourtSeasonView
        lock={season.lock}
        checkpoint={season.checkpoint}
        scores={season.scores}
        {playoff}
        busy={current.busy}
        pendingForfeit={current.pendingForfeit}
        onAdvance={(count, acceptForfeit) => void current.advance(count, acceptForfeit)}
        onStartPlayoffs={() => void current.startPlayoffs()}
      />
      {#if playoff !== null && playoff.nextGame === null}
        <Button
          class="mt-6"
          tone="secondary"
          loading={current.busy}
          onclick={() => void current.startDraft()}>Start a new draft</Button
        >
      {/if}
    {:else if draft?.stage === 'drafting' && current.index !== null}
      <FullCourtDraftView
        {draft}
        index={current.index}
        busy={current.busy}
        onPick={(versionId) => void current.editDraft('pick-full-court-player', versionId)}
        onRemove={(versionId) => void current.editDraft('remove-full-court-player', versionId)}
        onFinish={() => void current.editDraft('finish-full-court-draft')}
      />
    {:else if current.busy}
      <p role="status" class="text-sm text-muted-foreground">Opening Full Court…</p>
    {:else if current.index !== null && draft == null}
      <Panel padding="lg" class="max-w-lg">
        <SectionHeading title="Build your roster" level={2} size="sm" align="start" />
        <p class="mt-2 text-sm text-muted-foreground">
          Sign 6–12 historical player seasons, manage your payroll, and face 29 historical teams
          across a full regular season and playoffs.
        </p>
        <Button class="mt-5" tone="primary" onclick={() => void current.startDraft()}>
          Start draft
        </Button>
      </Panel>
    {/if}
  {/if}
</PageShell>
