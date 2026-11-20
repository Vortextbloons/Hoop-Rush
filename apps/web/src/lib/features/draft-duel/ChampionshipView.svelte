<script lang="ts">
  import { Repeat } from '@lucide/svelte';
  import type {
    DraftDuelCard,
    DraftDuelGameOutput,
    DraftDuelParticipantId,
    DraftDuelSeriesMvp,
    DraftDuelSeriesSnapshot,
    DraftDuelStandout,
    HoopRushManifest,
    PlayerId,
    TeamResult,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import ComparisonTable from '#lib/components/screens/ComparisonTable.svelte';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import SeriesRecap from '#lib/components/screens/SeriesRecap.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import type { ComparisonRow, SeriesRecapGame } from '#lib/components/ui/types.js';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { SLOT_LABELS } from '#lib/player-positions.js';
  import { initialsOf } from '#lib/branding.js';
  import {
    perGameText,
    ratioPct,
    trueShootingPct,
    usagePct,
    usagePossessions,
  } from '#lib/format.js';

  let {
    series,
    mvp,
    standouts,
    localParticipantId,
    games,
    cards = {},
    manifest = null,
    rematchRequested,
    localRematchRequested = false,
    rematchBusy = false,
    rematchConfirmed,
    onrematch,
    onconfirmrematch,
    onlobby = null,
    showRematch = true,
  }: {
    series: DraftDuelSeriesSnapshot;
    mvp: DraftDuelSeriesMvp | null;
    standouts: DraftDuelStandout[];
    localParticipantId: DraftDuelParticipantId;
    games: DraftDuelGameOutput[];
    cards?: Record<string, DraftDuelCard>;
    manifest?: HoopRushManifest | null;
    rematchRequested: boolean;
    localRematchRequested?: boolean;
    rematchBusy?: boolean;
    rematchConfirmed: boolean;
    onrematch: () => void;
    onconfirmrematch: () => void;
    onlobby?: (() => void) | null;
    showRematch?: boolean;
  } = $props();

  interface RecapGame {
    gameNumber: number;
    localScore: number;
    opponentScore: number;
    localWon: boolean;
    margin: number;
    overtime: boolean;
    record: string;
    standouts: DraftDuelStandout[];
  }

  interface SideTotals {
    games: number;
    points: number;
    fieldGoalMakes: number;
    fieldGoalAttempts: number;
    threeMakes: number;
    threeAttempts: number;
    freeThrowMakes: number;
    freeThrowAttempts: number;
    rebounds: number;
    assists: number;
    turnovers: number;
  }

  interface LeaderCandidate {
    playerId: PlayerId;
    points: number;
    rebounds: number;
    assists: number;
    games: number;
  }

  interface Leader {
    playerId: PlayerId;
    name: string;
    total: number;
    perGame: string;
  }

  interface SideLeaders {
    points: Leader | null;
    rebounds: Leader | null;
    assists: Leader | null;
  }

  interface PlayerAggregate {
    playerId: PlayerId;
    slotIndex: number;
    games: number;
    minutes: number;
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fieldGoalMakes: number;
    fieldGoalAttempts: number;
    threeMakes: number;
    threeAttempts: number;
    freeThrowMakes: number;
    freeThrowAttempts: number;
  }

  let statsSide = $state<'you' | 'opp'>('you');
  let statsTotals = $state(false);
  const statsSideOptions = [
    { value: 'you', label: 'You' },
    { value: 'opp', label: 'Opponent' },
  ] as const;

  const orderedGames = $derived([...games].sort((a, b) => a.gameNumber - b.gameNumber));
  const localWins = $derived(localParticipantId === 'p1' ? series.p1Wins : series.p2Wins);
  const opponentWins = $derived(localParticipantId === 'p1' ? series.p2Wins : series.p1Wins);
  const championIsLocal = $derived(series.champion === localParticipantId);
  const seriesDecided = $derived(series.champion !== null);
  const hasBoxScores = $derived(orderedGames.length > 0);

  const title = $derived(
    series.champion === null
      ? 'Series in progress'
      : championIsLocal
        ? 'You are the champion'
        : 'Opponent takes the series',
  );
  const championState = $derived(
    championIsLocal ? 'local' : series.champion === null ? 'pending' : 'opponent',
  );
  const heroTone = $derived(
    series.champion === null ? 'default' : championIsLocal ? 'champion' : 'defeat',
  );
  const heroMeta = $derived(
    `${
      localWins > opponentWins ? 'You win' : localWins < opponentWins ? 'Opponent wins' : 'Tied'
    } the best-of-seven · first to four.`,
  );

  function nameOf(playerId: string): string {
    return cards[playerId]?.displayName ?? playerId.replace(/^p-/, '#').slice(0, 7);
  }

  function faceOf(playerId: PlayerId): {
    playerId: PlayerId;
    playerExternalId: string;
    altIds: null;
  } {
    return {
      playerId,
      playerExternalId: cards[playerId]?.playerExternalId ?? '',
      altIds: null,
    };
  }

  function localTeamOf(game: DraftDuelGameOutput): TeamResult {
    return game.homeParticipantId === localParticipantId ? game.result.home : game.result.away;
  }

  function opponentTeamOf(game: DraftDuelGameOutput): TeamResult {
    return game.homeParticipantId === localParticipantId ? game.result.away : game.result.home;
  }

  function emptyTotals(): SideTotals {
    return {
      games: 0,
      points: 0,
      fieldGoalMakes: 0,
      fieldGoalAttempts: 0,
      threeMakes: 0,
      threeAttempts: 0,
      freeThrowMakes: 0,
      freeThrowAttempts: 0,
      rebounds: 0,
      assists: 0,
      turnovers: 0,
    };
  }

  function addTeamTotals(totals: SideTotals, team: TeamResult): void {
    totals.games += 1;
    totals.points += team.box.points;
    totals.fieldGoalMakes += team.box.fieldGoals.made;
    totals.fieldGoalAttempts += team.box.fieldGoals.attempted;
    totals.threeMakes += team.box.threes.made;
    totals.threeAttempts += team.box.threes.attempted;
    totals.freeThrowMakes += team.box.freeThrows.made;
    totals.freeThrowAttempts += team.box.freeThrows.attempted;
    totals.rebounds += team.box.rebounds.total;
    totals.assists += team.box.assists;
    totals.turnovers += team.box.turnovers;
  }

  const comparison = $derived.by((): { local: SideTotals; opponent: SideTotals } => {
    const local = emptyTotals();
    const opponent = emptyTotals();
    for (const game of orderedGames) {
      addTeamTotals(local, localTeamOf(game));
      addTeamTotals(opponent, opponentTeamOf(game));
    }
    return { local, opponent };
  });

  const comparisonRows = $derived<ComparisonRow[]>([
    {
      label: 'Points per game',
      left: perGameText(comparison.local.points, comparison.local.games),
      right: perGameText(comparison.opponent.points, comparison.opponent.games),
    },
    {
      label: 'FG%',
      left: ratioPct(comparison.local.fieldGoalMakes, comparison.local.fieldGoalAttempts),
      right: ratioPct(comparison.opponent.fieldGoalMakes, comparison.opponent.fieldGoalAttempts),
    },
    {
      label: '3P%',
      left: ratioPct(comparison.local.threeMakes, comparison.local.threeAttempts),
      right: ratioPct(comparison.opponent.threeMakes, comparison.opponent.threeAttempts),
    },
    {
      label: 'TS%',
      left: trueShootingPct(
        comparison.local.points,
        comparison.local.fieldGoalAttempts,
        comparison.local.freeThrowAttempts,
      ),
      right: trueShootingPct(
        comparison.opponent.points,
        comparison.opponent.fieldGoalAttempts,
        comparison.opponent.freeThrowAttempts,
      ),
    },
    {
      label: 'Rebounds per game',
      left: perGameText(comparison.local.rebounds, comparison.local.games),
      right: perGameText(comparison.opponent.rebounds, comparison.opponent.games),
    },
    {
      label: 'Assists per game',
      left: perGameText(comparison.local.assists, comparison.local.games),
      right: perGameText(comparison.opponent.assists, comparison.opponent.games),
    },
    {
      label: 'Turnovers per game',
      left: perGameText(comparison.local.turnovers, comparison.local.games),
      right: perGameText(comparison.opponent.turnovers, comparison.opponent.games),
    },
  ]);

  function collectLeaders(
    teamOf: (game: DraftDuelGameOutput) => TeamResult,
  ): Map<string, LeaderCandidate> {
    const candidates = new Map<string, LeaderCandidate>();
    for (const game of orderedGames) {
      for (const player of teamOf(game).players) {
        const entry = candidates.get(player.playerId) ?? {
          playerId: player.playerId,
          points: 0,
          rebounds: 0,
          assists: 0,
          games: 0,
        };
        entry.points += player.points;
        entry.rebounds += player.rebounds.total;
        entry.assists += player.assists;
        entry.games += 1;
        candidates.set(player.playerId, entry);
      }
    }
    return candidates;
  }

  function topLeader(
    candidates: Map<string, LeaderCandidate>,
    key: 'points' | 'rebounds' | 'assists',
  ): Leader | null {
    let best: LeaderCandidate | null = null;
    for (const candidate of candidates.values()) {
      if (
        best === null ||
        candidate[key] > best[key] ||
        (candidate[key] === best[key] && candidate.playerId < best.playerId)
      ) {
        best = candidate;
      }
    }
    if (best === null) return null;
    return {
      playerId: best.playerId,
      name: nameOf(best.playerId),
      total: best[key],
      perGame: perGameText(best[key], best.games),
    };
  }

  const leaders = $derived.by((): { local: SideLeaders; opponent: SideLeaders } => {
    const local = collectLeaders(localTeamOf);
    const opponent = collectLeaders(opponentTeamOf);
    return {
      local: {
        points: topLeader(local, 'points'),
        rebounds: topLeader(local, 'rebounds'),
        assists: topLeader(local, 'assists'),
      },
      opponent: {
        points: topLeader(opponent, 'points'),
        rebounds: topLeader(opponent, 'rebounds'),
        assists: topLeader(opponent, 'assists'),
      },
    };
  });

  const leaderRows = [
    { key: 'points', label: 'Points', unit: 'PPG' },
    { key: 'rebounds', label: 'Rebounds', unit: 'RPG' },
    { key: 'assists', label: 'Assists', unit: 'APG' },
  ] as const;

  function collectPlayerStats(
    teamOf: (game: DraftDuelGameOutput) => TeamResult,
  ): PlayerAggregate[] {
    const byPlayerId = new Map<string, PlayerAggregate>();
    const order: string[] = [];
    for (const game of orderedGames) {
      const team = teamOf(game);
      for (const [slotIndex, player] of team.players.entries()) {
        let entry = byPlayerId.get(player.playerId);
        if (entry === undefined) {
          entry = {
            playerId: player.playerId,
            slotIndex,
            games: 0,
            minutes: 0,
            points: 0,
            rebounds: 0,
            assists: 0,
            steals: 0,
            blocks: 0,
            turnovers: 0,
            fieldGoalMakes: 0,
            fieldGoalAttempts: 0,
            threeMakes: 0,
            threeAttempts: 0,
            freeThrowMakes: 0,
            freeThrowAttempts: 0,
          };
          byPlayerId.set(player.playerId, entry);
          order.push(player.playerId);
        }
        entry.games += 1;
        entry.minutes += player.minutes;
        entry.points += player.points;
        entry.rebounds += player.rebounds.total;
        entry.assists += player.assists;
        entry.steals += player.steals;
        entry.blocks += player.blocks;
        entry.turnovers += player.turnovers;
        entry.fieldGoalMakes += player.fieldGoals.made;
        entry.fieldGoalAttempts += player.fieldGoals.attempted;
        entry.threeMakes += player.threes.made;
        entry.threeAttempts += player.threes.attempted;
        entry.freeThrowMakes += player.freeThrows.made;
        entry.freeThrowAttempts += player.freeThrows.attempted;
      }
    }
    return order
      .map((playerId) => byPlayerId.get(playerId))
      .filter((entry): entry is PlayerAggregate => entry !== undefined);
  }

  const playerStats = $derived.by(() => ({
    local: collectPlayerStats(localTeamOf),
    opponent: collectPlayerStats(opponentTeamOf),
  }));

  const statsRows = $derived(statsSide === 'you' ? playerStats.local : playerStats.opponent);
  const statsTeamUsage = $derived(
    statsRows.reduce(
      (total, row) =>
        total + usagePossessions(row.fieldGoalAttempts, row.freeThrowAttempts, row.turnovers),
      0,
    ),
  );

  function statValue(value: number, gamesPlayed: number): string {
    return statsTotals ? String(value) : (value / Math.max(1, gamesPlayed)).toFixed(1);
  }

  const statsColumns: readonly PlayerStatColumn<PlayerAggregate>[] = [
    { key: 'games', label: 'GP', value: (row) => row.games },
    {
      key: 'minutes',
      label: 'MIN',
      value: (row) => statValue(row.minutes, row.games),
      hideBelow: 'sm',
    },
    {
      key: 'points',
      label: 'PTS',
      value: (row) => statValue(row.points, row.games),
      cellClass: 'ui-stats-value-strong',
    },
    { key: 'rebounds', label: 'REB', value: (row) => statValue(row.rebounds, row.games) },
    { key: 'assists', label: 'AST', value: (row) => statValue(row.assists, row.games) },
    {
      key: 'steals',
      label: 'STL',
      value: (row) => statValue(row.steals, row.games),
      hideBelow: 'sm',
    },
    {
      key: 'blocks',
      label: 'BLK',
      value: (row) => statValue(row.blocks, row.games),
      hideBelow: 'sm',
    },
    {
      key: 'turnovers',
      label: 'TOV',
      value: (row) => statValue(row.turnovers, row.games),
      hideBelow: 'sm',
    },
    {
      key: 'fieldGoalPct',
      label: 'FG',
      value: (row) => ratioPct(row.fieldGoalMakes, row.fieldGoalAttempts),
    },
    {
      key: 'threePointPct',
      label: '3P',
      value: (row) => ratioPct(row.threeMakes, row.threeAttempts),
    },
    {
      key: 'freeThrowPct',
      label: 'FT',
      value: (row) => ratioPct(row.freeThrowMakes, row.freeThrowAttempts),
      hideBelow: 'sm',
    },
    {
      key: 'trueShootingPct',
      label: 'TS%',
      value: (row) => trueShootingPct(row.points, row.fieldGoalAttempts, row.freeThrowAttempts),
    },
    {
      key: 'usagePct',
      label: 'USG%',
      value: (row) =>
        usagePct(
          usagePossessions(row.fieldGoalAttempts, row.freeThrowAttempts, row.turnovers),
          statsTeamUsage,
        ),
    },
  ];

  const recap = $derived.by((): RecapGame[] => {
    const byGame = new Map<number, DraftDuelStandout[]>();
    for (const standout of standouts) {
      const list = byGame.get(standout.gameNumber) ?? [];
      list.push(standout);
      byGame.set(standout.gameNumber, list);
    }
    let localRunning = 0;
    let opponentRunning = 0;
    return orderedGames.map((game) => {
      const localTeam = localTeamOf(game);
      const opponentTeam = opponentTeamOf(game);
      const localWon =
        game.result.winner === (game.homeParticipantId === localParticipantId ? 'home' : 'away');
      if (localWon) localRunning += 1;
      else opponentRunning += 1;
      return {
        gameNumber: game.gameNumber,
        localScore: localTeam.box.points,
        opponentScore: opponentTeam.box.points,
        localWon,
        margin: localTeam.box.points - opponentTeam.box.points,
        overtime: game.result.overtimePeriods > 0,
        record: `${String(localRunning)}–${String(opponentRunning)}`,
        standouts: byGame.get(game.gameNumber) ?? [],
      };
    });
  });

  function standoutText(standout: DraftDuelStandout): string {
    const side = standout.participantId === localParticipantId ? 'You' : 'Opp';
    return `${standout.displayName} (${side}) · ${String(standout.points)} pts · ${String(
      standout.rebounds,
    )} reb · ${String(standout.assists)} ast`;
  }

  const recapRows = $derived<SeriesRecapGame[]>(
    recap.map((game) => ({
      gameNumber: game.gameNumber,
      won: game.localWon,
      score: `${String(game.localScore)}–${String(game.opponentScore)}`,
      overtime: game.overtime,
      standout: game.standouts.map(standoutText).join(' · '),
      note: `${
        game.localWon ? `Won by ${String(game.margin)}` : `Lost by ${String(-game.margin)}`
      } · Series ${game.record}`,
    })),
  );

  const mvpIsLocal = $derived(mvp !== null && mvp.participantId === localParticipantId);
  const mvpLine = $derived(
    mvp === null
      ? null
      : {
          games: mvp.games,
          ppg: perGameText(mvp.points, mvp.games),
          rpg: perGameText(mvp.rebounds, mvp.games),
          apg: perGameText(mvp.assists, mvp.games),
          points: mvp.points,
          rebounds: mvp.rebounds,
          assists: mvp.assists,
          gameScore: mvp.gameScoreSum.toFixed(1),
        },
  );
  const mvpStats = $derived(
    mvpLine === null
      ? []
      : [
          { label: 'PPG', value: mvpLine.ppg },
          { label: 'RPG', value: mvpLine.rpg },
          { label: 'APG', value: mvpLine.apg },
        ],
  );
  const mvpEmptyCopy = $derived(
    seriesDecided
      ? 'The series MVP is not available on this device.'
      : 'Series MVP will be recorded once the games are complete.',
  );
  const recapEmptyCopy = $derived(
    seriesDecided || series.games.length > 0
      ? 'The series box scores are not available on this device.'
      : 'No completed games to recap yet.',
  );
</script>

{#snippet rematchFooter()}
  <Panel as="section" padding="sm" aria-label="Rematch">
    <div class="rematch-row">
      <ActionRow>
        {#snippet primary()}
          {#if onlobby}
            <Button tone="primary" onclick={onlobby}>Back to lobby</Button>
          {:else if rematchConfirmed}
            <p class="rematch-state" data-state="confirmed">
              Rematch confirmed — the new series is being prepared.
            </p>
          {:else if rematchRequested}
            <p class="rematch-state" data-state="requested">Your opponent requested a rematch.</p>
          {:else if localRematchRequested}
            <p class="rematch-state" data-state="waiting" role="status">
              Waiting for your opponent to accept the rematch.
            </p>
          {:else}
            <p class="rematch-state" data-state="idle">Run it back?</p>
          {/if}
        {/snippet}
        {#snippet secondary()}
          {#if !onlobby && !rematchConfirmed && rematchRequested}
            <Button tone="primary" disabled={rematchBusy} onclick={onconfirmrematch}>
              {rematchBusy ? 'Preparing rematch…' : 'Confirm rematch'}
            </Button>
          {:else if !onlobby && !rematchConfirmed && !rematchRequested && !localRematchRequested}
            <Button tone="primary" disabled={rematchBusy} onclick={onrematch}>
              <Repeat size={15} aria-hidden="true" />
              {rematchBusy ? 'Requesting rematch…' : 'Request rematch'}
            </Button>
          {/if}
        {/snippet}
      </ActionRow>
    </div>
  </Panel>
{/snippet}

<ResultScreen
  aria-label="Series results and champion"
  eyebrow="Series complete"
  {title}
  footer={showRematch ? rematchFooter : null}
>
  {#snippet hero()}
    <ResultHero
      score={`${String(localWins)}–${String(opponentWins)}`}
      scoreLabel={`Series score you ${String(localWins)} to ${String(opponentWins)}`}
      tone={heroTone}
      meta={heroMeta}
      data-champion={championState}
    />
  {/snippet}

  <div class="result-grid">
    <div class="mvp-column">
      <MvpCard
        aria-label="Series MVP"
        label="Series MVP"
        name={mvp?.displayName ?? null}
        team={mvp === null ? null : mvpIsLocal ? 'Your roster' : 'Opponent roster'}
        slot={mvpLine === null ? null : `${String(mvpLine.games)} games`}
        stats={mvpStats}
        emptyCopy={mvpEmptyCopy}
      >
        {#snippet portrait()}
          {#if mvp !== null}
            {#if manifest && cards[mvp.playerId]?.playerExternalId}
              <PlayerFace
                player={faceOf(mvp.playerId)}
                {manifest}
                size="md"
                fallbackInitials={initialsOf(mvp.displayName)}
              />
            {:else}
              <span class="player-fallback">{initialsOf(mvp.displayName)}</span>
            {/if}
          {/if}
        {/snippet}
      </MvpCard>
      {#if mvp !== null && mvpLine !== null}
        <p class="mvp-totals">
          Totals: {mvpLine.points} pts · {mvpLine.rebounds} reb · {mvpLine.assists} ast · series game
          score {mvpLine.gameScore}
        </p>
      {/if}
    </div>

    <Panel as="section" padding="md" aria-label="Series comparison">
      <SectionHeading level={3} size="sm" align="start" title="Series comparison" />
      {#if hasBoxScores}
        <ComparisonTable
          class="mt-3"
          rows={comparisonRows}
          rightLabel="Opp"
          aria-label="Per-game team averages for the series"
        />
        <p class="panel-note">
          {comparison.local.games} game{comparison.local.games === 1 ? '' : 's'} · per-game averages
        </p>
      {:else}
        <EmptyState
          class="mt-3"
          title="Box scores are not available on this device."
          surface="none"
        />
      {/if}
    </Panel>
  </div>

  <Panel as="section" padding="md" aria-label="Series leaders">
    <SectionHeading level={3} size="sm" align="start" title="Series leaders" />
    {#if hasBoxScores}
      <div class="table-scroll mt-3">
        <table class="leaders-table">
          <caption class="sr-only">Series leaders for both rosters</caption>
          <thead>
            <tr>
              <th scope="col">Stat</th>
              <th scope="col">Your five</th>
              <th scope="col">Opponent five</th>
            </tr>
          </thead>
          <tbody>
            {#each leaderRows as row (row.key)}
              <tr>
                <th scope="row">{row.label}</th>
                {#each [leaders.local[row.key], leaders.opponent[row.key]] as leader, index (row.key + String(index))}
                  <td>
                    {#if leader}
                      <span class="leader-cell">
                        {#if manifest && cards[leader.playerId]?.playerExternalId}
                          <PlayerFace
                            player={faceOf(leader.playerId)}
                            {manifest}
                            size="sm"
                            fallbackInitials={initialsOf(leader.name)}
                          />
                        {:else}
                          <span class="player-fallback sm">{initialsOf(leader.name)}</span>
                        {/if}
                        <span class="leader-text">
                          <span class="leader-name">{leader.name}</span>
                          <span class="leader-value"
                            >{leader.perGame} <span class="leader-unit">{row.unit}</span></span
                          >
                        </span>
                      </span>
                    {:else}
                      <span class="leader-empty">—</span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <EmptyState
        class="mt-3"
        title="Box scores are not available on this device."
        surface="none"
      />
    {/if}
  </Panel>

  <PlayerStatsSection
    ariaLabel="Series player stats"
    title="Series player stats"
    sideOptions={statsSideOptions}
    side={statsSide}
    onsidechange={(next) => (statsSide = next)}
    values={statsTotals ? 'totals' : 'game'}
    onvalueschange={(next) => (statsTotals = next === 'totals')}
    rows={hasBoxScores ? statsRows : null}
    columns={statsColumns}
    rowKey={(row) => row.playerId}
    caption={`${statsSide === 'you' ? 'Your five' : 'Opponent five'} series stats`}
    note={`${statsTotals ? 'Series totals' : 'Per-game averages'} · ${statsRows.length} players`}
  >
    {#snippet identity(row)}
      <span class="ui-stats-player">
        {#if manifest && cards[row.playerId]?.playerExternalId}
          <PlayerFace
            player={faceOf(row.playerId)}
            {manifest}
            size="sm"
            fallbackInitials={initialsOf(nameOf(row.playerId))}
          />
        {:else}
          <span class="ui-stats-player-fallback">{initialsOf(nameOf(row.playerId))}</span>
        {/if}
        <span class="ui-stats-player-text">
          <span class="ui-stats-player-name">{nameOf(row.playerId)}</span>
          <span class="ui-stats-player-meta">{SLOT_LABELS[row.slotIndex] ?? ''}</span>
        </span>
      </span>
    {/snippet}
    {#snippet empty()}
      <p class="ui-stats-empty">Box scores are not available on this device.</p>
    {/snippet}
  </PlayerStatsSection>

  <Panel as="section" padding="md" aria-label="Game recaps">
    <SectionHeading level={3} size="sm" align="start" title="Game recaps" />
    {#if recapRows.length > 0}
      <SeriesRecap class="mt-3" games={recapRows} label="Game recaps" />
    {:else}
      <EmptyState class="mt-3" title={recapEmptyCopy} surface="none" />
    {/if}
  </Panel>
</ResultScreen>

<style>
  .result-grid {
    display: grid;
    min-width: 0;
    gap: 1rem;
  }

  .mvp-column {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: 0.4rem;
  }

  .mvp-totals {
    margin: 0;
    padding: 0 0.25rem;
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--color-muted-foreground);
  }

  .player-fallback {
    display: grid;
    width: 3rem;
    height: 3rem;
    flex: none;
    place-items: center;
    border-radius: 0.55rem;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-family: var(--font-display);
    font-size: 0.85rem;
    font-weight: 800;
  }

  .player-fallback.sm {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.45rem;
    font-size: 0.68rem;
  }

  .panel-note {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--color-muted-foreground);
  }

  .table-scroll {
    overflow-x: auto;
  }

  .leaders-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .leaders-table thead th {
    padding: 0 0.35rem 0.45rem;
    border-bottom: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-align: left;
    text-transform: uppercase;
  }

  .leaders-table thead th:last-child {
    text-align: right;
  }

  .leaders-table tbody tr {
    border-bottom: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  .leaders-table tbody tr:last-child {
    border-bottom: 0;
  }

  .leaders-table tbody th {
    width: 6.5rem;
    padding: 0.45rem 0.35rem;
    color: var(--color-muted-foreground);
    font-weight: 600;
    text-align: left;
  }

  .leaders-table tbody td {
    padding: 0.45rem 0.35rem;
    vertical-align: middle;
  }

  .leader-cell {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }

  .leader-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.05rem;
  }

  .leader-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leader-value {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--color-foreground);
  }

  .leader-unit {
    color: var(--color-muted-foreground);
    font-weight: 400;
  }

  .leader-empty {
    color: var(--color-muted-foreground);
  }

  .rematch-row :global(.ui-actions) {
    justify-content: space-between;
  }

  .rematch-state {
    margin: 0;
    font-size: 0.84rem;
    font-weight: 600;
  }

  .rematch-state[data-state='confirmed'] {
    color: var(--color-positive);
  }

  @media (min-width: 900px) {
    .result-grid {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      align-items: stretch;
    }
  }

  @media (max-width: 640px) {
    .rematch-row :global(.ui-actions) {
      flex-direction: column;
      align-items: stretch;
      text-align: center;
    }

    .rematch-state {
      font-size: 0.8rem;
      text-wrap: balance;
    }
  }
</style>
