<script lang="ts">
  import SimulationStatus from '#lib/components/screens/SimulationStatus.svelte';
  import { resolve } from '$app/paths';
  import { Check } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { FULL_COURT_DEFAULT_MONEY, fullCourtReportPriceDollars } from '@hoop-rush/data-contracts';
  import {
    defaultFullCourtCoachingRotation,
    fullCourtStandings,
    fullCourtWarChestDollars,
  } from '@hoop-rush/engine';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import FullCourtAbandonRun from '#lib/features/full-court/FullCourtAbandonRun.svelte';
  import { historicalThreePointShare } from '#lib/features/full-court/full-court-coaching-presenter.js';
  import FullCourtCoachingView from '#lib/features/full-court/FullCourtCoachingView.svelte';
  import FullCourtDraftView from '#lib/features/full-court/FullCourtDraftView.svelte';
  import FullCourtFinalReview from '#lib/features/full-court/FullCourtFinalReview.svelte';
  import FullCourtGamecast from '#lib/features/full-court/FullCourtGamecast.svelte';
  import { presentFullCourtHistoryEntry } from '#lib/features/full-court/full-court-history-presentation.js';
  import { getPersistence } from '#lib/persistence.js';
  import FullCourtSeasonView from '#lib/features/full-court/FullCourtSeasonView.svelte';
  import FullCourtWarRoom from '#lib/features/full-court/FullCourtWarRoom.svelte';
  import { loadFullCourtArt, type FullCourtArt } from '#lib/features/full-court/full-court-art.js';
  import {
    fullCourtWatchedReplayOutcome,
    fullCourtWatchedReplaySummary,
  } from '#lib/features/full-court/full-court-gamecast.js';
  import { FullCourtController } from '#lib/features/full-court/full-court-controller.svelte.js';
  import type { FullCourtMatchupEditorContext } from '#lib/features/full-court/full-court-matchup-presenter.js';
  import {
    fullCourtNextUserFixture,
    fullCourtPlayoffAdaptationRead,
  } from '#lib/features/full-court/full-court-season-presenter.js';
  import { openService } from '#lib/service-state.js';

  let controller = $state.raw<FullCourtController | null>(null);
  let art = $state.raw<FullCourtArt | null>(null);
  let startupError = $state<string | null>(null);
  const seasonSections = [
    { value: 'home', label: 'Season' },
    { value: 'team', label: 'Team' },
    { value: 'war-room', label: 'War Room' },
    { value: 'league', label: 'League' },
    { value: 'stats', label: 'Stats' },
    { value: 'playoffs', label: 'Playoffs' },
  ] as const;
  let confirmNewDraft = $state(false);
  let activeGamecast = $state<'latest' | 'saved' | null>(null);
  const RUN_PERK_OPTIONS = [
    {
      kind: 'player-scouting' as const,
      title: 'Scouting',
      priceDollars: fullCourtReportPriceDollars('player-scouting'),
      description:
        'Unlock Show playstyle across the draft to view attributes, tendencies, and roles.',
    },
    {
      kind: 'lineup-fit' as const,
      title: 'Roster fit',
      priceDollars: fullCourtReportPriceDollars('lineup-fit'),
      description: 'Live roster strengths and gaps from draft night through the season.',
    },
    {
      kind: 'opponent-film' as const,
      title: 'Opponent film',
      priceDollars: fullCourtReportPriceDollars('opponent-film'),
      description: 'One-time league scan surfacing top contenders and their weaknesses.',
    },
    {
      kind: 'training-camp' as const,
      title: 'Training camp',
      priceDollars: fullCourtReportPriceDollars('training-camp'),
      description: 'Sandbox scrimmage simulator against random or chosen league opponents.',
    },
  ];
  type RunPerkKind = (typeof RUN_PERK_OPTIONS)[number]['kind'];
  let selectedPerks = $state<RunPerkKind[]>([]);
  const selectedPerkCost = $derived(
    selectedPerks.reduce((sum, kind) => sum + fullCourtReportPriceDollars(kind), 0),
  );
  const startingBudgetRemaining = $derived(
    FULL_COURT_DEFAULT_MONEY.startingWarChestDollars - selectedPerkCost,
  );
  function togglePerk(kind: RunPerkKind): void {
    selectedPerks = selectedPerks.includes(kind)
      ? selectedPerks.filter((item) => item !== kind)
      : [...selectedPerks, kind];
  }

  function startRun(instance: FullCourtController): void {
    void instance.startDraft('standard', selectedPerks);
  }

  function selectSection(value: typeof section) {
    // During the postseason the bracket owns the page, so Overview and Playoffs
    // both land on the postseason screen instead of a dead overview.
    section = postseasonMode && !runComplete && value === 'home' ? 'playoffs' : value;
    confirmNewDraft = false;
  }

  async function abandonRun(instance: FullCourtController): Promise<void> {
    await instance.abandonRun();
    if (instance.draft === null) {
      section = 'home';
      activeGamecast = null;
    }
  }

  onMount(() => {
    let mounted = true;
    const opened = openService(() => new FullCourtController());
    if (!opened.ok) {
      startupError = opened.error;
      return;
    }
    const instance = opened.value;
    controller = instance;
    void instance.load();
    void loadFullCourtArt()
      .then((loaded) => {
        if (mounted) art = loaded;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      instance.dispose();
    };
  });

  const current = $derived(controller);
  const draft = $derived(current?.draft);
  const season = $derived(current?.season);
  const playoff = $derived(current?.playoffs?.view ?? null);
  const playoffPreview = $derived(current?.nextPlayoffPreview() ?? null);
  const opponentAdjustment = $derived(
    playoffPreview?.adaptation == null
      ? null
      : fullCourtPlayoffAdaptationRead(playoffPreview.adaptation),
  );
  const league = $derived(season?.lock.season);
  const userTeam = $derived(league?.teams.find((team) => team.teamId === league.userTeamId));
  const userIdentity = $derived(
    userTeam === undefined || art === null ? null : art.teamFor(userTeam.teamId),
  );
  const userStandingsRow = $derived.by(() => {
    if (!season || !userTeam) return null;
    const table = fullCourtStandings(season.lock.season.teams, season.scores);
    return [...table.west, ...table.east].find((row) => row.teamId === userTeam.teamId) ?? null;
  });
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
  const leagueThreePointShare = $derived.by(() => {
    const shares = (season?.lock.season.teams ?? [])
      .filter((team) => team.teamId !== userTeam?.teamId)
      .map((team) => historicalThreePointShare(team.roster))
      .filter((share): share is number => share !== null);
    return shares.length === 0
      ? null
      : shares.reduce((sum, share) => sum + share, 0) / shares.length;
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

  /**
   * Once the regular season is over the postseason screen is the only place that
   * advances the bracket, so the page lands there and stays there until the
   * champion is crowned. The nav still allows reading other tabs.
   */
  const postseasonMode = $derived(
    playoff !== null || (season?.checkpoint.completedThroughSlot ?? 0) >= 82,
  );
  const runComplete = $derived(playoff?.championTeamId != null);
  let section = $derived<(typeof seasonSections)[number]['value']>(
    postseasonMode && !runComplete ? 'playoffs' : 'home',
  );
  const review = $derived(
    runComplete && season && current?.busy === false
      ? getPersistence()
          .fullCourtHistoryRepository.load(season.lock.season.runId)
          .then((record) => (record === null ? null : presentFullCourtHistoryEntry(record)))
          .catch(() => null)
      : null,
  );
</script>

<svelte:head>
  <title>Full Court · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="lg" padding="md">
  {#if draft?.stage !== 'drafting' && !season}
    <PageHeader class="mb-5" eyebrow="Season mode" title="Full Court">
      {#snippet actions()}
        <ActionLink href={resolve('/full-court/history')} tone="secondary"
          >Season history</ActionLink
        >
      {/snippet}
    </PageHeader>
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
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          {#if userIdentity && art}
            <TeamLogo
              manifest={art.manifest}
              franchiseId={userIdentity.franchiseId}
              teamExternalId={userIdentity.teamExternalId}
              alt=""
              className="h-12 w-12"
            />
          {/if}
          <div class="min-w-0">
            <p class="ui-label">
              Full Court ·
              {runComplete
                ? 'Season complete'
                : playoff !== null
                  ? 'Postseason'
                  : `Game ${String(season.checkpoint.completedThroughSlot)} of 82`}
            </p>
            <h1
              class="font-display mt-0.5 truncate text-3xl font-extrabold tracking-tight uppercase sm:text-4xl"
            >
              {userTeam?.displayName ?? 'Your Franchise'}
            </h1>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if userStandingsRow !== null}
            <span
              class="rounded-lg border border-line-soft bg-surface-1 px-3 py-1.5 font-mono text-[10px] font-bold tabular-nums uppercase"
            >
              {userStandingsRow.wins}–{userStandingsRow.losses} · #{userStandingsRow.seed}
              {userStandingsRow.conference}
            </span>
          {/if}
          {#if draft}
            <span
              class="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-[10px] font-bold tabular-nums text-accent uppercase"
            >
              {formatMillions(fullCourtWarChestDollars(draft))} Budget
            </span>
          {/if}
          <a
            href={resolve('/full-court/history')}
            class="rounded-lg border border-line-soft bg-surface-1 px-3 py-1.5 font-mono text-[10px] font-bold text-muted-foreground uppercase transition-colors hover:border-line-strong hover:text-foreground"
          >
            History
          </a>
        </div>
      </header>

      <nav
        aria-label="Full Court season"
        class="mt-4 mb-5 flex flex-wrap gap-1 border-b border-line-soft pb-2"
      >
        {#each seasonSections as item (item.value)}
          <button
            type="button"
            aria-current={section === item.value ? 'page' : undefined}
            onclick={() => selectSection(item.value)}
            class="font-display relative flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-extrabold tracking-wide uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {section ===
            item.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
          >
            {item.value === 'home' && runComplete ? 'Final Review' : item.label}
            {#if item.value === 'playoffs' && playoff !== null && playoff.championTeamId === null}
              <span
                class="h-1.5 w-1.5 rounded-full {section === item.value
                  ? 'bg-primary-foreground'
                  : 'bg-accent'}"
                aria-hidden="true"
              ></span>
            {/if}
          </button>
        {/each}
      </nav>
      {#if current.simulating && (section === 'team' || section === 'war-room')}
        <SimulationStatus
          class="mb-4"
          label="Simulation progress"
          progress={current.simProgress}
          stopping={current.stopRequested}
          onStop={() => current.stopAfterGame()}
        />
      {/if}
      {#if userTeam && defaultRotation}
        <div hidden={section !== 'team'}>
          <FullCourtCoachingView
            roster={userTeam.roster}
            scoutedRoster={draft?.reports?.some((report) => report.target.kind === 'lineup-fit')
              ? draft.picks.map((pick) => pick.player)
              : null}
            {defaultRotation}
            plan={season.coaching}
            opponent={matchupContext?.opponentTeam ?? null}
            {leagueThreePointShare}
            readOnly={playoff !== null && playoff.userOutcome.status !== 'pending'}
            health={health ?? null}
            dayOffset={nextUserFixture?.dayOffset ?? null}
            {art}
            busy={current.busy}
            onSave={(plan) => current.saveCoaching(plan)}
            onListBlueprints={() => current.listBlueprints()}
            onSaveBlueprint={(name, tactics, options) =>
              current.saveBlueprint(name, tactics, options)}
            onRemoveBlueprint={(name) => current.removeBlueprint(name)}
          />
          <div class="mt-6 border-t border-line-soft pt-3">
            <p class="ui-micro mb-1">Run management</p>
            <FullCourtAbandonRun busy={current.busy} onAbandon={() => void abandonRun(current)} />
          </div>
        </div>
      {/if}
      {#if section === 'war-room'}
        {#if opponentAdjustment !== null}
          <Alert class="mb-4" title={`Opponent adjustment: ${opponentAdjustment.settingLabel}`}>
            {opponentAdjustment.reasonLabel}. {opponentAdjustment.detailLabel}
          </Alert>
        {/if}
        {#if draft && current.index}
          <FullCourtWarRoom
            {draft}
            season={season.lock.season}
            {playoffPreview}
            busy={current.busy}
            practiceOpen={playoff === null && season.checkpoint.completedThroughSlot === 0}
            practice={current.practice}
            {matchupContext}
            {art}
            onMatchupsChange={(assignments) => current.setDefensiveMatchups(assignments)}
            onResetMatchups={() => current.clearDefensiveMatchups()}
            onRunPractice={(opponentTeamId) => void current.runPractice(opponentTeamId)}
          />
        {/if}
      {:else if section === 'home' && runComplete}
        <section aria-label="Final review">
          {#if review === null}
            <p role="status" class="text-sm text-muted-foreground">Loading season summary</p>
          {:else}
            {#await review}
              <p role="status" class="text-sm text-muted-foreground">Loading season summary</p>
            {:then entry}
              {#if entry}
                <FullCourtFinalReview
                  {entry}
                  userRow={userStandingsRow}
                  {art}
                  identity={userIdentity}
                  busy={current.busy}
                  onStartNewGame={() => void abandonRun(current)}
                />
              {:else}
                <Alert tone="warning" title="Season summary unavailable">
                  You can still review the standings, stats, awards, and playoff bracket.
                </Alert>
              {/if}
            {/await}
          {/if}
        </section>
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
          simulating={current.simulating}
          simProgress={current.simProgress}
          stopRequested={current.stopRequested}
          onStopAfterGame={() => current.stopAfterGame()}
          pendingForfeit={current.pendingForfeit}
          notice={current.notice}
          {art}
          onDismissNotice={() => current.clearNotice()}
          onAdvance={(count, acceptForfeit, options) => {
            if (count === 1) {
              void (async () => {
                const previous = current.latestGame;
                activeGamecast = null;
                await current.advance(1, acceptForfeit, true, options);
                if (current.latestGame !== previous && current.latestGame?.tape != null) {
                  activeGamecast = 'latest';
                }
              })();
            } else {
              activeGamecast = null;
              void current.advance(count, acceptForfeit, false, options);
            }
          }}
          onRestingChange={(playerIds) => current.setRestingPlayers(playerIds)}
          onStartPlayoffs={() => void current.startPlayoffs()}
          onEditGamePlan={() => selectSection('team')}
        />
      {/if}
      {#if (section === 'home' || section === 'playoffs') && (current.latestGame !== null || savedReplay !== null)}
        <div class="mt-3 space-y-3">
          {#if activeGamecast === 'latest' && current.latestGame !== null}
            {#key current.latestGame.result.seed}
              <FullCourtGamecast
                game={current.latestGame}
                userTeamId={season.lock.season.userTeamId}
                {art}
                onClose={() => (activeGamecast = null)}
              />
            {/key}
          {:else if activeGamecast === 'saved' && savedReplay !== null && savedReplaySummary !== null}
            {#key `saved:${savedReplaySummary.gameId}:${savedReplaySummary.gameSeed}`}
              <FullCourtGamecast
                game={fullCourtWatchedReplayOutcome(savedReplay)}
                userTeamId={season.lock.season.userTeamId}
                replayNote={savedReplaySummary.replayNote}
                {art}
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
      {#if section === 'home' && runComplete}
        {#if confirmNewDraft}
          <Alert class="mt-6" tone="warning" title="Start a new draft?">
            This run is already saved to history. Clearing the active save returns you to draft
            setup, where you pick a format and pre-run perks.
            {#snippet actions()}
              <Button tone="secondary" onclick={() => (confirmNewDraft = false)}
                >Keep this run</Button
              >
              <Button
                tone="primary"
                loading={current.busy}
                onclick={() => {
                  confirmNewDraft = false;
                  void abandonRun(current);
                }}
              >
                Back to draft setup
              </Button>
            {/snippet}
          </Alert>
        {:else}
          <Button class="mt-6" tone="secondary" onclick={() => (confirmNewDraft = true)}>
            Start a new draft
          </Button>
        {/if}
      {/if}
    {:else if draft?.stage === 'drafting' && current.index !== null}
      <FullCourtDraftView
        {draft}
        index={current.index}
        busy={current.busy}
        onPick={(versionId) => void current.editDraft('pick-full-court-player', versionId)}
        onRemove={(versionId) => void current.editDraft('remove-full-court-player', versionId)}
        onAbandon={() => void abandonRun(current)}
        onFinish={() => {
          selectSection('home');
          void current.editDraft('finish-full-court-draft');
        }}
      />
    {:else if current.busy}
      <p role="status" class="text-sm text-muted-foreground">Opening Full Court…</p>
    {:else if current.index !== null && draft == null}
      <SectionHeading title="Build your roster" level={2} size="md" align="start" />

      <Panel as="section" padding="md" class="mt-4" aria-label="Pre-run perks">
        <SectionHeading
          level={3}
          size="sm"
          align="start"
          title="Pre-run perks"
          description="Optional upgrades paid from the starting budget. Every perk lasts the entire run and can only be chosen now."
        >
          {#snippet actions()}
            <Badge tone="neutral">{formatMillions(startingBudgetRemaining)} starting budget</Badge>
          {/snippet}
        </SectionHeading>

        <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {#each RUN_PERK_OPTIONS as perk (perk.kind)}
            {@const active = selectedPerks.includes(perk.kind)}
            <button
              type="button"
              aria-pressed={active}
              onclick={() => togglePerk(perk.kind)}
              class="flex flex-col items-start rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {active
                ? 'border-primary bg-primary/10'
                : 'border-border bg-surface-1 hover:border-line-strong'}"
            >
              <div class="flex w-full items-baseline justify-between gap-2">
                <span
                  class="font-display flex items-center gap-1.5 text-sm font-extrabold uppercase"
                >
                  {perk.title}
                  {#if active}
                    <Check class="text-primary" size={14} aria-hidden="true" />
                  {/if}
                </span>
                <span class="font-mono text-xs font-bold tabular-nums text-accent">
                  {formatMillions(perk.priceDollars)}
                </span>
              </div>
              <p class="mt-1 text-xs leading-snug text-muted-foreground">{perk.description}</p>
            </button>
          {/each}
        </div>

        <div
          class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4"
        >
          <p class="font-mono text-[10px] text-muted-foreground uppercase">
            {selectedPerks.length === 0
              ? 'No perks'
              : `${String(selectedPerks.length)} perk${selectedPerks.length === 1 ? '' : 's'} · ${formatMillions(selectedPerkCost)} spent`}
            · {formatMillions(startingBudgetRemaining)} budget
          </p>
          <Button tone="primary" loading={current.busy} onclick={() => startRun(current)}>
            Start draft
          </Button>
        </div>
      </Panel>
    {/if}
  {/if}
</PageShell>
