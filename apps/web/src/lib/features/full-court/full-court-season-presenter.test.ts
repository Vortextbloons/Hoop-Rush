import { expect, test } from 'bun:test';
import type { FullCourtPlayoffScore } from '@hoop-rush/data-contracts';
import type { FullCourtPlayoffSeries } from '@hoop-rush/engine';
import { fullCourtResultOf, fullCourtSeriesGames } from './full-court-season-presenter';

const game: FullCourtPlayoffScore = {
  gameId: 'fcp-1-0-3',
  dayOffset: 180,
  homeTeamId: 'lal',
  awayTeamId: 'bos',
  winnerTeamId: 'bos',
  outcome: { kind: 'forfeit', losingSides: ['home', 'away'] },
};

test('shows a double forfeit as a loss from either regular-season perspective', () => {
  for (const teamId of [game.homeTeamId, game.awayTeamId]) {
    expect(fullCourtResultOf(game, teamId)).toMatchObject({
      won: false,
      doubleForfeit: true,
      scoreLabel: 'Double forfeit',
      userPoints: null,
      opponentPoints: null,
    });
  }
});

test('shows the recorded series winner even when the home team and away team both forfeit', () => {
  const series: FullCourtPlayoffSeries = {
    seriesId: 'fcs-1-0',
    round: 1,
    seriesSlot: 0,
    highSeed: 1,
    lowSeed: 8,
    highTeamId: game.winnerTeamId,
    lowTeamId: game.homeTeamId,
    games: [game],
  };
  expect(fullCourtSeriesGames(series, game.awayTeamId)[0]).toMatchObject({
    won: true,
    doubleForfeit: true,
    scoreLabel: 'Double forfeit',
  });
  expect(fullCourtSeriesGames(series, game.homeTeamId)[0]?.won).toBe(false);
});
