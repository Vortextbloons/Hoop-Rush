import { expect, test } from 'bun:test';
import { seasonKeySchema, seedSchema } from '@hoop-rush/data-contracts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import { buildCapRushHistoricalField } from './historical-field.ts';

test('historical fields preserve franchise-season rosters and replay independently of catalog order', () => {
  const setup = capRushTestSetup();
  const bracket = setup.lockSources.bracket;
  const candidates = bracket.opponents.flatMap((opponent) =>
    ['2000-01', '2001-02', '2002-03'].flatMap((seasonKey) =>
      setup.catalog.candidates.map((player) => ({
        ...player,
        franchiseId: opponent.teamId,
        seasonKey: seasonKeySchema.parse(seasonKey),
      })),
    ),
  );
  const catalog = { ...setup.catalog, candidates };
  const seed = seedSchema.parse('0123456789abcdef');
  const first = buildCapRushHistoricalField(bracket, catalog, seed);
  expect(
    buildCapRushHistoricalField(
      bracket,
      { ...catalog, candidates: [...candidates].reverse() },
      seed,
    ),
  ).toEqual(first);
  expect(
    buildCapRushHistoricalField(bracket, catalog, seedSchema.parse('fedcba9876543210')),
  ).not.toEqual(first);
  for (const team of first.opponents) {
    expect(new Set(team.players.map((player) => player.playerId)).size).toBe(5);
    for (const assignment of team.lineup.assignments) {
      expect(assignment.positions).toContain(team.lineup.structure[assignment.slotIndex] ?? 'PG');
    }
    expect(
      candidates.some(
        (player) => player.franchiseId === team.teamId && player.seasonKey === team.seasonKey,
      ),
    ).toBe(true);
  }
  expect(bracket.opponents[0]?.seasonKey).not.toBe(first.opponents[0]?.seasonKey);
});

test('historical lineup variation stays close to the starting five strength', () => {
  const setup = capRushTestSetup();
  const bracket = setup.lockSources.bracket;
  const candidates = bracket.opponents.flatMap((opponent) =>
    setup.catalog.candidates.map((player) => ({ ...player, franchiseId: opponent.teamId })),
  );
  const catalog = { ...setup.catalog, candidates };
  const fields = Array.from({ length: 20 }, (_, index) =>
    buildCapRushHistoricalField(
      bracket,
      catalog,
      seedSchema.parse(index.toString(16).padStart(16, '0')),
    ),
  );
  for (const opponent of bracket.opponents) {
    const strengths = fields.map((field) => {
      const team = field.opponents.find((team) => team.teamId === opponent.teamId);
      if (team === undefined) throw new Error('Missing historical opponent');
      return team.players.reduce((sum, player) => sum + (player.overall ?? 0), 0);
    });
    expect(Math.max(...strengths) - Math.min(...strengths)).toBeLessThanOrEqual(4);
  }
});
