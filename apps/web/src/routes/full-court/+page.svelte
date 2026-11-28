<script lang="ts">
  import { resolve } from '$app/paths';
  import { ClipboardList, Dices } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { FULL_COURT_DEFAULT_MONEY, fullCourtReportPriceDollars } from '@hoop-rush/data-contracts';
  import {
    defaultFullCourtCoachingRotation,
    fullCourtAssessPurchase,
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
  import FullCourtCoachingView from '#lib/features/full-court/FullCourtCoachingView.svelte';
  import FullCourtDraftView from '#lib/features/full-court/FullCourtDraftView.svelte';
  import FullCourtGamecast from '#lib/features/full-court/FullCourtGamecast.svelte';
  import FullCourtRouletteView from '#lib/features/full-court/FullCourtRouletteView.svelte';
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
  let section = $state<(typeof seasonSections)[number]['value']>('home');
  let confirmNewDraft = $state(false);
  let activeGamecast = $state<'latest' | 'saved' | null>(null);
  const RUN_PERK_OPTIONS = [
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
  let selectedPerks = $state<('lineup-fit' | 'opponent-film' | 'training-camp')[]>([]);
  const selectedPerkCost = $derived(
    selectedPerks.reduce((sum, kind) => sum + fullCourtReportPriceDollars(kind), 0),
  );
  const startingBudgetRemaining = $derived(
    FULL_COURT_DEFAULT_MONEY.startingWarChestDollars - selectedPerkCost,
  );

  function togglePerk(kind: 'lineup-fit' | 'opponent-film' | 'training-camp'): void {
    selectedPerks = selectedPerks.includes(kind)
      ? selectedPerks.filter((item) => item !== kind)
      : [...selectedPerks, kind];
  }

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
  const campBooked = $derived(
    draft?.reports?.some((report) => report.target.kind === 'training-camp') ?? false,
  );
  const campAvailable = $derived(
    season?.checkpoint.completedThroughSlot === 0 &&
      playoff === null &&
      current?.practice == null &&
      draft != null &&
      current?.index != null &&
      (campBooked ||
        fullCourtAssessPurchase({
          index: current.index,
          state: draft,
          priceDollars: fullCourtReportPriceDollars('training-camp'),
        }).legal),
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
              {playoff !== null
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
            {item.label}
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
      {#if section === 'home' && campAvailable}
        <Alert
          class="mb-4"
          title={campBooked ? 'Training Camp is booked' : 'Training Camp is open'}
        >
          Scout your rotation and bench usage in a scrimmage before Game 1.
          {#snippet icon()}
            <ClipboardList size={18} />
          {/snippet}
          {#snippet actions()}
            <Button size="sm" tone="secondary" onclick={() => selectSection('war-room')}>
              Open War Room
            </Button>
          {/snippet}
        </Alert>
      {/if}
      {#if userTeam && defaultRotation}
        <div hidden={section !== 'team'}>
          {#if opponentAdjustment !== null}
            <Alert class="mb-4" title={`Opponent adjustment · ${opponentAdjustment.settingLabel}`}>
              {opponentAdjustment.reasonLabel} · {opponentAdjustment.detailLabel}
              {#snippet actions()}
                <Button size="sm" tone="secondary" onclick={() => selectSection('war-room')}>
                  Review opponent film
                </Button>
              {/snippet}
            </Alert>
          {/if}
          <FullCourtCoachingView
            roster={userTeam.roster}
            {defaultRotation}
            plan={season.coaching}
            readOnly={playoff !== null && playoff.userOutcome.status !== 'pending'}
            health={health ?? null}
            dayOffset={nextUserFixture?.dayOffset ?? null}
            {matchupContext}
            {art}
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
            {playoffPreview}
            busy={current.busy}
            practiceOpen={campBooked ||
              (playoff === null && season.checkpoint.completedThroughSlot === 0)}
            practice={current.practice}
            {matchupContext}
            {art}
            onMatchupsChange={(assignments) => current.setDefensiveMatchups(assignments)}
            onResetMatchups={() => current.clearDefensiveMatchups()}
            onPurchaseReport={(target) => void current.purchaseReport(target)}
            onRunPractice={(opponentTeamId) => void current.runPractice(opponentTeamId)}
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
      <SectionHeading
        title="Build your roster"
        level={2}
        size="md"
        align="start"
        description="Sign 6–12 historical players from a $200M budget ($130M cap, $156M first apron, $182M hard limit), set your rotation, and face 29 historical teams."
      />

      <Panel as="section" padding="md" class="mt-4" aria-label="Pre-run perks">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p class="ui-label text-muted-foreground">Pre-run perks</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Choose upgrades before draft night. Player scouting ({formatMillions(
                fullCourtReportPriceDollars('player-scouting'),
              )} each) is bought per player during the draft.
            </p>
          </div>
          <Badge tone="neutral">
            {formatMillions(startingBudgetRemaining)} starting budget
          </Badge>
        </div>

        <div class="mt-3 grid gap-2 sm:grid-cols-3">
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
                <span class="font-display text-sm font-extrabold uppercase">{perk.title}</span>
                <span class="font-mono text-xs font-bold tabular-nums text-accent">
                  {formatMillions(perk.priceDollars)}
                </span>
              </div>
              <p class="mt-1 text-xs leading-snug text-muted-foreground">{perk.description}</p>
            </button>
          {/each}
        </div>
      </Panel>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <Panel padding="lg" class="flex flex-col items-start border-t-2 border-t-primary">
          <ClipboardList class="mb-4 text-primary" size={24} aria-hidden="true" />
          <SectionHeading title="Standard" level={3} size="sm" align="start" />
          <p class="mt-2 mb-5 flex-1 text-sm text-muted-foreground">
            Find your franchise player and build a rotation around them while managing payroll.
          </p>
          <Button tone="primary" onclick={() => void current.startDraft('standard', selectedPerks)}
            >Start Standard draft</Button
          >
        </Panel>
        <Panel padding="lg" class="flex flex-col items-start border-t-2 border-t-accent">
          <Dices class="mb-4 text-accent" size={24} aria-hidden="true" />
          <SectionHeading title="Roulette" level={3} size="sm" align="start" />
          <p class="mt-2 mb-5 flex-1 text-sm text-muted-foreground">
            Draft and lock your roster, then use spare budget to spin for player mutations.
          </p>
          <Button
            tone="secondary"
            onclick={() => void current.startDraft('roulette', selectedPerks)}
          >
            Start Roulette draft
          </Button>
        </Panel>
      </div>
    {/if}
  {/if}
</PageShell>
