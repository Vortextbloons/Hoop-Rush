<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    CAP_RUSH_CONFERENCE_NAMES,
    CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
    CAP_RUSH_SERIES_GAMES,
    CAP_RUSH_SERIES_WINS,
    capRushConferenceRoundName,
    capRushSeriesConferenceOf,
    capRushSeriesWinner,
    capRushSeriesWins,
    type FullCourtSeasonCheckpoint,
    type FullCourtSeasonScore,
    type FullCourtTeamHealth,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { FastForward, Play, ShieldAlert, SkipForward, Trophy } from '@lucide/svelte';
  import {
    buildFullCourtSeasonStats,
    fullCourtStandings,
    fullCourtUserNextPlayoffMatchup,
    type FullCourtSeasonLock,
  } from '@hoop-rush/engine';
  import { onMount } from 'svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import ConferenceStandingsTable from '#lib/components/basketball/ConferenceStandingsTable.svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import ScheduleGrid from '#lib/components/screens/ScheduleGrid.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import type { ScheduleCell } from '#lib/components/ui/types.js';
  import { getManifest } from '#lib/data.js';
  import FullCourtGameDayPanel from './FullCourtGameDayPanel.svelte';
  import {
    fullCourtFinalRecap,
    fullCourtGameDayReadiness,
    fullCourtHomeControls,
    fullCourtNextMatchup,
    fullCourtNextUserFixture,
    fullCourtPlayoffAdaptationRead,
    fullCourtPlayoffRounds,
    fullCourtPlayoffStatus,
    fullCourtSeriesGames,
    fullCourtUserSchedule,
    fullCourtUserSeries,
    type FullCourtAdvanceOptions,
    type FullCourtBracketRound,
    type FullCourtHomeAction,
    type FullCourtMatchupSide,
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
    onWatchNextGame,
    health = null,
    restingPlayerIds = [],
    onRestingChange,
    section = 'home',
    notice = null,
    onDismissNotice,
  }: {
    lock: FullCourtSeasonLock;
    checkpoint: FullCourtSeasonCheckpoint;
    scores: readonly FullCourtSeasonScore[];
    playoff: FullCourtPlayoffView | null;
    pendingForfeit: boolean;
    busy: boolean;
    onAdvance: (count: number, acceptForfeit?: boolean, options?: FullCourtAdvanceOptions) => void;
    onStartPlayoffs: () => void;
    onWatchNextGame?: () => void;
    health?: FullCourtTeamHealth | null;
    restingPlayerIds?: readonly string[];
    onRestingChange?: (playerIds: readonly string[]) => void;
    section?: FullCourtSeasonSection;
    /** Typed stop feedback from the controller. */
    notice?: FullCourtSimulationNotice | null;
    onDismissNotice?: () => void;
  } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let selectedRound = $state<number | null>(null);

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
  const rowByTeam = $derived(
    new Map([...standings.west, ...standings.east].map((row) => [row.teamId, row])),
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

  const bracketRounds = $derived(playoff === null ? [] : fullCourtPlayoffRounds(playoff.series));
  const userSeries = $derived(
    playoff === null ? null : fullCourtUserSeries(playoff.series, userTeamId),
  );
  const userSeriesGames = $derived(
    userSeries === null ? [] : fullCourtSeriesGames(userSeries, userTeamId),
  );
  const userSeriesWinner = $derived(userSeries === null ? null : capRushSeriesWinner(userSeries));
  const userSeriesActive = $derived(userSeries !== null && userSeriesWinner === null);
  const userSeriesOpponentId = $derived(
    userSeries === null
      ? null
      : userSeries.highTeamId === userTeamId
        ? userSeries.lowTeamId
        : userSeries.highTeamId,
  );
  const championId = $derived(playoff?.championTeamId ?? null);
  const postseasonStatus = $derived(
    playoff === null ? null : fullCourtPlayoffStatus(playoff, userTeamId, teamName),
  );
  const latestRound = $derived.by(() => {
    const populated = bracketRounds.filter((round) => round.series.length > 0);
    return populated.length === 0 ? 1 : Math.max(...populated.map((round) => round.round));
  });
  const activeRound = $derived(selectedRound ?? latestRound);

  const matchup = $derived(fullCourtNextMatchup(lock, checkpoint, playoff, teamName));
  const nextBracketGameHasUser = $derived(playoff === null || playoff.nextGame?.userSide !== null);
  const userPlayoffPreview = $derived(
    playoff === null
      ? null
      : fullCourtUserNextPlayoffMatchup({
          userTeamId,
          runSeed: lock.season.runSeed,
          series: playoff.series,
        }),
  );
  const nextUserGame = $derived(
    userPlayoffPreview === null
      ? null
      : { gameOrdinal: userPlayoffPreview.gameOrdinal, userSide: userPlayoffPreview.userSide },
  );
  const userPlayoffAdjustment = $derived(
    userPlayoffPreview?.adaptation == null
      ? null
      : fullCourtPlayoffAdaptationRead(userPlayoffPreview.adaptation),
  );
  const controls = $derived(
    fullCourtHomeControls({
      checkpoint,
      playoff,
      pendingForfeit,
      busy,
      restConflict: gameDayReadiness.restConflict,
    }),
  );
  const recap = $derived(fullCourtFinalRecap(lock, playoff, teamName));

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

  function rateLabel(value: number | null): string {
    return value === null ? '—' : value.toFixed(1);
  }

  function possessionLabel(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function sideMeta(side: FullCourtMatchupSide): string {
    const row = rowByTeam.get(side.teamId);
    const seed = side.seed ?? row?.seed ?? null;
    const record = row === undefined ? null : recordLabel(row.wins, row.losses);
    return [side.abbreviation, seed === null ? null : `Seed ${String(seed)}`, record]
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

  function startPlayoffs(): void {
    if (busy || pendingForfeit) return;
    onStartPlayoffs();
  }

  function seriesSeed(series: FullCourtBracketRound['series'][number], teamId: string): number {
    return teamId === series.highTeamId ? series.highSeed : series.lowSeed;
  }

  function seriesHasUser(series: FullCourtBracketRound['series'][number]): boolean {
    return series.highTeamId === userTeamId || series.lowTeamId === userTeamId;
  }
</script>

{#snippet latestStatus()}
  <span class="ui-micro font-bold">
    {#if latestResult?.forfeit}
      {latestResult.scoreLabel}
    {:else}
      {latestCell?.userHome ? 'vs' : '@'}
    {/if}
  </span>
{/snippet}

{#snippet matchupSide(side: FullCourtMatchupSide, role: 'Home' | 'Away' | null)}
  {@const identity = identityOf(side.teamId)}
  {@const isUser = side.teamId === userTeamId}
  <div
    class="flex min-w-0 flex-col gap-2 rounded-xl border p-3 {isUser
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
        class="font-display min-w-0 flex-1 truncate text-lg leading-tight font-extrabold uppercase"
        title={side.name}
      >
        {side.name}
      </p>
      {#if isUser}
        <span class="shrink-0 font-mono text-[9px] font-bold text-primary uppercase">You</span>
      {/if}
    </div>
    <p class="font-mono text-[10px] text-muted-foreground uppercase">
      {role === null ? '' : `${role} · `}{sideMeta(side)}
    </p>
  </div>
{/snippet}

{#snippet bracketRoundColumn(round: FullCourtBracketRound)}
  <div class="min-w-0">
    <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
      {round.label}
    </p>
    <div class="mt-2 flex flex-col gap-2">
      {#each round.series as series (series.seriesId)}
        {@const conference = capRushSeriesConferenceOf(series.round, series.seriesSlot)}
        {@const winner = capRushSeriesWinner(series)}
        {@const userMatchup = seriesHasUser(series)}
        <div
          class="rounded-xl border p-2.5 {userMatchup
            ? 'border-primary/50 bg-primary/5'
            : 'border-line-soft bg-surface-1'}"
        >
          <div class="flex items-center justify-between gap-2">
            <span
              class="font-mono text-[8px] font-bold tracking-[0.1em] text-muted-foreground uppercase"
            >
              {conference === null ? 'Finals' : conference === 'west' ? 'West' : 'East'}
            </span>
            <span class="font-mono text-[9px] tabular-nums text-muted-foreground">
              {capRushSeriesWins(series, series.highTeamId)}–{capRushSeriesWins(
                series,
                series.lowTeamId,
              )}
            </span>
          </div>
          {#each [series.highTeamId, series.lowTeamId] as teamId (teamId)}
            {@const wins = capRushSeriesWins(series, teamId)}
            <div
              class="mt-1 flex items-center gap-1.5 text-[11px] {winner === teamId
                ? 'font-bold text-foreground'
                : 'text-muted-foreground'}"
            >
              <span class="w-4 shrink-0 text-center font-mono text-[9px] tabular-nums"
                >{seriesSeed(series, teamId)}</span
              >
              <span class="min-w-0 flex-1 truncate" title={teamName(teamId)}
                >{teamName(teamId)}</span
              >
              {#if teamId === userTeamId}
                <span class="shrink-0 font-mono text-[8px] font-bold text-primary uppercase"
                  >You</span
                >
              {/if}
              <span class="shrink-0 font-mono text-[10px] tabular-nums">{wins}</span>
            </div>
          {/each}
          {#if winner !== null}
            <p class="mt-1 font-mono text-[8px] font-bold text-positive uppercase">
              Series decided
            </p>
          {/if}
        </div>
      {/each}
      {#if round.series.length === 0}
        <div
          class="rounded-xl border border-dashed border-line-soft p-3 text-[10px] text-muted-foreground"
        >
          Awaiting the previous round.
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet postseasonPanel()}
  {#if postseasonStatus !== null}
    <Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Full Court postseason status">
      <SectionHeading eyebrow="Postseason" title={postseasonStatus.headline} level={2} size="md">
        {#snippet actions()}
          <Badge tone="neutral">
            {championId === null ? 'Bracket in progress' : 'Final'}
          </Badge>
        {/snippet}
      </SectionHeading>
      <p class="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {postseasonStatus.message}
      </p>

      {#if championId !== null}
        <div
          class="mt-4 flex items-center gap-4 rounded-xl border border-accent/50 bg-accent/10 p-4"
          role="status"
        >
          <Trophy size={32} class="shrink-0 text-accent" aria-hidden="true" />
          <div class="min-w-0">
            <p class="ui-label text-accent">Champion</p>
            <p class="font-display text-2xl font-extrabold tracking-tight uppercase">
              {teamName(championId)}
            </p>
            {#if championId === userTeamId}
              <p class="mt-1 text-xs text-muted-foreground">Your five took the title.</p>
            {/if}
          </div>
        </div>
      {/if}
    </Panel>
  {/if}
{/snippet}

{#snippet userSeriesPanel()}
  {#if userSeries !== null}
    <Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Your playoff series">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="ui-label text-accent">
            {capRushConferenceRoundName(userSeries.round)} ·
            {#if userSeriesActive}
              Game {Math.min(CAP_RUSH_SERIES_GAMES, userSeries.games.length + 1)}
            {:else}
              Series complete
            {/if}
          </p>
          <h3 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
            {userSeriesActive ? 'Your series is live' : 'Your series is decided'}
          </h3>
        </div>
        <p class="font-mono text-[10px] text-muted-foreground uppercase">
          Best of seven · First to {CAP_RUSH_SERIES_WINS}
        </p>
      </div>

      <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        {#each [userSeries.highTeamId, userSeries.lowTeamId] as teamId, index (teamId)}
          {@const identity = identityOf(teamId)}
          {@const wins = capRushSeriesWins(userSeries, teamId)}
          {@const won = userSeriesWinner === teamId}
          <div
            class="flex min-w-0 items-center gap-3 rounded-xl border p-3 {teamId === userTeamId
              ? 'border-primary/50 bg-primary/10'
              : 'border-line-soft bg-surface-1'} {index === 1 ? 'sm:order-3 sm:text-right' : ''}"
          >
            {#if identity !== null && manifest !== null}
              <TeamLogo
                {manifest}
                franchiseId={identity.franchiseId}
                teamExternalId={identity.teamExternalId}
                alt=""
                className="h-8 w-8 {index === 1 ? 'sm:order-2' : ''}"
              />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="font-mono text-[9px] text-muted-foreground uppercase">
                Seed {seriesSeed(userSeries, teamId)}
              </p>
              <p class="truncate text-sm font-bold" title={teamName(teamId)}>
                {teamName(teamId)}
              </p>
              {#if won}
                <p class="font-mono text-[9px] font-bold text-positive uppercase">Series won</p>
              {/if}
            </div>
            <div class="shrink-0 text-center">
              <span
                class="font-display block text-4xl leading-none font-extrabold tabular-nums {won
                  ? 'text-accent'
                  : 'text-foreground'}">{wins}</span
              >
            </div>
          </div>
          {#if index === 0}
            <span
              class="hidden text-center font-mono text-[10px] text-muted-foreground uppercase sm:order-2 sm:block"
              >vs</span
            >
          {/if}
        {/each}
      </div>

      {#if nextUserGame !== null && userSeriesActive}
        <p class="mt-3 text-xs text-muted-foreground">
          Up next: Game {nextUserGame.gameOrdinal}
          {nextUserGame.userSide === 'home' ? 'at home' : 'on the road'} against
          <strong class="text-foreground"
            >{userSeriesOpponentId === null
              ? 'your opponent'
              : teamName(userSeriesOpponentId)}</strong
          >.
        </p>
      {/if}
      {#if userSeriesActive && userPlayoffAdjustment !== null}
        <div
          class="mt-3 rounded-xl border border-line-soft bg-surface-1 p-3"
          aria-label="Playoff opponent adjustment"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="ui-label text-muted-foreground">Opponent adjustment</p>
            <Badge tone="accent">{userPlayoffAdjustment.settingLabel}</Badge>
          </div>
          <p class="mt-1 text-[11px] font-bold">{userPlayoffAdjustment.reasonLabel}</p>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            {userPlayoffAdjustment.detailLabel}
          </p>
        </div>
      {/if}

      {#if userSeriesGames.length > 0}
        <ol class="mt-3 flex flex-col gap-1.5" aria-label="Games in your playoff series">
          {#each userSeriesGames as game (game.gameId)}
            <li
              class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-soft bg-surface-1 px-3 py-2"
            >
              <span class="font-mono text-[9px] font-bold text-muted-foreground uppercase"
                >Game {game.gameOrdinal}</span
              >
              <span class="font-mono text-[10px] text-muted-foreground uppercase">
                {game.userHome ? 'Home' : 'Away'}
              </span>
              <span
                class="font-display ml-auto text-lg font-extrabold tabular-nums"
                title={game.scoreLabel}>{game.compactLabel}</span
              >
              <span
                class="rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase {game.won
                  ? 'border-positive/40 bg-positive/10 text-positive'
                  : 'border-negative/40 bg-negative/10 text-negative'}"
                >{game.won ? 'Win' : 'Loss'}</span
              >
              {#if game.forfeit && !game.doubleForfeit}
                <span class="font-mono text-[8px] text-muted-foreground uppercase">Forfeit</span>
              {/if}
              {#if game.opponentAdaptation !== null}
                {@const adjustment = fullCourtPlayoffAdaptationRead(game.opponentAdaptation)}
                <span
                  class="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[8px] font-bold text-accent uppercase"
                  title={`${adjustment.reasonLabel}: ${adjustment.detailLabel}`}
                  aria-label={`Game ${game.gameOrdinal} opponent adjustment: ${adjustment.settingLabel}`}
                  >{adjustment.settingLabel}</span
                >
              {/if}
              {#if game.adjustmentResponse !== null}
                <p class="basis-full text-xs text-muted-foreground">{game.adjustmentResponse}</p>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </Panel>
  {/if}
{/snippet}

{#snippet bracketPanel()}
  <Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Full Court playoff bracket">
    <SectionHeading eyebrow="Bracket" title="Four rounds to the title" level={2} size="md">
      {#snippet actions()}
        <SegmentedControl
          class="lg:hidden"
          label="Choose a playoff round"
          size="md"
          value={activeRound}
          onchange={(round) => (selectedRound = round)}
          options={bracketRounds.map((round) => ({
            value: round.round,
            label: round.label,
          }))}
        />
      {/snippet}
    </SectionHeading>

    <div class="mt-4 lg:hidden">
      {#if bracketRounds.length > 0}
        {@const activeBracket = bracketRounds.find((round) => round.round === activeRound)}
        {#if activeBracket !== undefined}
          {@render bracketRoundColumn(activeBracket)}
        {/if}
      {/if}
    </div>

    <div class="mt-4 hidden gap-3 lg:grid lg:grid-cols-4">
      {#each bracketRounds as round (round.round)}
        {@render bracketRoundColumn(round)}
      {/each}
    </div>
  </Panel>
{/snippet}

{#snippet recapPanel()}
  {#if recap !== null}
    <Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Full Court final recap">
      <SectionHeading eyebrow="Final" title={recap.headline} level={2} size="md">
        {#snippet actions()}
          <Badge tone={recap.userChampion ? 'positive' : 'neutral'}>
            {recap.userChampion ? 'Your title' : 'Season complete'}
          </Badge>
        {/snippet}
      </SectionHeading>
      <p class="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {recap.message}
      </p>

      <div
        class="mt-4 flex items-center gap-4 rounded-xl border border-accent/50 bg-accent/10 p-4"
        role="status"
      >
        <Trophy size={32} class="shrink-0 text-accent" aria-hidden="true" />
        <div class="min-w-0">
          <p class="ui-label text-accent">Champion</p>
          <p class="font-display text-2xl font-extrabold tracking-tight uppercase">
            {recap.championName}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {#if recap.userChampion}
              Your five took the title.
            {:else}
              Your run is over; the bracket finished without you.
            {/if}
          </p>
        </div>
      </div>

      <StatGrid class="mt-4" columns={3} mobile={3}>
        <StatTile
          label="Series won"
          size="md"
          surface="tile"
          value={`${recap.seriesWon} / ${recap.seriesPlayed}`}
        />
        <StatTile
          label="Playoff games"
          size="md"
          surface="tile"
          value={`${recap.gameWins}–${recap.gameLosses}`}
        />
        <StatTile
          label="Final record"
          size="md"
          surface="tile"
          value={recordLabel(userRow?.wins ?? 0, userRow?.losses ?? 0)}
        />
      </StatGrid>

      {#if recap.series.length > 0}
        <ol class="mt-4 flex flex-col gap-1.5" aria-label="Your playoff series results">
          {#each recap.series as entry (entry.round)}
            <li
              class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-soft bg-surface-1 px-3 py-2"
            >
              <span class="font-mono text-[9px] font-bold text-muted-foreground uppercase"
                >{entry.roundLabel}</span
              >
              <span class="min-w-0 flex-1 truncate text-[11px] font-semibold"
                >{entry.opponentName}</span
              >
              <span class="font-display text-lg font-extrabold tabular-nums"
                >{entry.userWins}–{entry.opponentWins}</span
              >
              <span
                class="rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase {entry.won
                  ? 'border-positive/40 bg-positive/10 text-positive'
                  : 'border-negative/40 bg-negative/10 text-negative'}"
                >{entry.won ? 'Won' : 'Lost'}</span
              >
            </li>
          {/each}
        </ol>
      {:else}
        <p class="mt-4 text-xs text-muted-foreground">You did not reach the bracket this season.</p>
      {/if}
    </Panel>
  {/if}
{/snippet}

{#snippet homePanel()}
  <Panel as="section" padding="md" aria-label="Full Court season progress">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="ui-label">
          Full Court ·
          {playoff === null ? 'Regular season' : 'Postseason'}
        </p>
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
    </div>

    {#if matchup !== null}
      <div class="mt-5 rounded-xl border border-line-strong bg-surface-2/40 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="ui-label" data-tone="muted">{matchup.label}</p>
          {#if matchup.series !== null}
            <Badge tone="accent">
              Series {matchup.series.userWins}–{matchup.series.opponentWins}
            </Badge>
          {:else}
            <Badge tone={matchup.phase === 'playoff' ? 'accent' : 'neutral'}>
              {matchup.phase === 'playoff' ? 'Postseason' : 'Next game'}
            </Badge>
          {/if}
        </div>
        <div
          class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch"
        >
          {@render matchupSide(matchup.home, matchup.phase === 'playoff' ? null : 'Home')}
          <span
            class="self-center text-center font-mono text-[10px] text-muted-foreground uppercase"
            >vs</span
          >
          {@render matchupSide(matchup.away, matchup.phase === 'playoff' ? null : 'Away')}
        </div>
        {#if matchup.userSide !== null && matchup.series === null}
          <p class="mt-2 font-mono text-[9px] text-muted-foreground uppercase">
            Your five {matchup.userSide === 'home' ? 'host this game' : 'travel for this game'}
          </p>
        {/if}
        {#if matchup.phase === 'playoff' && matchup.userSide !== null && userPlayoffAdjustment !== null}
          <div
            class="mt-3 rounded-xl border border-line-soft bg-surface-1 p-3"
            aria-label="Playoff opponent adjustment"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="ui-label text-muted-foreground">Opponent adjustment</p>
              <Badge tone="accent">{userPlayoffAdjustment.settingLabel}</Badge>
            </div>
            <p class="mt-1 text-[11px] font-bold">{userPlayoffAdjustment.reasonLabel}</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground">
              {userPlayoffAdjustment.detailLabel}
            </p>
          </div>
        {/if}
      </div>
    {:else if playoff !== null && championId === null}
      <p class="mt-4 text-xs leading-relaxed text-muted-foreground">
        No game is ready for your five. The rest of the bracket is finishing.
      </p>
    {/if}

    <div class="mt-4">
      <FullCourtGameDayPanel
        readiness={gameDayReadiness}
        {restingPlayerIds}
        {busy}
        {onRestingChange}
      />
    </div>

    <div
      class="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4"
      aria-busy={busy}
    >
      {#if controls.primary !== null}
        <Button
          tone="primary"
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
      {#each controls.secondary as action (action.label)}
        <Button tone="secondary" disabled={busy} onclick={() => runAction(action)}>
          {#if action.count >= 5}
            <FastForward size={15} aria-hidden="true" />
          {:else}
            <SkipForward size={15} aria-hidden="true" />
          {/if}
          {action.label}
        </Button>
      {/each}
      {#if onWatchNextGame !== undefined && controls.primary?.kind === 'sim' && matchup?.userSide && nextBracketGameHasUser}
        <Button tone="secondary" disabled={busy || pendingForfeit} onclick={onWatchNextGame}>
          Watch next game
        </Button>
      {/if}
      <p class="text-[11px] text-muted-foreground" role="status">
        {controls.status}
      </p>
    </div>

    {#if notice !== null && !busy}
      <Alert class="mt-3" tone={notice.tone} title={notice.title}>
        <p>{notice.message}</p>
        {#snippet actions()}
          <Button size="sm" tone="secondary" onclick={() => onDismissNotice?.()}>Dismiss</Button>
        {/snippet}
      </Alert>
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
  </Panel>
{/snippet}

{#snippet latestResultPanel()}
  {#if latestCell !== null && latestResult !== null}
    <Panel as="section" padding="sm" aria-label="Latest Full Court result">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="ui-label" data-tone="muted">
          {playoff === null ? 'Latest result' : 'Latest regular-season result'} · Game {latestCell.slot}
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
    <p class="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
      {#if seasonStats.regular.playedGames === 0}
        No played games yet. Bench scoring and lineup samples appear after your first result.
      {:else}
        Based on {seasonStats.regular.playedGames} played regular-season
        {seasonStats.regular.playedGames === 1 ? 'game' : 'games'}{seasonStats.playoff.playedGames >
        0
          ? ` and ${seasonStats.playoff.playedGames} played playoff ${seasonStats.playoff.playedGames === 1 ? 'game' : 'games'}`
          : ''}.
      {/if}
      Forfeits ({seasonStats.regular.forfeitGames + seasonStats.playoff.forfeitGames}) are excluded
      from scoring, efficiency, and lineup samples.
    </p>
    <StatGrid class="mt-4" columns={4} mobile={2}>
      <StatTile
        label="Bench points"
        size="md"
        surface="tile"
        tone={seasonStats.bench !== null && seasonStats.bench.totalBenchPoints < 0
          ? 'negative'
          : 'muted'}
        value={seasonStats.bench === null || seasonStats.bench.gamesRecorded === 0
          ? '—'
          : signed(seasonStats.bench.totalBenchPoints)}
      />
      <StatTile
        label="Bench per game"
        size="md"
        surface="tile"
        value={seasonStats.bench === null || seasonStats.bench.gamesRecorded === 0
          ? '—'
          : seasonStats.bench.averageBenchPoints.toFixed(1)}
      />
      <StatTile
        label="Regular points"
        size="md"
        surface="tile"
        value={seasonStats.regular.playedGames === 0 ? '—' : seasonStats.regular.pointsFor}
      />
      <StatTile
        label="Regular diff"
        size="md"
        surface="tile"
        tone={seasonStats.regular.pointDifferential > 0
          ? 'primary'
          : seasonStats.regular.pointDifferential < 0
            ? 'negative'
            : 'muted'}
        value={signed(seasonStats.regular.pointDifferential)}
      />
    </StatGrid>
    {#if seasonStats.bench !== null && seasonStats.bench.bestGame !== null}
      <p class="mt-3 text-xs text-muted-foreground">
        Best bench game: {seasonStats.bench.bestGame.benchPoints} points in game
        {seasonStats.bench.bestGame.gameNumber}.
      </p>
    {/if}
  </Panel>

  <Panel as="section" padding="md" aria-label="Full Court lineup lab">
    <SectionHeading eyebrow="Lineup Lab" title="Actual fives" level={2} size="md">
      {#snippet actions()}
        <Badge tone="neutral">Sample floor {seasonStats.lineups.sampleThreshold} poss</Badge>
      {/snippet}
    </SectionHeading>
    {#if seasonStats.lineups.rows.length > 0}
      <p class="mt-2 text-xs text-muted-foreground">
        Minutes, points for and against, and net rating use only facts recorded from lineup stints
        and the exact possession tape at simulation time. A unit that breaks and returns is one row.
        Rank is withheld below
        {seasonStats.lineups.sampleThreshold} possessions; * marks a below-sample row.
      </p>
      <div class="overflow-x-auto">
        <table class="ui-stats-table mt-3" aria-label="Full Court season lineups">
          <thead>
            <tr>
              <th scope="col" data-align="start">Lineup</th>
              <th scope="col">GP</th>
              <th scope="col">MIN</th>
              <th scope="col">PF</th>
              <th scope="col">PA</th>
              <th scope="col">POSS</th>
              <th scope="col">NET RTG</th>
              <th scope="col">RK</th>
            </tr>
          </thead>
          <tbody>
            {#each seasonStats.lineups.rows as lineup (lineup.key)}
              <tr>
                <th scope="row" data-align="start"
                  >{lineup.players.map((player) => player.displayName).join(' · ')}</th
                >
                <td>{lineup.games}</td>
                <td>{lineup.minutes.toFixed(1)}</td>
                <td>{lineup.pointsFor}</td>
                <td>{lineup.pointsAgainst}</td>
                <td>{possessionLabel(lineup.pacePossessions)}</td>
                <td>{rateLabel(lineup.netRatingPer100)}{lineup.sampleMet ? '' : ' *'}</td>
                <td title={lineup.sampleMet ? 'Net-rating rank' : 'Below the sample floor'}
                  >{lineup.rank ?? '—'}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if seasonStats.lineups.omitted.lineups > 0}
        <p class="mt-2 text-xs text-muted-foreground">
          {seasonStats.lineups.omitted.lineups} low-usage
          {seasonStats.lineups.omitted.lineups === 1 ? 'lineup was' : 'lineups were'} omitted from the
          table in {seasonStats.lineups.omitted.games}
          {seasonStats.lineups.omitted.games === 1 ? 'game' : 'games'}; their minutes and points
          remain in the coverage totals, not in a row.
        </p>
      {/if}
    {:else if seasonStats.lineups.gamesExpected > 0}
      <Alert class="mt-3" tone="info" title="No lineup facts in this save">
        <p>
          This save has played games but no recorded lineup samples yet. Lineup detail is recorded
          for newly simulated user games; bench totals above still use the saved compact results.
        </p>
      </Alert>
    {:else}
      <p class="mt-2 text-xs text-muted-foreground">Play a game to record the first actual five.</p>
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
    <p class="mt-2 text-xs text-muted-foreground">
      Seeds 1–{CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS} in each conference qualify. Ties break on wins, then
      head-to-head record among tied teams, then conference record, point differential, points scored
      and stable team id.
    </p>
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <ConferenceStandingsTable
        conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.west}
        caption="West Full Court standings"
        rows={standings.west}
        {userTeamId}
        {manifest}
      />
      <ConferenceStandingsTable
        conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.east}
        caption="East Full Court standings"
        rows={standings.east}
        {userTeamId}
        {manifest}
      />
    </div>
  </Panel>
{/snippet}

<div class="flex flex-col gap-3">
  {#if section === 'home'}
    {@render homePanel()}
    {#if recap !== null}
      {@render recapPanel()}
    {:else if playoff !== null}
      {@render postseasonPanel()}
    {/if}
    {@render latestResultPanel()}
  {:else if section === 'league'}
    {@render leaguePanel()}
  {:else if section === 'stats'}
    {@render statsPanel()}
  {:else if playoff === null}
    <Panel as="section" padding="md" aria-label="Full Court postseason">
      <SectionHeading
        eyebrow="Postseason"
        title={regularComplete
          ? 'The bracket is ready to seed'
          : 'The bracket opens after 82 games'}
        level={2}
        size="md"
      />
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {#if regularComplete}
          The regular season is complete. Seed the top eight in each conference and play the
          bracket.
        {:else}
          {remaining}
          {remaining === 1 ? 'regular-season game remains' : 'regular-season games remain'} before the
          top eight in each conference are seeded.
        {/if}
      </p>
      {#if regularComplete}
        <Button
          class="mt-4"
          tone="primary"
          disabled={busy || pendingForfeit}
          onclick={startPlayoffs}
        >
          <Trophy size={15} aria-hidden="true" />
          Start playoffs
        </Button>
      {/if}
    </Panel>
  {:else}
    {@render postseasonPanel()}
    {@render userSeriesPanel()}
    {@render bracketPanel()}
  {/if}
</div>
