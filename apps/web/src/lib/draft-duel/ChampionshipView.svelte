<script lang="ts">
  import { Repeat, Trophy } from '@lucide/svelte';
  import type {
    DraftDuelGameOutput,
    DraftDuelParticipantId,
    DraftDuelSeriesMvp,
    DraftDuelSeriesSnapshot,
    DraftDuelStandout,
  } from '@hoop-rush/data-contracts';

  let {
    series,
    mvp,
    standouts,
    localParticipantId,
    games,
    rematchRequested,
    rematchConfirmed,
    onrematch,
    onconfirmrematch,
  }: {
    series: DraftDuelSeriesSnapshot;
    mvp: DraftDuelSeriesMvp | null;
    standouts: DraftDuelStandout[];
    localParticipantId: DraftDuelParticipantId;
    games: DraftDuelGameOutput[];
    rematchRequested: boolean;
    rematchConfirmed: boolean;
    onrematch: () => void;
    onconfirmrematch: () => void;
  } = $props();

  interface RecapGame {
    gameNumber: number;
    localScore: number;
    opponentScore: number;
    localWon: boolean;
    record: string;
    standouts: DraftDuelStandout[];
  }

  function perGame(total: number, gamesPlayed: number): string {
    return (total / Math.max(1, gamesPlayed)).toFixed(1);
  }

  const localWins = $derived(localParticipantId === 'p1' ? series.p1Wins : series.p2Wins);
  const opponentWins = $derived(localParticipantId === 'p1' ? series.p2Wins : series.p1Wins);
  const championIsLocal = $derived(series.champion === localParticipantId);

  const recap = $derived.by((): RecapGame[] => {
    const byGame = new Map<number, DraftDuelStandout[]>();
    for (const standout of standouts) {
      const list = byGame.get(standout.gameNumber) ?? [];
      list.push(standout);
      byGame.set(standout.gameNumber, list);
    }
    let localRunning = 0;
    let opponentRunning = 0;
    return [...games]
      .sort((a, b) => a.gameNumber - b.gameNumber)
      .map((game) => {
        const localIsHome = game.homeParticipantId === localParticipantId;
        const localScore = localIsHome ? game.result.home.box.points : game.result.away.box.points;
        const opponentScore = localIsHome
          ? game.result.away.box.points
          : game.result.home.box.points;
        const localWon = (game.result.winner === 'home') === localIsHome;
        if (localWon) localRunning += 1;
        else opponentRunning += 1;
        return {
          gameNumber: game.gameNumber,
          localScore,
          opponentScore,
          localWon,
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
          ppg: perGame(mvp.points, mvp.games),
          rpg: perGame(mvp.rebounds, mvp.games),
          apg: perGame(mvp.assists, mvp.games),
          points: mvp.points,
          rebounds: mvp.rebounds,
          assists: mvp.assists,
          gameScore: mvp.gameScoreSum.toFixed(1),
        },
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

  <section class="mvp" aria-label="Series MVP">
    <h3>Series MVP</h3>
    {#if mvp !== null && mvpLine !== null}
      <p class="mvp-name">{mvp.displayName}</p>
      <p class="mvp-team">
        {mvpIsLocal ? 'Your roster' : 'Opponent roster'} · {mvpLine.games} games
      </p>
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
        Totals: {mvpLine.points} pts · {mvpLine.rebounds} reb · {mvpLine.assists} ast · series game score
        {mvpLine.gameScore}
      </p>
    {:else}
      <p class="mvp-empty">Series MVP will be recorded once the games are complete.</p>
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
              <span class="recap-result">{game.localWon ? 'W' : 'L'}</span>
            </div>
            <p class="recap-score">
              <span>{game.localScore}</span><span class="recap-dash" aria-hidden="true">–</span
              ><span>{game.opponentScore}</span>
            </p>
            <p class="recap-record">Series {game.record}</p>
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
      <p class="recap-empty">No completed games to recap yet.</p>
    {/if}
  </section>

  <section class="rematch" aria-label="Rematch">
    {#if rematchConfirmed}
      <p class="rematch-state" data-state="confirmed">
        Rematch confirmed — the new series is being prepared.
      </p>
    {:else if rematchRequested}
      <p class="rematch-state" data-state="requested">
        Rematch requested — both players must confirm.
      </p>
      <button type="button" class="rematch-btn" onclick={onconfirmrematch}>
        Confirm rematch
      </button>
    {:else}
      <p class="rematch-state" data-state="idle">Run it back?</p>
      <button type="button" class="rematch-btn" onclick={onrematch}>
        <Repeat size={15} aria-hidden="true" />
        Request rematch
      </button>
    {/if}
  </section>
</section>

<style>
  .championship {
    display: grid;
    gap: 0.85rem;
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

  .mvp,
  .recap,
  .rematch {
    padding: 0.85rem 1rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
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

  .mvp-name {
    margin: 0.5rem 0 0;
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 800;
  }

  .mvp-team {
    margin: 0.1rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    color: var(--color-muted-foreground);
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
  }

  .rematch-btn:hover {
    filter: brightness(1.08);
  }

  .rematch-btn:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }
</style>
