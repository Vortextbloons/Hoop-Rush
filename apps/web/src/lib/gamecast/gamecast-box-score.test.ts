import { expect, test } from 'bun:test';
import {
  gamecastBoxScoreColumns,
  gamecastBoxScoreLineTotals,
  gamecastBoxScoreTotals,
  type GamecastBoxScoreLine,
} from './gamecast-box-score';

function line(overrides: Partial<GamecastBoxScoreLine> = {}): GamecastBoxScoreLine {
  return {
    minutes: 24,
    points: 12,
    fieldGoals: { made: 5, attempted: 10 },
    threes: { made: 1, attempted: 4 },
    freeThrows: { made: 1, attempted: 2 },
    rebounds: { total: 6 },
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 1,
    ...overrides,
  };
}

test('shares box-score column values and team totals', () => {
  const columns = gamecastBoxScoreColumns<GamecastBoxScoreLine>([
    'points',
    'rebounds',
    'assists',
    'steals',
    'blocks',
    'turnovers',
    'fouls',
    'fieldGoals',
    'threes',
    'freeThrows',
    'fieldGoalPct',
    'trueShootingPct',
  ]);
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const player = line();

  expect(byKey.get('points')?.value(player)).toBe(12);
  expect(byKey.get('rebounds')?.value(player)).toBe(6);
  expect(byKey.get('fieldGoals')?.value(player)).toBe('5-10');
  expect(byKey.get('threes')?.value(player)).toBe('1-4');
  expect(byKey.get('freeThrows')?.value(player)).toBe('1-2');
  expect(byKey.get('fieldGoalPct')?.value(player)).toBe('50.0%');
  expect(byKey.get('trueShootingPct')?.value(player)).toBe('51.0%');
  expect(byKey.get('points')?.cellClass).toBe('ui-stats-value-strong');

  const totals = gamecastBoxScoreLineTotals([player, line({ minutes: 12, points: 4 })]);
  expect(totals).toMatchObject({
    minutes: 36,
    points: 16,
    rebounds: 12,
    assists: 6,
    fieldGoals: { made: 10, attempted: 20 },
  });
  const totalsRow = gamecastBoxScoreTotals(totals);
  expect(totalsRow.value(byKey.get('points')!)).toBe(16);
  expect(totalsRow.value(byKey.get('fieldGoals')!)).toBe('10-20');
  expect(totalsRow.value({ key: 'minutes', label: 'MIN', value: () => 0 })).toBe(36);
});
