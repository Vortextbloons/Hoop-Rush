<script lang="ts">
  import { Repeat, Trophy } from '@lucide/svelte';
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
  import { SLOT_LABELS } from '#lib/player-positions.js';
  import { perGameText, ratioPct } from '#lib/format.js';

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

  const orderedGames = $derived([...games].sort((a, b) => a.gameNumber - b.gameNumber));
  const localWins = $derived(localParticipantId === 'p1' ? series.p1Wins : series.p2Wins);
  const opponentWins = $derived(localParticipantId === 'p1' ? series.p2Wins : series.p1Wins);
  const championIsLocal = $derived(series.champion === localParticipantId);
  const seriesDecided = $derived(series.champion !== null);
  const hasBoxScores = $derived(orderedGames.length > 0);

  function nameOf(playerId: string): string {
    return cards[playerId]?.displayName ?? playerId.replace(/^p-/, '#').slice(0, 7);
  }

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
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
      for (const player of teamOf(game).players) {
        let entry = byPlayerId.get(player.playerId);
        if (entry === undefined) {
          entry = {
            playerId: player.playerId,
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

  function statValue(value: number, gamesPlayed: number): string {
    return statsTotals ? String(value) : (value / Math.max(1, gamesPlayed)).toFixed(1);
  }

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

<section class="championship" aria-label="Series results and champion">
  <header
    class="hero"
    data-champion={championIsLocal ? 'local' : series.champion === null ? 'pending' : 'opponent'}
  >
    <span class="hero-icon" aria-hidden="true"><Trophy size={28} /></span>
    <p class="hero-eyebrow">Series complete</p>
    <h2>
      {#if series.champion === null}
        Series in progress
      {:else if championIsLocal}
        You are the champion
      {:else}
        Opponent takes the series
      {/if}
    </h2>
    <p
      class="hero-score"
      aria-label={`Series score you ${String(localWins)} to ${String(opponentWins)}`}
    >
      <span>{localWins}</span><span class="hero-dash" aria-hidden="true">–</span><span
        >{opponentWins}</span
      >
    </p>
    <p class="hero-sub">
      {localWins > opponentWins ? 'You win' : localWins < opponentWins ? 'Opponent wins' : 'Tied'}
      the best-of-seven · first to four.
    </p>
  </header>

  <div class="top-grid">
    <section class="mvp" aria-label="Series MVP">
      <h3>Series MVP</h3>
      {#if mvp !== null && mvpLine !== null}
        <div class="mvp-body">
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
          <div class="mvp-identity">
            <p class="mvp-name">{mvp.displayName}</p>
            <p class="mvp-team">
              {mvpIsLocal ? 'Your roster' : 'Opponent roster'} · {mvpLine.games} games
            </p>
          </div>
        </div>
        <dl class="mvp-stats">
          <div>
            <dt>PPG</dt>
            <dd>{mvpLine.ppg}</dd>
          </div>
          <div>
            <dt>RPG</dt>
            <dd>{mvpLine.rpg}</dd>
          </div>
          <div>
            <dt>APG</dt>
            <dd>{mvpLine.apg}</dd>
          </div>
        </dl>
        <p class="mvp-totals">
          Totals: {mvpLine.points} pts · {mvpLine.rebounds} reb · {mvpLine.assists} ast · series game
          score {mvpLine.gameScore}
        </p>
      {:else}
        <p class="mvp-empty">{mvpEmptyCopy}</p>
      {/if}
    </section>

    <section class="comparison" aria-label="Series comparison">
      <h3>Series comparison</h3>
      {#if hasBoxScores}
        <table class="comparison-table">
          <caption class="sr-only">Per-game team averages for the series</caption>
          <thead>
            <tr>
              <th scope="col">You</th>
              <th scope="col">Stat</th>
              <th scope="col">Opp</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{perGameText(comparison.local.points, comparison.local.games)}</td>
              <th scope="row">Points per game</th>
              <td>{perGameText(comparison.opponent.points, comparison.opponent.games)}</td>
            </tr>
            <tr>
              <td
                >{ratioPct(comparison.local.fieldGoalMakes, comparison.local.fieldGoalAttempts)}</td
              >
              <th scope="row">FG%</th>
              <td
                >{ratioPct(
                  comparison.opponent.fieldGoalMakes,
                  comparison.opponent.fieldGoalAttempts,
                )}</td
              >
            </tr>
            <tr>
              <td>{ratioPct(comparison.local.threeMakes, comparison.local.threeAttempts)}</td>
              <th scope="row">3P%</th>
              <td>{ratioPct(comparison.opponent.threeMakes, comparison.opponent.threeAttempts)}</td>
            </tr>
            <tr>
              <td>{perGameText(comparison.local.rebounds, comparison.local.games)}</td>
              <th scope="row">Rebounds per game</th>
              <td>{perGameText(comparison.opponent.rebounds, comparison.opponent.games)}</td>
            </tr>
            <tr>
              <td>{perGameText(comparison.local.assists, comparison.local.games)}</td>
              <th scope="row">Assists per game</th>
              <td>{perGameText(comparison.opponent.assists, comparison.opponent.games)}</td>
            </tr>
            <tr>
              <td>{perGameText(comparison.local.turnovers, comparison.local.games)}</td>
              <th scope="row">Turnovers per game</th>
              <td>{perGameText(comparison.opponent.turnovers, comparison.opponent.games)}</td>
            </tr>
          </tbody>
        </table>
        <p class="panel-note">
          {comparison.local.games} game{comparison.local.games === 1 ? '' : 's'} · per-game averages
        </p>
      {:else}
        <p class="mvp-empty">Box scores are not available on this device.</p>
      {/if}
    </section>
  </div>

  <section class="leaders" aria-label="Series leaders">
    <h3>Series leaders</h3>
    {#if hasBoxScores}
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
    {:else}
      <p class="mvp-empty">Box scores are not available on this device.</p>
    {/if}
  </section>

  <section class="player-stats" aria-label="Series player stats">
    <div class="stats-head">
      <h3>Series player stats</h3>
      {#if hasBoxScores}
        <div class="stats-controls">
          <div class="segmented" role="group" aria-label="Roster">
            <button
              type="button"
              aria-pressed={statsSide === 'you'}
              class:active={statsSide === 'you'}
              onclick={() => (statsSide = 'you')}>You</button
            >
            <button
              type="button"
              aria-pressed={statsSide === 'opp'}
              class:active={statsSide === 'opp'}
              onclick={() => (statsSide = 'opp')}>Opponent</button
            >
          </div>
          <div class="segmented" role="group" aria-label="Stat values">
            <button
              type="button"
              aria-pressed={!statsTotals}
              class:active={!statsTotals}
              onclick={() => (statsTotals = false)}>Per game</button
            >
            <button
              type="button"
              aria-pressed={statsTotals}
              class:active={statsTotals}
              onclick={() => (statsTotals = true)}>Totals</button
            >
          </div>
        </div>
      {/if}
    </div>
    {#if hasBoxScores}
      <div class="stats-scroll">
        <table class="stats-table">
          <caption class="sr-only"
            >{statsSide === 'you' ? 'Your five' : 'Opponent five'} series stats</caption
          >
          <thead>
            <tr>
              <th scope="col" class="is-player">Player</th>
              <th scope="col">GP</th>
              <th scope="col">MIN</th>
              <th scope="col">PTS</th>
              <th scope="col">REB</th>
              <th scope="col">AST</th>
              <th scope="col">STL</th>
              <th scope="col">BLK</th>
              <th scope="col">TOV</th>
              <th scope="col">FG</th>
              <th scope="col">3P</th>
              <th scope="col">FT</th>
            </tr>
          </thead>
          <tbody>
            {#each statsRows as row, slotIndex (row.playerId)}
              <tr>
                <th scope="row" class="is-player">
                  <span class="player-cell">
                    {#if manifest && cards[row.playerId]?.playerExternalId}
                      <PlayerFace
                        player={faceOf(row.playerId)}
                        {manifest}
                        size="sm"
                        fallbackInitials={initialsOf(nameOf(row.playerId))}
                      />
                    {:else}
                      <span class="player-fallback sm">{initialsOf(nameOf(row.playerId))}</span>
                    {/if}
                    <span class="player-text">
                      <span class="player-name">{nameOf(row.playerId)}</span>
                      <span class="player-pos">{SLOT_LABELS[slotIndex] ?? ''}</span>
                    </span>
                  </span>
                </th>
                <td>{row.games}</td>
                <td>{statValue(row.minutes, row.games)}</td>
                <td class="is-points">{statValue(row.points, row.games)}</td>
                <td>{statValue(row.rebounds, row.games)}</td>
                <td>{statValue(row.assists, row.games)}</td>
                <td>{statValue(row.steals, row.games)}</td>
                <td>{statValue(row.blocks, row.games)}</td>
                <td>{statValue(row.turnovers, row.games)}</td>
                <td>{ratioPct(row.fieldGoalMakes, row.fieldGoalAttempts)}</td>
                <td>{ratioPct(row.threeMakes, row.threeAttempts)}</td>
                <td>{ratioPct(row.freeThrowMakes, row.freeThrowAttempts)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="panel-note">
        {statsTotals ? 'Series totals' : 'Per-game averages'} · {statsRows.length} players
      </p>
    {:else}
      <p class="mvp-empty">Box scores are not available on this device.</p>
    {/if}
  </section>

  <section class="recap" aria-label="Game recaps">
    <h3>Game recaps</h3>
    {#if recap.length > 0}
      <ol class="recap-list">
        {#each recap as game (game.gameNumber)}
          <li class="recap-game" data-result={game.localWon ? 'win' : 'loss'}>
            <div class="recap-head">
              <span class="recap-label">Game {game.gameNumber}</span>
              <span class="recap-tags">
                {#if game.overtime}
                  <span class="recap-ot">OT</span>
                {/if}
                <span class="recap-result">{game.localWon ? 'W' : 'L'}</span>
              </span>
            </div>
            <p class="recap-score">
              <span>{game.localScore}</span><span class="recap-dash" aria-hidden="true">–</span
              ><span>{game.opponentScore}</span>
            </p>
            <p class="recap-record">
              {game.localWon ? `Won by ${String(game.margin)}` : `Lost by ${String(-game.margin)}`} ·
              Series {game.record}
            </p>
            {#each game.standouts as standout (standout.playerId)}
              <p class="recap-standout">
                <strong>{standout.displayName}</strong>
                ({standout.participantId === localParticipantId ? 'You' : 'Opp'}) ·
                {standout.points} pts · {standout.rebounds} reb · {standout.assists} ast
              </p>
            {/each}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="recap-empty">{recapEmptyCopy}</p>
    {/if}
  </section>

  {#if showRematch}<section class="rematch" aria-label="Rematch">
      {#if onlobby}
        <button type="button" class="rematch-btn" onclick={onlobby}>Back to lobby</button>
      {:else if rematchConfirmed}
        <p class="rematch-state" data-state="confirmed">
          Rematch confirmed — the new series is being prepared.
        </p>
      {:else if rematchRequested}
        <p class="rematch-state" data-state="requested">Your opponent requested a rematch.</p>
        <button type="button" class="rematch-btn" disabled={rematchBusy} onclick={onconfirmrematch}>
          {rematchBusy ? 'Preparing rematch…' : 'Confirm rematch'}
        </button>
      {:else if localRematchRequested}
        <p class="rematch-state" data-state="waiting" role="status">
          Waiting for your opponent to accept the rematch.
        </p>
      {:else}
        <p class="rematch-state" data-state="idle">Run it back?</p>
        <button type="button" class="rematch-btn" disabled={rematchBusy} onclick={onrematch}>
          <Repeat size={15} aria-hidden="true" />
          {rematchBusy ? 'Requesting rematch…' : 'Request rematch'}
        </button>
      {/if}
    </section>{/if}
</section>

<style>
  .championship {
    display: grid;
    gap: 0.85rem;
    min-width: 0;
  }

  .hero {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    padding: 1.4rem 1rem 1.2rem;
    overflow: clip;
    border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-line-soft));
    border-radius: var(--radius);
    text-align: center;
    background:
      radial-gradient(
        80% 90% at 50% -20%,
        color-mix(in srgb, var(--color-primary) 16%, transparent),
        transparent 70%
      ),
      var(--color-surface-1);
  }

  .hero[data-champion='opponent'] {
    border-color: var(--color-line-strong);
    background:
      radial-gradient(
        80% 90% at 50% -20%,
        color-mix(in srgb, #8bc9e0 12%, transparent),
        transparent 70%
      ),
      var(--color-surface-1);
  }

  .hero-icon {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
    border-radius: 999px;
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  }

  .hero-eyebrow {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
  }

  .hero h2 {
    margin: 0.1rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(1.9rem, 8vw, 2.8rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }

  .hero-score {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    margin: 0.25rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 12vw, 3.4rem);
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .hero-dash {
    color: var(--color-muted-foreground);
    font-size: 0.55em;
  }

  .hero-sub {
    margin: 0.1rem 0 0;
    font-size: 0.78rem;
    color: var(--color-muted-foreground);
  }

  .top-grid {
    display: grid;
    gap: 0.85rem;
  }

  @media (min-width: 900px) {
    .top-grid {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      align-items: stretch;
    }
  }

  .mvp,
  .comparison,
  .leaders,
  .player-stats,
  .recap,
  .rematch {
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
    min-width: 0;
  }

  .comparison,
  .leaders {
    min-width: 0;
  }

  h3 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--color-primary);
    text-transform: uppercase;
  }

  .mvp-body {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-top: 0.6rem;
  }

  .mvp-identity {
    min-width: 0;
    flex: 1;
  }

  .mvp-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 800;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }

  .mvp-team {
    margin: 0.15rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.66rem;
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

  .mvp-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    max-width: 20rem;
    margin: 0.7rem 0 0;
  }

  .mvp-stats div {
    padding: 0.45rem 0.3rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.5rem;
    text-align: center;
    background: var(--color-surface-2);
  }

  .mvp-stats dt {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    letter-spacing: 0.12em;
    color: var(--color-muted-foreground);
  }

  .mvp-stats dd {
    margin: 0.15rem 0 0;
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .mvp-totals {
    margin: 0.55rem 0 0;
    font-size: 0.72rem;
    color: var(--color-muted-foreground);
  }

  .mvp-empty,
  .recap-empty {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--color-muted-foreground);
  }

  .comparison-table,
  .leaders-table {
    width: 100%;
    margin-top: 0.55rem;
    border-collapse: collapse;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .comparison-table thead th,
  .leaders-table thead th {
    padding: 0 0.3rem 0.4rem;
    border-bottom: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .comparison-table thead th:first-child,
  .leaders-table thead th:first-child {
    text-align: left;
  }

  .comparison-table thead th:last-child,
  .leaders-table thead th:last-child {
    text-align: right;
  }

  .comparison-table tbody tr,
  .leaders-table tbody tr {
    border-bottom: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  .comparison-table tbody tr:last-child,
  .leaders-table tbody tr:last-child {
    border-bottom: 0;
  }

  .comparison-table tbody th,
  .leaders-table tbody th {
    padding: 0.42rem 0.3rem;
    font-weight: 600;
    text-align: center;
    color: var(--color-muted-foreground);
  }

  .comparison-table tbody td {
    padding: 0.42rem 0.3rem;
    font-weight: 700;
  }

  .comparison-table tbody td:first-child {
    text-align: left;
  }

  .comparison-table tbody td:last-child {
    text-align: right;
  }

  .leaders-table tbody th {
    width: 6.5rem;
    text-align: left;
  }

  .leaders-table tbody td {
    padding: 0.4rem 0.3rem;
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

  .panel-note {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--color-muted-foreground);
  }

  .stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
  }

  .stats-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .segmented {
    display: inline-flex;
    padding: 0.12rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.5rem;
    background: var(--color-surface-2);
  }

  .segmented button {
    padding: 0.22rem 0.55rem;
    border-radius: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
    cursor: pointer;
    outline: none;
  }

  .segmented button.active {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }

  .segmented button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .stats-scroll {
    margin-top: 0.55rem;
    overflow-x: auto;
  }

  .stats-table {
    width: 100%;
    min-width: 38rem;
    border-collapse: collapse;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .stats-table th,
  .stats-table td {
    padding: 0.32rem 0.42rem;
    text-align: right;
  }

  .stats-table thead th {
    border-bottom: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .stats-table tbody tr {
    border-top: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  .stats-table tbody tr:first-child {
    border-top: 0;
  }

  .stats-table .is-player {
    width: 100%;
    max-width: 11rem;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }

  .stats-table tbody th.is-player {
    font-weight: 600;
  }

  .stats-table .is-points {
    color: var(--color-foreground);
    font-weight: 800;
  }

  .player-cell {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
  }

  .player-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.05rem;
  }

  .player-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 0.88rem;
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-pos {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .recap-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.6rem;
    margin: 0.6rem 0 0;
    padding: 0;
    list-style: none;
  }

  .recap-game {
    min-width: 0;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--color-line-soft);
    border-left: 3px solid var(--color-line-strong);
    border-radius: 0.6rem;
    background: var(--color-surface-2);
  }

  .recap-game[data-result='win'] {
    border-left-color: var(--color-positive);
  }

  .recap-game[data-result='loss'] {
    border-left-color: var(--color-destructive);
  }

  .recap-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .recap-label {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
  }

  .recap-tags {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
  }

  .recap-ot {
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--color-line-strong);
    border-radius: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--color-muted-foreground);
  }

  .recap-result {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .recap-game[data-result='win'] .recap-result {
    color: var(--color-positive);
  }

  .recap-game[data-result='loss'] .recap-result {
    color: var(--color-destructive);
  }

  .recap-score {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    margin: 0.25rem 0 0;
    font-family: var(--font-display);
    font-size: 1.7rem;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .recap-dash {
    color: var(--color-muted-foreground);
    font-size: 0.6em;
  }

  .recap-record {
    margin: 0.2rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--color-muted-foreground);
  }

  .recap-standout {
    margin: 0.4rem 0 0;
    padding-top: 0.4rem;
    border-top: 1px solid color-mix(in srgb, var(--color-line-soft) 60%, transparent);
    font-size: 0.72rem;
    color: var(--color-muted-foreground);
  }

  .recap-standout strong {
    color: var(--color-foreground);
  }

  .rematch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1rem;
  }

  .rematch-state {
    margin: 0;
    font-size: 0.84rem;
    font-weight: 600;
  }

  .rematch-state[data-state='confirmed'] {
    color: var(--color-positive);
  }

  .rematch-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 65%, transparent);
    border-radius: 0.55rem;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    outline: none;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  @media (hover: hover) {
    .rematch-btn:hover {
      filter: brightness(1.08);
    }
  }

  .rematch-btn:active:not(:disabled) {
    transform: scale(0.99);
  }

  .rematch-btn:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  @media (max-width: 640px) {
    .championship {
      gap: 0.7rem;
    }
    .hero {
      gap: 0.2rem;
      padding: 1.1rem 0.85rem 1rem;
    }
    .hero-icon {
      width: 2.5rem;
      height: 2.5rem;
    }
    .hero h2 {
      font-size: clamp(1.45rem, 7vw, 2rem);
      text-wrap: balance;
    }
    .hero-score {
      font-size: clamp(2rem, 11vw, 2.8rem);
      gap: 0.55rem;
    }
    .hero-sub {
      max-width: 26rem;
      font-size: 0.75rem;
      line-height: 1.5;
      text-wrap: balance;
    }
    .mvp,
    .comparison,
    .leaders,
    .player-stats,
    .recap,
    .rematch {
      padding: 0.7rem 0.75rem;
      border-radius: 0.65rem;
    }
    .mvp-body {
      gap: 0.6rem;
    }
    .mvp-name {
      font-size: 1.22rem;
    }
    .mvp-team {
      font-size: 0.62rem;
    }
    .mvp-stats {
      gap: 0.4rem;
      max-width: none;
    }
    .mvp-stats div {
      padding: 0.4rem 0.25rem;
    }
    .mvp-stats dd {
      font-size: 1.15rem;
    }
    .mvp-totals {
      font-size: 0.7rem;
      line-height: 1.55;
    }
    .comparison-table {
      font-size: 0.72rem;
    }
    .comparison-table tbody th,
    .comparison-table tbody td {
      padding: 0.36rem 0.25rem;
      line-height: 1.35;
    }
    .leaders-table {
      display: block;
      margin-top: 0.5rem;
    }
    .leaders-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .leaders-table tbody {
      display: grid;
      gap: 0.55rem;
    }
    .leaders-table tbody tr {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.4rem;
      border-bottom: 0;
      padding: 0;
    }
    .leaders-table tbody th {
      grid-column: 1 / -1;
      width: auto;
      padding: 0;
      font-family: var(--font-mono);
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-align: left;
    }
    .leaders-table tbody td {
      min-width: 0;
      padding: 0;
    }
    .leader-cell {
      gap: 0.45rem;
      padding: 0.45rem 0.5rem;
      border: 1px solid var(--color-line-soft);
      border-radius: 0.55rem;
      background: var(--color-surface-2);
    }
    .leader-name {
      font-size: 0.8rem;
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }
    .leader-value {
      font-size: 0.64rem;
    }
    .stats-head {
      align-items: stretch;
      flex-direction: column;
    }
    .stats-controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
    }
    .segmented {
      min-width: 0;
    }
    .segmented button {
      flex: 1;
      min-height: 2.25rem;
      min-width: 0;
      padding: 0.35rem 0.4rem;
      font-size: 0.6rem;
      touch-action: manipulation;
    }
    .stats-scroll {
      margin-inline: -0.25rem;
      padding-inline: 0.25rem;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
    }
    .stats-table {
      min-width: 0;
      font-size: 0.68rem;
    }
    .stats-table th,
    .stats-table td {
      padding: 0.28rem 0.3rem;
    }
    .stats-table th:nth-child(3),
    .stats-table td:nth-child(3),
    .stats-table th:nth-child(7),
    .stats-table td:nth-child(7),
    .stats-table th:nth-child(8),
    .stats-table td:nth-child(8),
    .stats-table th:nth-child(9),
    .stats-table td:nth-child(9),
    .stats-table th:nth-child(12),
    .stats-table td:nth-child(12) {
      display: none;
    }
    .stats-table .is-player {
      max-width: 8.5rem;
    }
    .player-cell {
      gap: 0.4rem;
    }
    .player-name {
      font-size: 0.8rem;
    }
    .recap-list {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    .recap-score {
      font-size: 1.5rem;
    }
    .recap-standout {
      font-size: 0.7rem;
      line-height: 1.5;
    }
    .rematch {
      flex-direction: column;
      align-items: stretch;
      text-align: center;
    }
    .rematch-state {
      font-size: 0.8rem;
      text-wrap: balance;
    }
    .rematch-btn {
      width: 100%;
      min-height: 3rem;
      justify-content: center;
      font-size: 0.85rem;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
  }

  @media (max-width: 380px) {
    .mvp-name {
      font-size: 1.08rem;
    }
    .mvp-stats dd {
      font-size: 1.05rem;
    }
    .leader-cell {
      padding: 0.4rem;
    }
    .stats-controls {
      grid-template-columns: 1fr;
    }
  }
</style>
