<script lang="ts">
  import SimulationStatus from '#lib/components/screens/SimulationStatus.svelte';
  import {
    CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    CAP_RUSH_CONFERENCE_NAMES,
    franchiseAbbreviation,
    type FullCourtSeasonCheckpoint,
    type FullCourtSeasonScore,
    type FullCourtTeamHealth,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { ChevronDown, FastForward, Play, ShieldAlert, SkipForward, Trophy } from '@lucide/svelte';
  import {
    buildFullCourtAwards,
    buildFullCourtPlayerSeasonStats,
    buildFullCourtSeasonStats,
    fullCourtStandings,
    type FullCourtSeasonLock,
  } from '@hoop-rush/engine';
  import { onMount, tick } from 'svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import ConferenceStandingsTable from '#lib/components/basketball/ConferenceStandingsTable.svelte';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import ScheduleGrid from '#lib/components/screens/ScheduleGrid.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import type { ScheduleCell } from '#lib/components/ui/types.js';
  import { getManifest } from '#lib/data.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtAwardsPanel from './FullCourtAwardsPanel.svelte';
  import FullCourtGameDayPanel from './FullCourtGameDayPanel.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtPostseasonView from './FullCourtPostseasonView.svelte';
  import FullCourtTeamDetail from './FullCourtTeamDetail.svelte';
  import {
    fullCourtGameDayReadiness,
    fullCourtHomeControls,
    fullCourtNextUserFixture,
    fullCourtResultOf,
    fullCourtUserSchedule,
    type FullCourtAdvanceOptions,
    type FullCourtHomeAction,
    type FullCourtPlayoffView,
    type FullCourtSeasonSection,
    type FullCourtSimulationNotice,
  } from './full-court-season-presenter.ts';

  let {
    lock,
    checkpoint,
    scores,
    playoff,
    pendingForfeit,
    busy,
    onAdvance,
    onStartPlayoffs,
    health = null,
    restingPlayerIds = [],
    onRestingChange,
    section = 'home',
    notice = null,
    onDismissNotice,
    art = null,
    simulating = false,
    simProgress = null,
    stopRequested = false,
    onStopAfterGame,
    onEditGamePlan,
  }: {
    lock: FullCourtSeasonLock;
    checkpoint: FullCourtSeasonCheckpoint;
    scores: readonly FullCourtSeasonScore[];
    playoff: FullCourtPlayoffView | null;
    pendingForfeit: boolean;
    busy: boolean;
    onAdvance: (count: number, acceptForfeit?: boolean, options?: FullCourtAdvanceOptions) => void;
    onStartPlayoffs: () => void;
    health?: FullCourtTeamHealth | null;
    restingPlayerIds?: readonly string[];
    onRestingChange?: (playerIds: readonly string[]) => void;
    section?: FullCourtSeasonSection;
    /** Typed stop feedback from the controller. */
    notice?: FullCourtSimulationNotice | null;
    onDismissNotice?: () => void;
    art?: FullCourtArt | null;
    simulating?: boolean;
    simProgress?: { readonly completed: number; readonly total: number } | null;
    stopRequested?: boolean;
    onStopAfterGame?: () => void;
    onEditGamePlan?: () => void;
  } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let showAllLineups = $state(false);
  let impactView = $state<'players' | 'fives'>('players');
  let impactPlayerId = $state<string | null>(null);
  let impactDetails = $state<HTMLDivElement>();

  async function toggleImpactDetails(playerId: string): Promise<void> {
    impactPlayerId = impactPlayerId === playerId ? null : playerId;
    if (impactPlayerId === null) return;
    await tick();
    impactDetails?.scrollIntoView({ block: 'nearest' });
  }
  let selectedTeamId = $state<string | null>(null);

  onMount(() => {
    let mounted = true;
    void getManifest()
      .then((loaded) => {
        if (mounted) manifest = loaded;
      })
      .catch(() => {
        // Logos are optional; every team still renders by name.
      });
    return () => {
      mounted = false;
    };
  });

  const teamsById = $derived(new Map(lock.season.teams.map((team) => [team.teamId, team])));
  const userTeamId = $derived(lock.season.userTeamId);
  const userTeam = $derived(teamsById.get(userTeamId) ?? null);
  const userTeamName = $derived(userTeam?.displayName ?? userTeamId);
  const nextUserFixture = $derived(fullCourtNextUserFixture(lock, checkpoint, playoff));
  const gameDayReadiness = $derived(
    fullCourtGameDayReadiness({
      roster: userTeam?.roster ?? [],
      availability: userTeam?.availability ?? [],
      health,
      fixture: nextUserFixture,
      restingPlayerIds,
    }),
  );
  const standings = $derived(fullCourtStandings(lock.season.teams, scores));
  const seasonStats = $derived(
    buildFullCourtSeasonStats({
      userTeamId,
      regularScores: scores,
      ...(playoff === null ? {} : { series: playoff.series }),
    }),
  );
  const scoringTotals = $derived.by(() => {
    let pointsFor = seasonStats.regular.pointsFor;
    let pointsAgainst = seasonStats.regular.pointsAgainst;
    let playedGames = seasonStats.regular.playedGames;
    for (const series of playoff?.series ?? []) {
      for (const game of series.games) {
        if (game.homeTeamId !== userTeamId && game.awayTeamId !== userTeamId) continue;
        const result = fullCourtResultOf(game, userTeamId);
        if (result.userPoints === null || result.opponentPoints === null) continue;
        pointsFor += result.userPoints;
        pointsAgainst += result.opponentPoints;
        playedGames += 1;
      }
    }
    return { pointsFor, pointsAgainst, playedGames, pointDifferential: pointsFor - pointsAgainst };
  });
  const rowByTeam = $derived(
    new Map([...standings.west, ...standings.east].map((row) => [row.teamId, row])),
  );
  const selectedTeam = $derived(
    selectedTeamId === null ? null : (teamsById.get(selectedTeamId) ?? null),
  );
  const selectedTeamStanding = $derived(
    selectedTeamId === null ? null : (rowByTeam.get(selectedTeamId) ?? null),
  );
  const userRow = $derived(rowByTeam.get(userTeamId) ?? null);
  const userIdentity = $derived(
    manifest === null ? null : franchiseIdentityOf(manifest, userTeamId),
  );
  const userConferenceName = $derived(
    userRow === null ? null : CAP_RUSH_CONFERENCE_NAMES[userRow.conference],
  );
  const played = $derived(
    Math.min(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, checkpoint.completedThroughSlot),
  );
  const remaining = $derived(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - played);
  const regularComplete = $derived(played === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM);

  const schedule = $derived(fullCourtUserSchedule(lock, scores));
  const scheduleCells = $derived(
    schedule.map((cell): ScheduleCell => {
      const result = cell.result;
      const homeAway = cell.userHome ? 'vs' : 'at';
      return {
        key: String(cell.slot),
        label: `${cell.slot} ${cell.opponentAbbreviation}`,
        sublabel:
          result === null
            ? cell.userHome
              ? 'vs'
              : '@'
            : `${result.won ? 'W' : 'L'} ${result.compactLabel}`,
        state: result === null ? 'upcoming' : result.won ? 'win' : 'loss',
        ariaLabel:
          result === null
            ? `Game ${cell.slot} ${homeAway} ${cell.opponentName}, not played`
            : `Game ${cell.slot} ${homeAway} ${cell.opponentName}, ${result.won ? 'win' : 'loss'} ${result.scoreLabel}`,
        title:
          result === null
            ? `Game ${cell.slot} ${homeAway} ${cell.opponentAbbreviation} · not played`
            : `Game ${cell.slot} ${homeAway} ${cell.opponentAbbreviation} · ${result.won ? 'W' : 'L'} ${result.compactLabel}`,
      };
    }),
  );
  const latestCell = $derived(schedule.findLast((cell) => cell.result !== null) ?? null);
  const latestResult = $derived(latestCell?.result ?? null);

  /** The postseason screen owns every bracket action and every postseason view. */
  const playoffMode = $derived(playoff !== null || regularComplete);
  const controls = $derived(
    fullCourtHomeControls({
      lock,
      checkpoint,
      playoff: null,
      pendingForfeit,
      busy,
      restConflict: gameDayReadiness.restConflict,
    }),
  );
  const playoffGamesList = $derived(
    playoff === null ? [] : playoff.series.flatMap((entry) => entry.games),
  );
  const awards = $derived.by(() => {
    try {
      return buildFullCourtAwards({
        teams: lock.season.teams,
        regularScores: scores,
        standings,
        completedSlots: played,
        playoffGames: playoffGamesList,
        championTeamId: playoff?.championTeamId ?? null,
      });
    } catch {
      return null;
    }
  });
  const userRosterStats = $derived(
    userTeam === null
      ? []
      : buildFullCourtPlayerSeasonStats({
          teams: [userTeam],
          scores,
        }).filter((row) => row.games > 0),
  );

  function teamName(teamId: string): string {
    return teamsById.get(teamId)?.displayName ?? teamId;
  }

  function identityOf(teamId: string) {
    return manifest === null ? null : franchiseIdentityOf(manifest, teamId);
  }

  function recordLabel(wins: number, losses: number): string {
    return `${String(wins)}–${String(losses)}`;
  }

  function signed(value: number): string {
    return value > 0 ? `+${String(value)}` : String(value);
  }

  function perGameLabel(total: number): string {
    return scoringTotals.playedGames === 0 ? '—' : (total / scoringTotals.playedGames).toFixed(1);
  }

  function signedPerGameLabel(total: number): string {
    if (scoringTotals.playedGames === 0) return '—';
    const average = total / scoringTotals.playedGames;
    return average > 0 ? `+${average.toFixed(1)}` : average.toFixed(1);
  }

  function rateLabel(value: number | null): string {
    return value === null ? '—' : value.toFixed(1);
  }

  function possessionLabel(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function sideMeta(teamId: string): string {
    const row = rowByTeam.get(teamId);
    const seed = row?.seed ?? null;
    const record = row === undefined ? null : recordLabel(row.wins, row.losses);
    return [franchiseAbbreviation(teamId), seed === null ? null : `Seed ${String(seed)}`, record]
      .filter((part): part is string => part !== null)
      .join(' · ');
  }

  function runAction(action: FullCourtHomeAction): void {
    if (busy || pendingForfeit) return;
    if (action.kind === 'start-playoffs') {
      onStartPlayoffs();
      return;
    }
    if (action.count <= 0) return;
    onAdvance(action.count, false, {
      stopAtInjury: action.stopAtInjury,
      stopAtReview: action.stopAtReview,
    });
  }

  /**
   * A batch may already have committed the slots before the forfeit, so only
   * retry the single pending game after the explicit confirmation.
   */
  function confirmForfeit(): void {
    if (busy) return;
    onAdvance(1, true);
  }
</script>

{#snippet simControlsBar()}
  <div class="mt-4 border-t border-line-soft pt-4" aria-busy={busy}>
    {#if simulating}
      <SimulationStatus
        label="Season simulation progress"
        progress={simProgress}
        stopping={stopRequested}
        onStop={onStopAfterGame}
      />
    {:else}
      <div class="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          {#if controls.primary !== null}
            <Button
              tone="primary"
              class="flex-1 whitespace-nowrap sm:flex-initial"
              disabled={busy}
              onclick={() => {
                if (controls.primary !== null) runAction(controls.primary);
              }}
            >
              {#if controls.primary.kind === 'start-playoffs'}
                <Trophy size={15} aria-hidden="true" />
              {:else}
                <Play size={15} aria-hidden="true" />
              {/if}
              {controls.primary.label}
            </Button>
          {/if}
          {#if onEditGamePlan !== undefined && section === 'home'}
            <Button
              size="sm"
              tone="secondary"
              class="flex-1 whitespace-nowrap sm:flex-initial"
              disabled={busy}
              onclick={onEditGamePlan}>Edit game plan</Button
            >
          {/if}
        </div>

        {#if controls.secondary.length > 0}
          <div
            class="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-xl border border-line-soft bg-surface-1 p-1"
            role="group"
            aria-label="Batch simulation"
          >
            <span class="ui-micro shrink-0 px-2 text-muted-foreground">Skip</span>
            {#each controls.secondary as action (action.label)}
              <Button
                size="sm"
                tone="secondary"
                class="flex-1 whitespace-nowrap"
                disabled={busy}
                onclick={() => runAction(action)}
              >
                {#if action.count >= 5}
                  <FastForward size={13} aria-hidden="true" />
                {:else}
                  <SkipForward size={13} aria-hidden="true" />
                {/if}
                {action.label}
              </Button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if controls.status}
    <p class="mt-2 text-[11px] text-muted-foreground" role="status">
      {controls.status}
    </p>
  {/if}

  {#if notice !== null && !busy}
    {#if notice.stop.kind === 'injury'}
      <Alert class="mt-3" tone={notice.tone} title={notice.title}>
        <p>{notice.message}</p>
        {#snippet actions()}
          <Button size="sm" tone="secondary" onclick={() => onDismissNotice?.()}>Dismiss</Button>
        {/snippet}
      </Alert>
    {:else}
      <p class="mt-2 text-xs font-medium text-muted-foreground" role="status">
        <span class="font-semibold text-foreground">{notice.title}</span> · {notice.message}
      </p>
    {/if}
  {/if}

  {#if pendingForfeit}
    <Alert class="mt-3" tone="warning" title="Confirm the forfeit">
      <p>
        The next Full Court game is a forfeit. Confirm it to record the result and continue the
        season.
      </p>
      {#snippet actions()}
        <Button tone="primary" disabled={busy} onclick={confirmForfeit}>
          <ShieldAlert size={15} aria-hidden="true" />
          {busy ? 'Recording…' : 'Confirm forfeit'}
        </Button>
      {/snippet}
    </Alert>
  {/if}
{/snippet}

{#snippet latestStatus()}
  <span class="ui-micro font-bold">
    {#if latestResult?.forfeit}
      {latestResult.scoreLabel}
    {:else}
      {latestCell?.userHome ? 'vs' : '@'}
    {/if}
  </span>
{/snippet}

{#snippet matchupSide(teamId: string, role: 'Home' | 'Away')}
  {@const identity = identityOf(teamId)}
  {@const isUser = teamId === userTeamId}
  <div
    class="flex min-w-0 flex-col gap-1 rounded-lg border p-2 sm:gap-2 sm:p-3 {isUser
      ? 'border-primary/50 bg-primary/5'
      : 'border-line-soft bg-surface-1'}"
  >
    <div class="flex flex-wrap items-center gap-2">
      {#if identity !== null && manifest !== null}
        <TeamLogo
          {manifest}
          franchiseId={identity.franchiseId}
          teamExternalId={identity.teamExternalId}
          alt=""
          className="h-9 w-9"
        />
      {/if}
      <p
        class="font-display min-w-0 basis-full break-words text-sm leading-tight font-extrabold uppercase sm:flex-1 sm:text-lg"
        title={teamName(teamId)}
      >
        {teamName(teamId)}
      </p>
      {#if isUser}
        <span class="shrink-0 font-mono text-[9px] font-bold text-primary uppercase">You</span>
      {/if}
    </div>
    <p class="font-mono text-[10px] text-muted-foreground uppercase">
      {role} · {sideMeta(teamId)}
    </p>
  </div>
{/snippet}

{#snippet homePanel()}
  <Panel as="section" padding="md" aria-label="Full Court season progress">
    <StatGrid columns={3} mobile={3} gap="md">
      <StatTile label="Remaining" size="md" surface="tile" value={remaining} />
      <StatTile
        label="Playoff seed"
        size="md"
        surface="tile"
        tone={userRow?.qualified === true ? 'accent' : 'muted'}
        value={userRow === null ? '—' : `#${String(userRow.seed)}`}
      />
      <StatTile
        label="Point diff"
        size="md"
        surface="tile"
        tone={(userRow?.pointDifferential ?? 0) > 0
          ? 'primary'
          : (userRow?.pointDifferential ?? 0) < 0
            ? 'negative'
            : 'muted'}
        value={signed(userRow?.pointDifferential ?? 0)}
      />
    </StatGrid>

    <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="ui-label">Full Court · Regular season</p>
        <div class="mt-2 flex items-center gap-3">
          {#if userIdentity !== null && manifest !== null}
            <TeamLogo
              {manifest}
              franchiseId={userIdentity.franchiseId}
              teamExternalId={userIdentity.teamExternalId}
              alt=""
              className="h-11 w-11"
              eager
            />
          {/if}
          <div class="min-w-0">
            <h2
              class="font-display text-5xl leading-none font-extrabold tracking-tight tabular-nums sm:text-6xl"
            >
              {recordLabel(userRow?.wins ?? 0, userRow?.losses ?? 0)}
            </h2>
            <p class="mt-2 truncate text-sm font-semibold" title={userTeamName}>{userTeamName}</p>
            <p class="ui-micro mt-1 text-muted-foreground">
              {played} of {CAP_RUSH_CONFERENCE_GAMES_PER_TEAM} games played
              {#if userConferenceName !== null}
                · {userConferenceName}
              {/if}
            </p>
          </div>
        </div>
      </div>
    </div>

    {#if nextUserFixture !== null}
      <div class="mt-4 rounded-xl border border-primary/30 bg-surface-2/50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="ui-label" data-tone="muted">{nextUserFixture.label}</p>
          <Badge tone="neutral">Next game</Badge>
        </div>
        <div
          class="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1.5 sm:gap-2"
        >
          {@render matchupSide(nextUserFixture.homeTeamId, 'Home')}
          <span
            class="self-center text-center font-mono text-[10px] text-muted-foreground uppercase"
            >vs</span
          >
          {@render matchupSide(nextUserFixture.awayTeamId, 'Away')}
        </div>
        {@render simControlsBar()}
        <p class="mt-2 font-mono text-[9px] text-muted-foreground uppercase">
          Your five {nextUserFixture.userSide === 'home'
            ? 'host this game'
            : 'travel for this game'}
        </p>
      </div>
    {:else}
      {@render simControlsBar()}
    {/if}

    <details class="mt-4 rounded-lg border border-line-soft px-3">
      <summary class="min-h-11 cursor-pointer content-center text-sm font-semibold"
        >Game day readiness</summary
      >
      <FullCourtGameDayPanel
        readiness={gameDayReadiness}
        {restingPlayerIds}
        {busy}
        {onRestingChange}
        {art}
      />
    </details>
  </Panel>
{/snippet}

{#snippet latestResultPanel()}
  {#if latestCell !== null && latestResult !== null}
    <Panel as="section" padding="sm" aria-label="Latest Full Court result">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="ui-label" data-tone="muted">
          Latest result · Game {latestCell.slot}
        </p>
        <Badge tone={latestResult.won ? 'positive' : 'negative'}>
          {latestResult.doubleForfeit ? 'Double forfeit' : latestResult.won ? 'Win' : 'Loss'}
        </Badge>
      </div>
      <GameScoreboard
        teams={[
          {
            key: 'you',
            label: userTeamName,
            score: latestResult.userPoints ?? '—',
            winner: latestResult.doubleForfeit ? false : latestResult.won,
          },
          {
            key: 'opponent',
            label: latestCell.opponentName,
            score: latestResult.opponentPoints ?? '—',
            winner: latestResult.doubleForfeit ? false : !latestResult.won,
          },
        ]}
        status={latestStatus}
        label={`Game ${String(latestCell.slot)} result`}
        class="mt-2"
      />
    </Panel>
  {:else}
    <Panel as="section" padding="sm" aria-label="Latest Full Court result">
      <p class="text-xs leading-relaxed text-muted-foreground">
        No Full Court games have been played yet. Your first result lands here.
      </p>
    </Panel>
  {/if}
{/snippet}

{#snippet statsPanel()}
  <Panel as="section" padding="md" aria-label="Full Court season stats">
    <SectionHeading eyebrow="Stats" title="Your season so far" level={2} size="md">
      {#snippet actions()}
        <Badge tone={seasonStats.lineups.coverageComplete ? 'positive' : 'neutral'}>
          {seasonStats.lineups.gamesRecorded} of {seasonStats.lineups.gamesExpected} games with lineup
          facts
        </Badge>
      {/snippet}
    </SectionHeading>
    {#if seasonStats.regular.playedGames === 0}
      <p class="mt-2 text-xs text-muted-foreground">No played games yet.</p>
    {/if}
    <StatGrid class="mt-4" columns={4} mobile={2}>
      <StatTile
        label="Points / game"
        size="md"
        surface="tile"
        value={perGameLabel(scoringTotals.pointsFor)}
      />
      <StatTile
        label="Opponent points / game"
        size="md"
        surface="tile"
        value={perGameLabel(scoringTotals.pointsAgainst)}
      />
      <StatTile
        label="Average diff"
        size="md"
        surface="tile"
        tone={scoringTotals.pointDifferential > 0
          ? 'primary'
          : scoringTotals.pointDifferential < 0
            ? 'negative'
            : 'muted'}
        value={signedPerGameLabel(scoringTotals.pointDifferential)}
      />
      <StatTile
        label="Net points"
        size="md"
        surface="tile"
        tone={scoringTotals.pointDifferential > 0
          ? 'primary'
          : scoringTotals.pointDifferential < 0
            ? 'negative'
            : 'muted'}
        value={signed(scoringTotals.pointDifferential)}
      />
    </StatGrid>
    {#if seasonStats.bench !== null && seasonStats.bench.bestGame !== null}
      <p class="mt-3 text-xs text-muted-foreground">
        Best bench game: {seasonStats.bench.bestGame.benchPoints} points in game
        {seasonStats.bench.bestGame.gameNumber}.
      </p>
    {/if}
  </Panel>

  {#if awards !== null}
    <FullCourtAwardsPanel {awards} rosterStats={userRosterStats} {userTeamId} {art} />
  {/if}

  <Panel as="section" padding="md" aria-label="Full Court lineup lab">
    <SectionHeading
      title={impactView === 'players' ? 'Player Impact' : 'Actual fives'}
      level={2}
      size="md"
    >
      {#snippet actions()}
        <div class="flex flex-wrap gap-1" role="group" aria-label="Lineup analysis">
          <Button
            size="sm"
            tone={impactView === 'players' ? 'secondary' : 'ghost'}
            aria-pressed={impactView === 'players'}
            onclick={() => (impactView = 'players')}
          >
            Player Impact
          </Button>
          <Button
            size="sm"
            tone={impactView === 'fives' ? 'secondary' : 'ghost'}
            aria-pressed={impactView === 'fives'}
            onclick={() => (impactView = 'fives')}
          >
            Actual Fives
          </Button>
        </div>
      {/snippet}
    </SectionHeading>
    {#if impactView === 'players'}
      {@const selected = seasonStats.lineups.impact.find(
        (row) => row.player.playerId === impactPlayerId,
      )}
      {#if seasonStats.lineups.impact.length > 0}
        <p class="mt-2 text-xs text-muted-foreground">
          {seasonStats.lineups.impactGames} of {seasonStats.lineups.gamesExpected} played games with complete
          lineup data. Net ratings are per 100 possessions. Off-court minutes come from games the player
          appeared in. * Below {seasonStats.lineups.sampleThreshold} possessions.
        </p>
        <div class="ui-stats-scroll mt-3">
          <PlayerStatsTable
            columns={[
              { key: 'minutes', label: 'MIN', value: (row) => row.on.minutes.toFixed(1) },
              { key: 'margin', label: '+/-', value: (row) => signed(row.on.plusMinus) },
              { key: 'on', label: 'ON NET', value: (row) => rateLabel(row.on.net) },
              { key: 'off', label: 'OFF NET', value: (row) => rateLabel(row.off.net) },
              { key: 'swing', label: 'ON/OFF', value: (row) => rateLabel(row.onOff) },
            ] satisfies PlayerStatColumn<(typeof seasonStats.lineups.impact)[number]>[]}
            rows={seasonStats.lineups.impact}
            rowKey={(row) => row.player.playerId}
            caption="Full Court player impact"
            stickyIdentity
            playerCellClass="ui-stats-player-cell"
            playerHeadCellClass="ui-stats-player-cell"
          >
            {#snippet identity(row)}
              <button
                type="button"
                class="flex min-h-10 items-center gap-2 text-left font-semibold hover:text-accent focus-visible:outline-2 focus-visible:outline-ring"
                aria-expanded={impactPlayerId === row.player.playerId}
                aria-controls={impactPlayerId === row.player.playerId
                  ? 'player-impact-details'
                  : undefined}
                onclick={() => void toggleImpactDetails(row.player.playerId)}
              >
                <FullCourtPortrait player={row.player} {art} size="sm" />
                {row.player.displayName}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  class={impactPlayerId === row.player.playerId ? 'rotate-180' : ''}
                />
              </button>
            {/snippet}
            {#snippet cell(row, column)}
              {@const small =
                (column.key === 'on' && row.on.net !== null && !row.on.sampleMet) ||
                (column.key === 'off' && row.off.net !== null && !row.off.sampleMet) ||
                (column.key === 'swing' &&
                  row.onOff !== null &&
                  (!row.on.sampleMet || !row.off.sampleMet))}
              <span
                class:font-bold={column.key === 'swing'}
                class:text-positive={column.key === 'swing' && (row.onOff ?? 0) > 0}
                class:text-negative={column.key === 'swing' && (row.onOff ?? 0) < 0}
              >
                {column.key === 'swing' && (row.onOff ?? 0) > 0 ? '+' : ''}{column.value(row)}{small
                  ? ' *'
                  : ''}
              </span>
            {/snippet}
          </PlayerStatsTable>
        </div>
        {#if selected !== undefined}
          {@const alternatives = seasonStats.lineups.rows.filter(
            (row) => !row.playerIds.includes(selected.player.playerId),
          )}
          {@const comparisons = seasonStats.lineups.rows
            .filter((row) => row.playerIds.includes(selected.player.playerId))
            .flatMap((withPlayer) => {
              const teammates = withPlayer.playerIds.filter(
                (id) => id !== selected.player.playerId,
              );
              return alternatives
                .filter((row) => teammates.every((id) => row.playerIds.includes(id)))
                .map((withoutPlayer) => ({ withPlayer, withoutPlayer, teammates }));
            })
            .sort(
              (left, right) =>
                Math.min(right.withPlayer.pacePossessions, right.withoutPlayer.pacePossessions) -
                Math.min(left.withPlayer.pacePossessions, left.withoutPlayer.pacePossessions),
            )
            .slice(0, 3)}
          <div
            class="mt-4 grid gap-3 rounded-lg border border-line-soft bg-surface-1 p-4"
            id="player-impact-details"
            bind:this={impactDetails}
            aria-label={`${selected.player.displayName} impact details`}
          >
            <h3 class="font-semibold">
              {selected.player.displayName}
              <span class="text-sm font-normal text-muted-foreground"
                >&middot; {selected.games} games</span
              >
            </h3>
            <div class="grid gap-2 sm:grid-cols-2">
              {#each [{ label: 'On court', sample: selected.on }, { label: 'Off court', sample: selected.off }] as { label, sample } (label)}
                <div class="rounded-md bg-surface-2 p-3 text-sm">
                  <p class="font-semibold">{label}</p>
                  <p class="mt-1 text-muted-foreground">
                    {possessionLabel(sample.possessions)} poss &middot; {sample.minutes.toFixed(1)} min
                    {sample.sampleMet ? '' : ' *'}
                  </p>
                  <p class="mt-1 text-muted-foreground">
                    Offense {sample.offense?.toFixed(1) ?? '?'} &middot; Defense {sample.defense?.toFixed(
                      1,
                    ) ?? '?'} per 100 poss
                  </p>
                </div>
              {/each}
            </div>
            <h4 class="text-sm font-semibold">Same four teammates</h4>
            {#each comparisons as { withPlayer, withoutPlayer, teammates } (`${withPlayer.key}:${withoutPlayer.key}`)}
              {@const replacement = withoutPlayer.players.find(
                (player) => !teammates.includes(player.playerId),
              )}
              <div class="border-t border-line-soft pt-2 text-sm">
                <p class="text-xs text-muted-foreground">
                  {withPlayer.players
                    .filter((player) => teammates.includes(player.playerId))
                    .map((player) => player.displayName)
                    .join(' ? ')}
                </p>
                <dl class="mt-1 grid gap-1 sm:grid-cols-2">
                  {#each [{ player: selected.player, lineup: withPlayer }, { player: replacement, lineup: withoutPlayer }] as { player, lineup } (lineup.key)}
                    <div>
                      <dt class="font-semibold">{player?.displayName}</dt>
                      <dd>
                        {rateLabel(lineup.netRatingPer100)} net &middot; {possessionLabel(
                          lineup.pacePossessions,
                        )} poss{lineup.sampleMet ? '' : ' *'}
                      </dd>
                    </div>
                  {/each}
                </dl>
              </div>
            {:else}
              <p class="text-xs text-muted-foreground">
                No recorded substitution shared the same four teammates.
              </p>
            {/each}
            {#if comparisons.length > 0}
              <p class="text-xs text-muted-foreground">
                These groups may have faced different opponents and game situations.
              </p>
            {/if}
          </div>
        {/if}
      {:else}
        <p class="mt-3 text-sm text-muted-foreground">
          Player impact needs a played game with complete lineup data.
        </p>
      {/if}
    {:else}
      {#if seasonStats.lineups.rows.length > 0}
        {@const visibleLineups = showAllLineups
          ? seasonStats.lineups.rows
          : seasonStats.lineups.rows.slice(0, 8)}
        <p class="mt-2 text-xs text-muted-foreground">
          * below {seasonStats.lineups.sampleThreshold} possessions.
        </p>
        <div class="ui-stats-scroll mt-3">
          <PlayerStatsTable
            columns={[
              { key: 'games', label: 'GP', value: (lineup) => lineup.games },
              { key: 'minutes', label: 'MIN', value: (lineup) => lineup.minutes.toFixed(1) },
              { key: 'pointsFor', label: 'PF', value: (lineup) => lineup.pointsFor },
              { key: 'pointsAgainst', label: 'PA', value: (lineup) => lineup.pointsAgainst },
              {
                key: 'poss',
                label: 'POSS',
                value: (lineup) => possessionLabel(lineup.pacePossessions),
              },
              {
                key: 'netRating',
                label: 'NET RTG',
                value: (lineup) =>
                  `${rateLabel(lineup.netRatingPer100)}${lineup.sampleMet ? '' : ' *'}`,
              },
              { key: 'rank', label: 'RK', value: (lineup) => lineup.rank ?? '—' },
            ] satisfies PlayerStatColumn<(typeof visibleLineups)[number]>[]}
            rows={visibleLineups}
            rowKey={(lineup) => lineup.key}
            caption="Full Court season lineups"
            playerLabel="Lineup"
            stickyIdentity
            playerCellClass="ui-stats-player-cell"
            playerHeadCellClass="ui-stats-player-cell"
          >
            {#snippet identity(lineup)}
              <div class="flex items-center gap-2">
                <div class="flex shrink-0 -space-x-2">
                  {#each lineup.players as player (player.playerId)}
                    <div class="rounded-full ring-2 ring-surface-1">
                      <FullCourtPortrait {player} {art} size="sm" />
                    </div>
                  {/each}
                </div>
                <span class="min-w-0 text-xs font-semibold">
                  {lineup.players.map((player) => player.displayName).join(' · ')}
                </span>
              </div>
            {/snippet}
            {#snippet cell(lineup, column)}
              {#if column.key === 'netRating'}
                <span
                  class="font-bold {lineup.netRatingPer100 === null
                    ? ''
                    : lineup.netRatingPer100 > 0
                      ? 'text-positive'
                      : lineup.netRatingPer100 < 0
                        ? 'text-negative'
                        : ''}"
                >
                  {column.value(lineup)}
                </span>
              {:else if column.key === 'rank'}
                <span title={lineup.sampleMet ? 'Net-rating rank' : 'Below the sample floor'}>
                  {column.value(lineup)}
                </span>
              {:else}
                {column.value(lineup)}
              {/if}
            {/snippet}
          </PlayerStatsTable>
        </div>
        {#if seasonStats.lineups.rows.length > 8}
          <div class="mt-3">
            <Button size="sm" tone="secondary" onclick={() => (showAllLineups = !showAllLineups)}>
              {showAllLineups
                ? 'Show top 8 lineups'
                : `Show all ${String(seasonStats.lineups.rows.length)} lineups`}
            </Button>
          </div>
        {/if}
      {:else if seasonStats.lineups.gamesExpected > 0}
        <Alert class="mt-3" tone="info" title="No lineup facts in this save"></Alert>
      {:else}
        <p class="mt-2 text-xs text-muted-foreground">
          Play a game to record the first actual five.
        </p>
      {/if}
    {/if}
  </Panel>
{/snippet}

{#snippet leaguePanel()}
  <Panel as="section" padding="md" aria-label="Full Court regular season">
    <SectionHeading
      eyebrow="League"
      title={`${recordLabel(userRow?.wins ?? 0, userRow?.losses ?? 0)} · ${String(played)} of ${String(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM)}`}
      level={2}
      size="md"
    >
      {#snippet actions()}
        {#if userRow !== null}
          <Badge tone={userRow.qualified ? 'primary' : 'neutral'}>
            {userConferenceName ?? 'Your conference'} · Seed {userRow.seed}
          </Badge>
        {/if}
      {/snippet}
    </SectionHeading>
    <p class="mt-2 text-xs text-muted-foreground">
      {remaining === 0
        ? 'The regular season is complete.'
        : `${remaining} ${remaining === 1 ? 'game' : 'games'} remain on your schedule.`}
    </p>
    <ScheduleGrid class="mt-4" cells={scheduleCells} columns={8} label="Full Court game results" />
  </Panel>

  <Panel as="section" padding="md" aria-label="Full Court standings">
    <SectionHeading
      eyebrow="Conference standings"
      title="Eight per conference."
      level={2}
      size="sm"
    >
      {#snippet actions()}
        {#if userRow !== null}
          <Badge tone="primary">
            {userConferenceName ?? 'Your conference'} · Seed {userRow.seed}
          </Badge>
        {/if}
      {/snippet}
    </SectionHeading>
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <ConferenceStandingsTable
        conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.west}
        caption="West Full Court standings"
        rows={standings.west}
        {userTeamId}
        {manifest}
        onTeamSelect={(teamId) => (selectedTeamId = teamId)}
      />
      <ConferenceStandingsTable
        conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.east}
        caption="East Full Court standings"
        rows={standings.east}
        {userTeamId}
        {manifest}
        onTeamSelect={(teamId) => (selectedTeamId = teamId)}
      />
    </div>
  </Panel>
{/snippet}

<div class="flex flex-col gap-3">
  {#if section === 'league'}
    {@render leaguePanel()}
  {:else if section === 'stats'}
    {@render statsPanel()}
  {:else if playoffMode}
    <FullCourtPostseasonView
      {lock}
      {checkpoint}
      {playoff}
      {standings}
      {pendingForfeit}
      {busy}
      {simulating}
      {simProgress}
      {stopRequested}
      {notice}
      {onDismissNotice}
      {onAdvance}
      {onStartPlayoffs}
      {onStopAfterGame}
      {art}
    />
  {:else if section === 'playoffs'}
    <Panel as="section" padding="md" aria-label="Full Court postseason">
      <SectionHeading
        eyebrow="Postseason"
        title="The bracket opens after 82 games"
        level={2}
        size="md"
      />
    </Panel>
  {:else}
    {@render homePanel()}
    {@render latestResultPanel()}
  {/if}
</div>

<DialogShell
  open={selectedTeam !== null}
  onOpenChange={(open) => {
    if (!open) selectedTeamId = null;
  }}
  size="xl"
  layout="center"
  headerClass="mb-4"
>
  {#snippet header()}
    <p class="ui-label">Team detail</p>
  {/snippet}
  {#if selectedTeam !== null}
    <FullCourtTeamDetail
      team={selectedTeam}
      standing={selectedTeamStanding}
      {scores}
      isUserTeam={selectedTeam.teamId === userTeamId}
      {manifest}
      {art}
    />
  {/if}
</DialogShell>
