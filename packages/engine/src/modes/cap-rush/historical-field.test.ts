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
