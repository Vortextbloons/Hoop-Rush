<script lang="ts">
  import type {
    DraftDuelParticipantId,
    DraftDuelSeriesGame,
    DraftDuelSeriesSnapshot,
  } from '@hoop-rush/data-contracts';

  let {
    series,
    localParticipantId,
  }: {
    series: DraftDuelSeriesSnapshot;
    localParticipantId: DraftDuelParticipantId;
  } = $props();

  const HOME_GAME_NUMBERS: readonly number[] = [1, 2, 5, 7];

  function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
    return participantId === 'p1' ? 'p2' : 'p1';
  }

  function participantLabel(participantId: DraftDuelParticipantId): string {
    return participantId === localParticipantId ? 'You' : 'Opponent';
  }

  interface SeriesChip {
    gameNumber: number;
    homeParticipantId: DraftDuelParticipantId;
    played: DraftDuelSeriesGame | null;
    localIsHome: boolean;
    isCurrent: boolean;
    localWon: boolean;
  }

  const localWins = $derived(localParticipantId === 'p1' ? series.p1Wins : series.p2Wins);
  const opponentWins = $derived(localParticipantId === 'p1' ? series.p2Wins : series.p1Wins);
  const chips = $derived.by((): SeriesChip[] =>
    Array.from({ length: 7 }, (_, index) => {
      const gameNumber = index + 1;
      const homeParticipantId = HOME_GAME_NUMBERS.includes(gameNumber)
        ? series.homeWinner
        : otherParticipant(series.homeWinner);
      const played = series.games.find((game) => game.gameNumber === gameNumber) ?? null;
      return {
        gameNumber,
        homeParticipantId,
        played,
        localIsHome: homeParticipantId === localParticipantId,
        isCurrent: played === null && series.currentGameNumber === gameNumber,
        localWon: played !== null && played.winner === localParticipantId,
      };
    }),
  );

  const statusLine = $derived.by((): string => {
    const current = series.currentGameNumber;
    if (series.champion !== null) {
      return series.champion === localParticipantId
        ? 'You won the series.'
        : 'Opponent won the series.';
    }
    if (current === 7) return 'Game 7 — winner takes the series.';
    if (current !== null && (series.p1Wins === 3 || series.p2Wins === 3)) {
      const trailing = series.p1Wins === 3 ? 'p2' : 'p1';
      const trailingLabel = trailing === localParticipantId ? 'you' : 'the opponent';
      return `Elimination game — ${trailingLabel} must win Game ${String(current)}.`;
    }
    return 'First to four wins the series.';
  });

  function chipTitle(chip: SeriesChip): string {
    const away = otherParticipant(chip.homeParticipantId);
    const host = `${chip.homeParticipantId} hosts Game ${String(chip.gameNumber)} vs ${away}`;
    if (chip.played === null) return host;
    return `${host} · won by ${chip.played.winner}`;
  }
</script>

<section
  class="tracker"
  aria-label={`Series tracker, you ${String(localWins)} to ${String(opponentWins)}`}
>
  <header class="tracker-head">
    <div class="wins">
      <div class="wins-lane" data-side="local" data-leading={localWins > opponentWins}>
        <span class="wins-num">{localWins}</span>
        <span class="wins-label">You</span>
      </div>
      <span class="wins-dash" aria-hidden="true">–</span>
      <div class="wins-lane" data-side="opponent" data-leading={opponentWins > localWins}>
        <span class="wins-num">{opponentWins}</span>
        <span class="wins-label">Opp</span>
      </div>
    </div>
    <p class="status" role="status">{statusLine}</p>
  </header>

  <ol class="chips">
    {#each chips as chip (chip.gameNumber)}
      <li
        class="chip"
        data-state={chip.played !== null ? 'played' : chip.isCurrent ? 'current' : 'pending'}
        data-result={chip.played === null ? undefined : chip.localWon ? 'win' : 'loss'}
        data-court={chip.localIsHome ? 'home' : 'away'}
        title={chipTitle(chip)}
      >
        <span class="chip-game">G{chip.gameNumber}</span>
        <span class="chip-court">{chip.localIsHome ? 'Home' : 'Away'}</span>
        <span class="chip-result">
          {#if chip.played === null}
            {chip.isCurrent ? 'Next' : '—'}
          {:else}
            {chip.localWon ? 'W' : 'L'}
          {/if}
        </span>
        <span class="chip-host" aria-hidden="true">
          {participantLabel(chip.homeParticipantId)}
        </span>
      </li>
    {/each}
  </ol>

  <p class="court-note">
    2–2–1–1–1 format · {participantLabel(series.homeWinner)}
    {series.homeWinner === localParticipantId ? 'host' : 'hosts'} Games 1, 2, 5 and 7.
  </p>
</section>

<style>
  .tracker {
    display: grid;
    gap: 0.7rem;
    padding: 0.9rem 1rem 0.85rem;
    border: 1px solid var(--color-line-soft);
    border-radius: var(--radius);
    background: var(--color-surface-1);
  }

  .tracker-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem 1rem;
  }

  .wins {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
  }

  .wins-lane {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
  }

  .wins-lane[data-side='local'] .wins-num {
    color: var(--color-foreground);
  }

  .wins-lane[data-side='opponent'] .wins-num {
    color: var(--color-foreground);
  }

  .wins-lane[data-leading='true'] .wins-num {
    color: var(--color-primary);
  }

  .wins-num {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .wins-label {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
  }

  .wins-dash {
    color: var(--color-muted-foreground);
    font-weight: 700;
  }

  .status {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-muted-foreground);
  }

  .chips {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(3.55rem, 1fr));
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    display: grid;
    gap: 0.1rem;
    justify-items: center;
    padding: 0.45rem 0.25rem 0.4rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.55rem;
    background: var(--color-surface-2);
  }

  .chip[data-court='home'] {
    border-bottom: 2px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
  }

  .chip[data-court='away'] {
    border-bottom: 2px dashed var(--color-line-strong);
  }

  .chip[data-state='current'] {
    border-color: color-mix(in srgb, var(--color-primary) 70%, transparent);
    background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-2));
  }

  .chip[data-result='win'] {
    border-color: color-mix(in srgb, var(--color-positive) 55%, transparent);
  }

  .chip[data-result='win'] .chip-result {
    color: var(--color-positive);
  }

  .chip[data-result='loss'] {
    border-color: color-mix(in srgb, var(--color-destructive) 45%, transparent);
  }

  .chip[data-result='loss'] .chip-result {
    color: var(--color-destructive);
  }

  .chip-game {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--color-muted-foreground);
  }

  .chip-court {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
  }

  .chip-result {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1;
  }

  .chip-host {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: color-mix(in srgb, var(--color-muted-foreground) 70%, transparent);
  }

  .court-note {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--color-muted-foreground);
  }
</style>
