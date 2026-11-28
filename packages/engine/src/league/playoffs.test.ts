import { describe, expect, it } from 'bun:test';
import { seedSchema } from '@hoop-rush/data-contracts';
import { nextPlayoffGamePlan, type PlayoffSeriesLike } from './playoffs.ts';

const SEED = seedSchema.parse('1111111111111111');

function seriesWithGames(count: number, round = 1): PlayoffSeriesLike {
  return {
    seriesId: `crs-${String(round)}-0`,
    round,
    seriesSlot: 0,
    highTeamId: 'high',
    lowTeamId: 'low',
    highSeed: 1,
    lowSeed: 8,
    games: Array.from({ length: count }, () => ({})),
  };
}

describe('shared playoff game plan', () => {
  it('uses the 1-2-5-7 home pattern and marks the finals round', () => {
    for (let ordinal = 1; ordinal <= 7; ordinal += 1) {
      const plan = nextPlayoffGamePlan({
        series: seriesWithGames(ordinal - 1),
        seed: SEED,
        userTeamId: 'low',
        finalsRound: 4,
      });
      const highHome = [1, 2, 5, 7].includes(ordinal);
      expect(plan.gameOrdinal).toBe(ordinal);
      expect(plan.homeTeamId).toBe(highHome ? 'high' : 'low');
      expect(plan.awayTeamId).toBe(highHome ? 'low' : 'high');
      expect(plan.homeSeed).toBe(highHome ? 1 : 8);
      expect(plan.awaySeed).toBe(highHome ? 8 : 1);
      expect(plan.userSide).toBe(highHome ? 'away' : 'home');
      expect(plan.isFinals).toBe(false);
      expect(plan.seed).toBe(SEED);
    }

    const finals = nextPlayoffGamePlan({
      series: seriesWithGames(0, 4),
      seed: SEED,
      userTeamId: 'missing',
      finalsRound: 4,
    });
    expect(finals.isFinals).toBe(true);
    expect(finals.userSide).toBeNull();
  });
});
