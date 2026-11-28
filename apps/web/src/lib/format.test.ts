import { expect, test } from 'bun:test';
import { usageSharePct } from './format.ts';

test('usage share is normalized per game so missed games do not shrink a role', () => {
  const fullSeason = { games: 80, fga: 1600, fta: 200, turnovers: 160 };
  const halfSeason = { games: 40, fga: 600, fta: 100, turnovers: 80 };
  const roster = [fullSeason, halfSeason];

  expect(usageSharePct(fullSeason, roster)).toBe('56.1%');
  // Per-game this is 18.1 vs 23.1 usage possessions, not the 28.1% season-total share.
  expect(usageSharePct(halfSeason, roster)).toBe('43.9%');
});
