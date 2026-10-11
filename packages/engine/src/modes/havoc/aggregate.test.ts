import { describe, expect, it } from 'vitest';
import { HAVOC_MVP_INDEX_WEIGHTS } from '@hoop-rush/data-contracts';
import { buildHavocGameSummary, buildHavocStatLine } from '@hoop-rush/test-fixtures';
import {
  FoldHavocAggregate,
  havocProductionIndexOf,
  zeroHavocSeasonAggregate,
} from './aggregate.ts';

describe('havoc aggregate folding', () => {
  it('starts from a zeroed aggregate', () => {
    expect(zeroHavocSeasonAggregate()).toEqual({
      games: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      adjustments: 0,
    });
  });

  it('sums games, wins, losses, points, and adjustments', () => {
    const win = buildHavocGameSummary({
      gameNumber: 1,
      humanScore: 110,
      opponentScore: 100,
      outcome: 'win',
      adjustments: 8,
    });
    const loss = buildHavocGameSummary({
      gameNumber: 2,
      humanScore: 90,
      opponentScore: 101,
      outcome: 'loss',
      adjustments: -4,
    });
    const afterWin = FoldHavocAggregate(zeroHavocSeasonAggregate(), win);
    expect(afterWin).toEqual({
      games: 1,
      wins: 1,
      losses: 0,
      pointsFor: 110,
      pointsAgainst: 100,
      adjustments: 8,
    });
    const afterLoss = FoldHavocAggregate(afterWin, loss);
    expect(afterLoss).toEqual({
      games: 2,
      wins: 1,
      losses: 1,
      pointsFor: 200,
      pointsAgainst: 201,
      adjustments: 4,
    });
  });

  it('keeps negative scores and adjustments honest', () => {
    const negative = buildHavocGameSummary({
      humanScore: -6,
      opponentScore: -12,
      outcome: 'win',
      adjustments: -30,
    });
    expect(FoldHavocAggregate(zeroHavocSeasonAggregate(), negative)).toEqual({
      games: 1,
      wins: 1,
      losses: 0,
      pointsFor: -6,
      pointsAgainst: -12,
      adjustments: -30,
    });
  });
});

describe('havoc production index', () => {
  it('applies the documented MVP weights to recorded totals', () => {
    const line = buildHavocStatLine({
      points: 20,
      rebounds: { total: 10, offensive: 2, defensive: 8 },
      assists: 5,
      steals: 2,
      blocks: 3,
      turnovers: 4,
    });
    const expected =
      HAVOC_MVP_INDEX_WEIGHTS.points * 20 +
      HAVOC_MVP_INDEX_WEIGHTS.rebounds * 10 +
      HAVOC_MVP_INDEX_WEIGHTS.assists * 5 +
      HAVOC_MVP_INDEX_WEIGHTS.steals * 2 +
      HAVOC_MVP_INDEX_WEIGHTS.blocks * 3 +
      HAVOC_MVP_INDEX_WEIGHTS.turnovers * 4;
    expect(havocProductionIndexOf(line)).toBe(expected);
    expect(expected).toBe(505);
  });

  it('supports negative production', () => {
    const line = buildHavocStatLine({
      points: -4,
      rebounds: { total: 0, offensive: 0, defensive: 0 },
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 6,
    });
    expect(havocProductionIndexOf(line)).toBe(-100);
  });
});
