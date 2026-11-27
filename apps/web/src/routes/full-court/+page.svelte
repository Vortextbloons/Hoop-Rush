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
  import FullCourtGamecast from '#lib/features/full-court/FullCourtGamecast.svelte';
  import FullCourtRouletteView from '#lib/features/full-court/FullCourtRouletteView.svelte';
  import FullCourtSeasonView from '#lib/features/full-court/FullCourtSeasonView.svelte';
  import FullCourtWarRoom from '#lib/features/full-court/FullCourtWarRoom.svelte';
  import {
    fullCourtWatchedReplayOutcome,
    fullCourtWatchedReplaySummary,
  } from '#lib/features/full-court/full-court-gamecast.js';
  import { FullCourtController } from '#lib/features/full-court/full-court-controller.svelte.js';
  import type { FullCourtMatchupEditorContext } from '#lib/features/full-court/full-court-matchup-presenter.js';
  import { fullCourtNextUserFixture } from '#lib/features/full-court/full-court-season-presenter.js';
  import { openService } from '#lib/service-state.js';

  let controller = $state.raw<FullCourtController | null>(null);
  let startupError = $state<string | null>(null);
  const seasonSections = [
    { value: 'home', label: 'Overview' },
    { value: 'team', label: 'Team' },
    { value: 'war-room', label: 'War Room' },
    { value: 'league', label: 'League' },
    { value: 'stats', label: 'Stats' },
    { value: 'playoffs', label: 'Playoffs' },
  ] as const;
  let section = $state<(typeof seasonSections)[number]['value']>('home');
  let confirmNewDraft = $state(false);
  let activeGamecast = $state<'latest' | 'saved' | null>(null);

  function selectSection(value: typeof section) {
    section = value;
    confirmNewDraft = false;
  }

  async function watchNextGame(instance: FullCourtController): Promise<void> {
    const previous = instance.latestGame;
    activeGamecast = null;
    await instance.advance(1, false, true);
    if (instance.latestGame !== previous && instance.latestGame?.tape != null) {
      activeGamecast = 'latest';
    }
  }

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
  const roulettePreparing = $derived(
    draft?.stage === 'complete' &&
      draft.variant === 'roulette' &&
      draft.roulette !== undefined &&
      draft.roulette.status !== 'finalized',
  );
  const playoff = $derived(current?.playoffs?.view ?? null);
  const league = $derived(season?.lock.season);
  const userTeam = $derived(league?.teams.find((team) => team.teamId === league.userTeamId));
  const health = $derived(
    userTeam && season
      ? (current?.playoffs?.checkpoint.healthByTeam ?? season.checkpoint.healthByTeam)[
          userTeam.teamId
        ]
      : undefined,
  );
  const nextUserFixture = $derived(
    season ? fullCourtNextUserFixture(season.lock, season.checkpoint, playoff) : null,
  );
  const allHealth = $derived(
    current?.playoffs?.checkpoint.healthByTeam ?? season?.checkpoint.healthByTeam ?? null,
  );
  const matchupContext = $derived.by((): FullCourtMatchupEditorContext | null => {
    if (!current || !season || !userTeam || !nextUserFixture) return null;
    const opponentId =
      nextUserFixture.homeTeamId === userTeam.teamId
        ? nextUserFixture.awayTeamId
        : nextUserFixture.homeTeamId;
    const opponentTeam = season.lock.season.teams.find((team) => team.teamId === opponentId);
    if (!opponentTeam) return null;
    return {
      fixture: nextUserFixture,
      userTeam,
      opponentTeam,
      userHealth: allHealth?.[userTeam.teamId] ?? null,
      opponentHealth: allHealth?.[opponentTeam.teamId] ?? null,
      restingPlayerIds: current.restingPlayerIds,
      coachingPlan: season.coaching,
      assignments: current.defensiveMatchupAssignments,
      forGameId: current.defensiveMatchupsForGameId,
      forOpponentId: current.defensiveMatchupsOpponentId,
    };
  });
  const defaultRotation = $derived(userTeam && defaultFullCourtCoachingRotation(userTeam));
  const savedReplay = $derived(current?.savedReplay ?? null);
  const savedReplaySummary = $derived(
    savedReplay === null ? null : fullCourtWatchedReplaySummary(savedReplay),
  );
  const latestMatchesSaved = $derived(
    current?.latestGame != null &&
      savedReplaySummary !== null &&
      current.latestGame.result.seed === savedReplaySummary.gameSeed,
  );
</script>

