<script lang="ts">
  import SimulationStatus from '#lib/components/screens/SimulationStatus.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ChampionshipBanner from '#lib/components/screens/ChampionshipBanner.svelte';
  import { resolve } from '$app/paths';
  import { Check, ClipboardList, Dices } from '@lucide/svelte';
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
  import ModeCard from '#lib/components/ui/ModeCard.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import ServiceErrorPanel from '#lib/components/ServiceErrorPanel.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import FullCourtAbandonRun from '#lib/features/full-court/FullCourtAbandonRun.svelte';
  import FullCourtCoachingView from '#lib/features/full-court/FullCourtCoachingView.svelte';
  import FullCourtDraftView from '#lib/features/full-court/FullCourtDraftView.svelte';
  import FullCourtGamecast from '#lib/features/full-court/FullCourtGamecast.svelte';
  import FullCourtRouletteView from '#lib/features/full-court/FullCourtRouletteView.svelte';
  import FullCourtRunSummary from '#lib/features/full-court/FullCourtRunSummary.svelte';
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
    { value: 'home', label: 'Overview' },
    { value: 'team', label: 'Team & Tactics' },
    { value: 'war-room', label: 'War Room' },
    { value: 'league', label: 'League' },
    { value: 'stats', label: 'Stats & Awards' },
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
  const RUN_VARIANT_OPTIONS = [
    {
      id: 'standard' as const,
      title: 'Standard',
      description:
        'Find your franchise player and build a rotation around them while managing payroll.',
      icon: ClipboardList,
    },
    {
      id: 'roulette' as const,
      title: 'Roulette',
      description:
        'Draft and lock your roster, then use spare budget to spin for player mutations.',
      icon: Dices,
    },
  ];
  let selectedVariant = $state<'standard' | 'roulette' | null>(null);
  let selectedPerks = $state<RunPerkKind[]>([]);
  const selectedPerkCost = $derived(
    selectedPerks.reduce((sum, kind) => sum + fullCourtReportPriceDollars(kind), 0),
  );
  const startingBudgetRemaining = $derived(
    FULL_COURT_DEFAULT_MONEY.startingWarChestDollars - selectedPerkCost,
  );
  const selectedVariantLabel = $derived(
    RUN_VARIANT_OPTIONS.find((option) => option.id === selectedVariant)?.title ?? '',
  );

  function togglePerk(kind: RunPerkKind): void {
    selectedPerks = selectedPerks.includes(kind)
      ? selectedPerks.filter((item) => item !== kind)
      : [...selectedPerks, kind];
  }

  function startRun(instance: FullCourtController): void {
    if (selectedVariant === null) return;
    void instance.startDraft(selectedVariant, selectedPerks);
  }

  function selectSection(value: typeof section) {
    // During the postseason the bracket owns the page, so Overview and Playoffs
    // both land on the postseason screen instead of a dead overview.
    section = postseasonMode && !runComplete && value === 'home' ? 'playoffs' : value;
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
  const roulettePreparing = $derived(
    draft?.stage === 'complete' &&
      draft.variant === 'roulette' &&
      draft.roulette !== undefined &&
      draft.roulette.status !== 'finalized',
  );
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
      <div class="mb-4">
        <FullCourtAbandonRun busy={current.busy} onAbandon={() => void abandonRun(current)} />
      </div>
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
            index={current.index}
            season={season.lock.season}
            nextFilmTarget={current.nextFilmTarget()}
            {playoffPreview}
            busy={current.busy}
            preseasonOpen={season.checkpoint.completedThroughSlot === 0}
            practiceOpen={playoff === null && season.checkpoint.completedThroughSlot === 0}
            practice={current.practice}
            {matchupContext}
            {art}
            onMatchupsChange={(assignments) => current.setDefensiveMatchups(assignments)}
            onResetMatchups={() => current.clearDefensiveMatchups()}
            onPurchaseReport={(target) => void current.purchaseReport(target)}
            onRunPractice={(opponentTeamId) => void current.runPractice(opponentTeamId)}
          />
        {/if}
      {:else if section === 'home' && runComplete}
        <section aria-label="Final review" class="space-y-4">
          {#if review === null}
            <p role="status" class="text-sm text-muted-foreground">Loading season summary</p>
          {:else}
            {#await review}
              <p role="status" class="text-sm text-muted-foreground">Loading season summary</p>
            {:then entry}
              {#if entry}
                {#if entry.playoffStatus === 'champion'}
                  <ChampionshipBanner team={entry.teamName} label="Full Court champions" />
                {/if}
                <ResultHero
                  score={entry.regularRecordLabel}
                  scoreLabel={entry.regularRecordLabel + ' regular-season record'}
                  caption={entry.teamName}
                  meta={entry.playoffLabel}
                  tone={entry.playoffStatus === 'champion' ? 'champion' : 'default'}
                />
                <Panel as="section" padding="md" aria-label="Open the final report">
                  <SectionHeading
                    eyebrow="Season complete"
                    title="Your final report"
                    level={2}
                    size="sm"
                    description="Season results, roster detail, league stats and awards, and the full playoff bracket open on their own tabbed page."
                  />
                  <div class="mt-3 flex flex-wrap gap-2">
                    <ActionLink
                      href={resolve('/full-court/report/[runId]', { runId: entry.runId })}
                    >
                      Open final report
                    </ActionLink>
                    <ActionLink href={resolve('/full-court/history')} tone="secondary">
                      Run history
                    </ActionLink>
                  </div>
                </Panel>
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
            activeGamecast = null;
            void current.advance(count, acceptForfeit, false, options);
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
    {:else if roulettePreparing && draft}
      <FullCourtRouletteView
        {draft}
        index={current.index}
        busy={current.busy}
        onPurchaseSpin={(purchase, versionId) => void current.purchaseSpin(purchase, versionId)}
        onSkipSpin={() => void current.skipSpin()}
        onFinalize={() => void current.finalizeRoulette()}
        onPurchaseReport={(target) => void current.purchaseReport(target)}
        onAbandon={() => void abandonRun(current)}
      />
    {:else if draft?.stage === 'drafting' && current.index !== null}
      <FullCourtDraftView
        {draft}
        index={current.index}
        busy={current.busy}
        onPick={(versionId) => void current.editDraft('pick-full-court-player', versionId)}
        onRemove={(versionId) => void current.editDraft('remove-full-court-player', versionId)}
        onPurchaseReport={(target) => void current.purchaseReport(target)}
        onAbandon={() => void abandonRun(current)}
        onFinish={() => {
          selectSection('home');
          void current.editDraft('finish-full-court-draft');
        }}
      />
    {:else if current.busy}
      <p role="status" class="text-sm text-muted-foreground">Opening Full Court…</p>
    {:else if current.index !== null && draft == null}
      <SectionHeading
        title="Build your roster"
        level={2}
        size="md"
        align="start"
        description="Sign 6–12 historical players from a {formatMillions(
          FULL_COURT_DEFAULT_MONEY.startingWarChestDollars,
        )} budget ({formatMillions(FULL_COURT_DEFAULT_MONEY.capLineDollars)} cap, {formatMillions(
          FULL_COURT_DEFAULT_MONEY.firstApronDollars,
        )} first apron, {formatMillions(
          FULL_COURT_DEFAULT_MONEY.hardLimitDollars,
        )} hard limit), set your rotation, and face 29 historical teams."
      />

      <ol class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Draft setup steps">
        {#each [{ step: 1, label: 'Draft format' }, { step: 2, label: 'Pre-run perks' }] as item (item.step)}
          {@const done = item.step === 1 && selectedVariant !== null}
          {@const active = item.step === 1 ? selectedVariant === null : selectedVariant !== null}
          <li class="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            {#if item.step > 1}
              <span class="h-px w-4 bg-line-strong" aria-hidden="true"></span>
            {/if}
            <span
              class="font-display grid h-5 w-5 place-items-center rounded-md border text-[10px] font-extrabold tabular-nums {active
                ? 'border-primary/50 bg-primary/15 text-primary'
                : done
                  ? 'border-line-strong text-foreground'
                  : 'border-line-soft text-muted-foreground'}"
              aria-hidden="true"
            >
              {#if done}<Check size={11} />{:else}{item.step}{/if}
            </span>
            <span class="ui-label" data-tone={active ? 'primary' : 'muted'}>{item.label}</span>
          </li>
        {/each}
      </ol>

      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        {#each RUN_VARIANT_OPTIONS as option (option.id)}
          {@const Icon = option.icon}
          {@const active = selectedVariant === option.id}
          <ModeCard
            title={option.title}
            description={option.description}
            cta={active ? 'Selected' : `Choose ${option.title}`}
            selected={active}
            disabled={current.busy}
            onclick={() => (selectedVariant = option.id)}
            class="h-full"
          >
            {#snippet icon()}<Icon size={22} aria-hidden="true" />{/snippet}
          </ModeCard>
        {/each}
      </div>

      {#if selectedVariant !== null}
        <Panel as="section" padding="md" class="mt-4" aria-label="Pre-run perks">
          <SectionHeading
            level={3}
            size="sm"
            align="start"
            title="Pre-run perks"
            description="Optional upgrades paid from the starting budget. Every perk lasts for the entire run."
          >
            {#snippet actions()}
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">
                  {formatMillions(startingBudgetRemaining)} starting budget
                </Badge>
                <Button size="sm" tone="ghost" onclick={() => (selectedVariant = null)}
                  >Change format</Button
                >
              </div>
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
              {selectedVariantLabel} draft ·
              {selectedPerks.length === 0
                ? 'no perks'
                : `${String(selectedPerks.length)} perk${selectedPerks.length === 1 ? '' : 's'}`}
              · {formatMillions(startingBudgetRemaining)} budget
            </p>
            <Button tone="primary" loading={current.busy} onclick={() => startRun(current)}>
              Start {selectedVariantLabel} draft
            </Button>
          </div>
        </Panel>
      {/if}
    {/if}
  {/if}
</PageShell>
