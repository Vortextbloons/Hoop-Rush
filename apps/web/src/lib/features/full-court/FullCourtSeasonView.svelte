<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    CAP_RUSH_CONFERENCE_NAMES,
    CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
    CAP_RUSH_PLAYOFF_TEAMS,
    CAP_RUSH_SERIES_GAMES,
    CAP_RUSH_SERIES_WINS,
    capRushConferenceRoundName,
    capRushSeriesConferenceOf,
    capRushSeriesWinner,
    capRushSeriesWins,
    type FullCourtSeasonCheckpoint,
    type FullCourtSeasonScore,
  } from '@hoop-rush/data-contracts';
  import { FastForward, Play, ShieldAlert, SkipForward, Trophy } from '@lucide/svelte';
  import { fullCourtStandings, type FullCourtSeasonLock } from '@hoop-rush/engine';
  import ConferenceStandingsTable from '#lib/components/basketball/ConferenceStandingsTable.svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import {
    fullCourtPlayoffRounds,
    fullCourtPlayoffStatus,
    fullCourtSeriesGames,
    fullCourtUserSchedule,
    fullCourtUserSeries,
    type FullCourtBracketRound,
    type FullCourtPlayoffView,
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
  }: {
    lock: FullCourtSeasonLock;
    checkpoint: FullCourtSeasonCheckpoint;
    scores: readonly FullCourtSeasonScore[];
    playoff: FullCourtPlayoffView | null;
    pendingForfeit: boolean;
    busy: boolean;
    onAdvance: (count: number, acceptForfeit?: boolean) => void;
    onStartPlayoffs: () => void;
  } = $props();

  let selectedRound = $state<number | null>(null);

  const schedule = $derived(fullCourtUserSchedule(lock, scores));
  const standings = $derived(fullCourtStandings(lock.season.teams, scores));
  const userTeamId = $derived(lock.season.userTeamId);
  const teamsById = $derived(new Map(lock.season.teams.map((team) => [team.teamId, team])));
  const userTeamName = $derived(teamsById.get(userTeamId)?.displayName ?? userTeamId);
  const userRow = $derived(
    [...standings.west, ...standings.east].find((row) => row.teamId === userTeamId) ?? null,
  );
  const userConferenceName = $derived(
    userRow === null ? null : CAP_RUSH_CONFERENCE_NAMES[userRow.conference],
  );
  const played = $derived(
    Math.min(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, checkpoint.completedThroughSlot),
  );
  const remaining = $derived(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - played);
  const regularComplete = $derived(played === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM);
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
  const nextUserGame = $derived.by(() => {
    const next = playoff?.nextGame ?? null;
    if (next === null || userSeries === null) return null;
    return next.seriesId === userSeries.seriesId ? next : null;
  });
  const championId = $derived(playoff?.championTeamId ?? null);
  const postseasonStatus = $derived(
    playoff === null ? null : fullCourtPlayoffStatus(playoff, userTeamId, teamName),
  );
  const latestRound = $derived.by(() => {
    const populated = bracketRounds.filter((round) => round.series.length > 0);
    return populated.length === 0 ? 1 : Math.max(...populated.map((round) => round.round));
  });
  const activeRound = $derived(selectedRound ?? latestRound);
  const simFiveCount = $derived(Math.min(5, remaining));
  const playoffGameLimit = (CAP_RUSH_PLAYOFF_TEAMS - 1) * CAP_RUSH_SERIES_GAMES;
  const userAlive = $derived(playoff?.userOutcome.status === 'pending');

  function teamName(teamId: string): string {
    return teamsById.get(teamId)?.displayName ?? teamId;
  }

  function recordLabel(wins: number, losses: number): string {
    return `${String(wins)}–${String(losses)}`;
  }

  function signed(value: number): string {
    return value > 0 ? `+${String(value)}` : String(value);
  }

  function requestAdvance(count: number): void {
    if (busy || pendingForfeit || count <= 0) return;
    onAdvance(count);
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
  <span class="font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
    {#if latestResult?.forfeit}
      {latestResult.scoreLabel}
    {:else}
      {latestCell?.userHome ? 'vs' : '@'}
    {/if}
  </span>
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

<div class="flex flex-col gap-3">
  <Panel
    as="section"
    padding="none"
    class="full-court-scoreboard p-5 sm:p-7"
    aria-label="Full Court season progress"
  >
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <p class="ui-label">
          Full Court ·
          {playoff === null ? 'Regular season' : 'Postseason'}
        </p>
        <h2
          class="font-display mt-2 text-5xl leading-none font-extrabold tracking-tight tabular-nums sm:text-6xl"
        >
          {recordLabel(userRow?.wins ?? 0, userRow?.losses ?? 0)}
        </h2>
        <p class="mt-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {played} of {CAP_RUSH_CONFERENCE_GAMES_PER_TEAM} games played
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {userTeamName}
          {#if userConferenceName !== null}
            · {userConferenceName}
          {/if}
        </p>
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

    {#if latestCell !== null && latestResult !== null}
      <div class="mt-5 rounded-xl border border-line-strong bg-surface-1/60 p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="ui-label" data-tone="muted">
            {playoff === null ? 'Latest result' : 'Latest regular-season result'} · Game {latestCell.slot}
          </p>
          <span
            class="rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase {latestResult.won
              ? 'border-positive/40 bg-positive/10 text-positive'
              : 'border-negative/40 bg-negative/10 text-negative'}"
          >
            {latestResult.doubleForfeit ? 'Double forfeit' : latestResult.won ? 'Win' : 'Loss'}
          </span>
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
      </div>
    {:else}
      <p class="mt-4 text-xs leading-relaxed text-muted-foreground">
        No Full Court games have been played yet. Your first result lands here.
      </p>
    {/if}

    <div
      class="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4"
      aria-busy={busy}
    >
      {#if pendingForfeit}
        <span class="text-xs font-semibold text-accent">A forfeit needs confirmation.</span>
      {:else if playoff !== null}
        {#if championId === null && playoff.nextGame !== null}
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={busy}
            onclick={() => requestAdvance(1)}
          >
            <Play size={15} aria-hidden="true" />
            Sim next game
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={busy}
            onclick={() => requestAdvance(userAlive ? 5 : playoffGameLimit)}
          >
            {#if userAlive}
              <SkipForward size={15} aria-hidden="true" />
              Sim next five
            {:else}
              <FastForward size={15} aria-hidden="true" />
              Sim remaining games
            {/if}
          </button>
        {:else if championId !== null}
          <span class="text-xs font-semibold text-muted-foreground">
            The bracket is complete. Review the final result below.
          </span>
        {:else}
          <span class="text-xs font-semibold text-muted-foreground">
            No playoff game is ready yet.
          </span>
        {/if}
      {:else if regularComplete}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-accent/60 bg-accent/10 px-4 text-sm font-bold text-accent outline-none hover:bg-accent/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={busy}
          onclick={startPlayoffs}
        >
          <Trophy size={15} aria-hidden="true" />
          Start playoffs
        </button>
      {:else}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={busy}
          onclick={() => requestAdvance(1)}
        >
          <Play size={15} aria-hidden="true" />
          Sim next game
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={busy}
          onclick={() => requestAdvance(simFiveCount)}
        >
          <SkipForward size={15} aria-hidden="true" />
          Sim {simFiveCount}
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={busy}
          onclick={() => requestAdvance(remaining)}
        >
          <FastForward size={15} aria-hidden="true" />
          Sim remaining games
        </button>
      {/if}
      <p class="text-[11px] text-muted-foreground" role="status">
        {#if busy}
          Simulation in progress…
        {:else if pendingForfeit}
          The next game cannot continue until the forfeit is accepted.
        {:else if playoff !== null && championId !== null}
          The bracket and champion are saved.
        {:else if regularComplete && playoff === null}
          The 82-game regular season is complete. Seed the bracket.
        {:else if playoff !== null}
          Accepted results save immediately.
        {:else}
          One game, five games, or the rest of the regular season.
        {/if}
      </p>
    </div>

    {#if pendingForfeit}
      <Alert class="mt-3" tone="warning" title="Confirm the forfeit">
        <p>
          The next Full Court game is a forfeit. Confirm it to record the result and continue the
          season.
        </p>
        {#snippet actions()}
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-accent/60 bg-accent/10 px-4 text-sm font-bold text-accent outline-none hover:bg-accent/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={busy}
            onclick={confirmForfeit}
          >
            <ShieldAlert size={15} aria-hidden="true" />
            {busy ? 'Recording…' : 'Confirm forfeit'}
          </button>
        {/snippet}
      </Alert>
    {/if}
  </Panel>

  {#if playoff !== null && postseasonStatus !== null}
    <Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Full Court postseason status">
      <SectionHeading eyebrow="Postseason" title={postseasonStatus.headline} level={2} size="md">
        {#snippet actions()}
          <span
            class="rounded-full border border-line-strong bg-surface-2 px-3 py-1 font-mono text-[10px] font-bold text-muted-foreground uppercase"
          >
            {championId === null ? 'Bracket in progress' : 'Final'}
          </span>
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
            {@const wins = capRushSeriesWins(userSeries, teamId)}
            {@const won = userSeriesWinner === teamId}
            <div
              class="flex min-w-0 items-center gap-3 rounded-xl border p-3 {teamId === userTeamId
                ? 'border-primary/50 bg-primary/10'
                : 'border-line-soft bg-surface-1'} {index === 1 ? 'sm:order-3 sm:text-right' : ''}"
            >
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
              </li>
            {/each}
          </ol>
        {/if}
      </Panel>
    {/if}

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
  {/if}

  <Panel as="section" padding="md" aria-label="Full Court schedule results">
    <SectionHeading
      title={`Regular season · ${String(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM)} games`}
      level={2}
      size="sm"
    >
      {#snippet actions()}
        <p class="font-mono text-[10px] text-muted-foreground uppercase">
          {played} played · {remaining} remaining
        </p>
      {/snippet}
    </SectionHeading>

    <ol
      class="mt-3 grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8"
      aria-label="Full Court game results"
    >
      {#each schedule as cell (cell.slot)}
        {@const result = cell.result}
        <li class="min-w-0">
          <div
            class="flex min-h-12 w-full min-w-0 flex-col justify-center rounded-lg border px-1.5 py-1 text-left {result ===
            null
              ? 'border-dashed border-line-soft bg-background/40 text-muted-foreground'
              : result.won
                ? 'border-positive/40 bg-positive/10 text-foreground'
                : 'border-negative/40 bg-negative/10 text-foreground'}"
            title={result === null
              ? `Game ${String(cell.slot)} ${cell.userHome ? 'vs' : 'at'} ${cell.opponentName}, not played`
              : `Game ${String(cell.slot)} ${cell.userHome ? 'vs' : 'at'} ${cell.opponentName}, ${result.won ? 'win' : 'loss'} ${result.scoreLabel}`}
          >
            <span class="flex items-baseline justify-between gap-1">
              <span class="font-mono text-[9px] font-bold tabular-nums opacity-70">{cell.slot}</span
              >
              <span
                class="font-mono text-[9px] font-extrabold uppercase {result === null
                  ? ''
                  : result.won
                    ? 'text-positive'
                    : 'text-negative'}">{result === null ? '·' : result.won ? 'W' : 'L'}</span
              >
            </span>
            <span class="truncate font-mono text-[10px] font-bold">{cell.opponentAbbreviation}</span
            >
            <span class="truncate font-mono text-[9px] tabular-nums opacity-80">
              {result === null ? (cell.userHome ? 'vs' : '@') : result.compactLabel}
            </span>
          </div>
        </li>
      {/each}
    </ol>
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
          <p
            class="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold text-primary uppercase"
          >
            {userConferenceName ?? 'Your conference'} · Seed {userRow.seed}
          </p>
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
      />
      <ConferenceStandingsTable
        conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.east}
        caption="East Full Court standings"
        rows={standings.east}
        {userTeamId}
      />
    </div>
  </Panel>
</div>

<style>
  :global(.full-court-scoreboard) {
    border-top: 3px solid var(--color-accent);
    background-image: radial-gradient(
      ellipse at top left,
      color-mix(in srgb, var(--color-accent) 12%, transparent),
      transparent 55%
    );
  }
</style>
