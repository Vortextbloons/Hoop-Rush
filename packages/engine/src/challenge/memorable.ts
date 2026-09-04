import type { ChallengeRun, GameResult } from '@hoop-rush/data-contracts';

export const MEMORABLE_GAMES_MAX = 8;
export const MEMORABLE_GAMES_MIN = 4;
export const MEMORABLE_NAIL_BITER_MARGIN = 5;
export const MEMORABLE_BLOWOUT_MARGIN = 20;

function absDiff(game: GameResult): number {
  return Math.abs(game.home.box.points - game.away.box.points);
}

export function selectMemorableGames(run: ChallengeRun, max = MEMORABLE_GAMES_MAX): GameResult[] {
  const games = run.games;
  if (games.length === 0 || max <= 0) return [];
  const cap = Math.min(Math.max(1, max), games.length);
  const picked = new Map<number, GameResult>();

  const firstLossNumber = run.firstLossGameNumber;
  if (firstLossNumber !== null) {
    const firstLoss = games.find((g) => g.gameNumber === firstLossNumber);
    if (firstLoss) picked.set(firstLoss.gameNumber, firstLoss);
  }

  const remaining = () => games.filter((g) => !picked.has(g.gameNumber));

  const overtime = remaining()
    .filter((g) => g.overtimePeriods > 0)
    .sort((a, b) => {
      if (b.overtimePeriods !== a.overtimePeriods) return b.overtimePeriods - a.overtimePeriods;
      const diff = absDiff(a) - absDiff(b);
      if (diff !== 0) return diff;
      return a.gameNumber - b.gameNumber;
    });
  for (const g of overtime) picked.set(g.gameNumber, g);

  const nailBiters = remaining()
    .filter((g) => absDiff(g) <= MEMORABLE_NAIL_BITER_MARGIN)
    .sort((a, b) => {
      const diff = absDiff(a) - absDiff(b);
      if (diff !== 0) return diff;
      return a.gameNumber - b.gameNumber;
    });
  for (const g of nailBiters) picked.set(g.gameNumber, g);

  const blowouts = remaining()
    .filter((g) => absDiff(g) >= MEMORABLE_BLOWOUT_MARGIN)
    .sort((a, b) => {
      const diff = absDiff(b) - absDiff(a);
      if (diff !== 0) return diff;
      return a.gameNumber - b.gameNumber;
    });
  for (const g of blowouts) picked.set(g.gameNumber, g);

  let ordered = [...picked.values()];

  if (ordered.length < Math.min(MEMORABLE_GAMES_MIN, games.length)) {
    const filler = remaining().sort((a, b) => {
      const diff = absDiff(a) - absDiff(b);
      if (diff !== 0) return diff;
      return a.gameNumber - b.gameNumber;
    });
    for (const g of filler) {
      if (ordered.length >= Math.min(MEMORABLE_GAMES_MIN, games.length)) break;
      picked.set(g.gameNumber, g);
    }
    ordered = [...picked.values()];
  }

  return ordered.slice(0, cap);
}