<svelte:head>
  <title>Full Court · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="xl" padding="xl">
  {#if draft?.stage !== 'drafting'}
    <PageHeader class="mb-6" eyebrow="Basketball simulation" title="Full Court" />
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
      <nav
        aria-label="Full Court season"
        class="mb-5 grid grid-cols-3 gap-1 rounded-xl border border-border p-1 sm:grid-cols-6"
      >
        {#each seasonSections as item (item.value)}
          <Button
            class="min-h-11 px-1"
            tone={section === item.value ? 'primary' : 'secondary'}
            aria-current={section === item.value ? 'page' : undefined}
            onclick={() => selectSection(item.value)}>{item.label}</Button
          >
        {/each}
      </nav>
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
      {#if userTeam && defaultRotation}
        <div hidden={section !== 'team'}>
          <FullCourtCoachingView
            roster={userTeam.roster}
            {defaultRotation}
            plan={season.coaching}
            readOnly={playoff !== null && playoff.userOutcome.status !== 'pending'}
            health={health ?? null}
            dayOffset={nextUserFixture?.dayOffset ?? null}
            {matchupContext}
            onMatchupsChange={(assignments) => current.setDefensiveMatchups(assignments)}
            onResetMatchups={() => current.clearDefensiveMatchups()}
            busy={current.busy}
            onSave={(plan) => current.saveCoaching(plan)}
            onListBlueprints={() => current.listBlueprints()}
            onSaveBlueprint={(name, tactics, options) =>
              current.saveBlueprint(name, tactics, options)}
            onRemoveBlueprint={(name) => current.removeBlueprint(name)}
          />
        </div>
      {/if}
      {#if section === 'war-room'}
        {#if draft && current.index}
          <FullCourtWarRoom
            {draft}
            index={current.index}
            season={season.lock.season}
            nextFilmTarget={current.nextFilmTarget()}
            playoffPreview={current.nextPlayoffPreview()}
            busy={current.busy}
            practiceOpen={playoff === null && season.checkpoint.completedThroughSlot === 0}
            practice={current.practice}
            {matchupContext}
            onMatchupsChange={(assignments) => current.setDefensiveMatchups(assignments)}
            onResetMatchups={() => current.clearDefensiveMatchups()}
            onPurchaseReport={(target) => void current.purchaseReport(target)}
            onRunPractice={() => void current.runPractice()}
          />
        {/if}
      {:else if section !== 'team'}
        <FullCourtSeasonView
          {section}
          lock={season.lock}
          checkpoint={season.checkpoint}
          scores={season.scores}
          {playoff}
          health={health ?? null}
          restingPlayerIds={current.restingPlayerIds}
          busy={current.busy}
          pendingForfeit={current.pendingForfeit}
          onAdvance={(count, acceptForfeit) => {
            activeGamecast = null;
            void current.advance(count, acceptForfeit);
          }}
          onRestingChange={(playerIds) => current.setRestingPlayers(playerIds)}
          onStartPlayoffs={() => void current.startPlayoffs()}
          onWatchNextGame={() => void watchNextGame(current)}
        />
      {/if}
      {#if (section === 'home' || section === 'playoffs') && (current.latestGame !== null || savedReplay !== null)}
        <div class="mt-3 space-y-3">
          {#if activeGamecast === 'latest' && current.latestGame !== null}
            {#key current.latestGame.result.seed}
              <FullCourtGamecast
                game={current.latestGame}
                userTeamId={season.lock.season.userTeamId}
                onClose={() => (activeGamecast = null)}
              />
            {/key}
          {:else if activeGamecast === 'saved' && savedReplay !== null && savedReplaySummary !== null}
            {#key `saved:${savedReplaySummary.gameId}:${savedReplaySummary.gameSeed}`}
              <FullCourtGamecast
                game={fullCourtWatchedReplayOutcome(savedReplay)}
                userTeamId={season.lock.season.userTeamId}
                replayNote={savedReplaySummary.replayNote}
                onClose={() => (activeGamecast = null)}
              />
            {/key}
          {/if}

          <div class="flex flex-wrap items-center gap-2">
            {#if current.latestGame !== null && activeGamecast !== 'latest'}
              <Button tone="secondary" onclick={() => (activeGamecast = 'latest')}>
                Game report
              </Button>
            {/if}
            {#if savedReplaySummary !== null && !latestMatchesSaved && activeGamecast !== 'saved'}
              <Button tone="secondary" onclick={() => (activeGamecast = 'saved')}>
                Watch saved replay · {savedReplaySummary.gameLabel} ({savedReplaySummary.scoreLabel})
              </Button>
            {/if}
          </div>
        </div>
      {/if}
      {#if section === 'home' && playoff !== null && playoff.nextGame === null}
        {#if confirmNewDraft}
          <Alert class="mt-6" tone="warning" title="Start a new draft?">
            Your next roster will replace this run as the active save.
            {#snippet actions()}
              <Button tone="secondary" onclick={() => (confirmNewDraft = false)}
                >Keep this run</Button
              >
              <Button
                tone="primary"
                loading={current.busy}
                onclick={() => void current.startDraft()}
              >
                Start a new draft
              </Button>
              <Button
                tone="secondary"
                loading={current.busy}
                onclick={() => void current.startDraft('roulette')}
              >
                Start Roulette draft
              </Button>
            {/snippet}
          </Alert>
        {:else}
          <Button class="mt-6" tone="secondary" onclick={() => (confirmNewDraft = true)}>
            Start a new draft
          </Button>
        {/if}
      {/if}
    {:else if roulettePreparing && draft}
      <FullCourtRouletteView
        {draft}
        index={current.index}
        busy={current.busy}
        onPurchaseSpin={(purchase, versionId) => void current.purchaseSpin(purchase, versionId)}
        onSkipSpin={() => void current.skipSpin()}
        onFinalize={() => void current.finalizeRoulette()}
        onPurchaseReport={(target) => void current.purchaseReport(target)}
      />
    {:else if draft?.stage === 'drafting' && current.index !== null}
      <FullCourtDraftView
        {draft}
        index={current.index}
        busy={current.busy}
        onPick={(versionId) => void current.editDraft('pick-full-court-player', versionId)}
        onRemove={(versionId) => void current.editDraft('remove-full-court-player', versionId)}
        onPurchaseReport={(target) => void current.purchaseReport(target)}
        onFinish={() => {
          selectSection('home');
          void current.editDraft('finish-full-court-draft');
        }}
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
        <Button class="mt-2" tone="secondary" onclick={() => void current.startDraft('roulette')}>
          Start Roulette draft
        </Button>
      </Panel>
    {/if}
  {/if}
</PageShell>
