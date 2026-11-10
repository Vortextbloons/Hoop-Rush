import { expect, test } from 'bun:test';
import { havocInstanceSeed, seasonKeySchema, seedSchema } from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
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
    buildCapRushHistoricalField(
      { ...bracket, opponents: [...bracket.opponents].reverse() },
      catalog,
      seed,
    ).opponents.reverse(),
  ).toEqual(first.opponents);
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

test('league targets allow weak and strong fields within a wide band with nearest-lineup fallbacks', () => {
  const setup = capRushTestSetup();
  const bracket = setup.lockSources.bracket;
  const candidates = bracket.opponents.flatMap((opponent, teamIndex) => {
    const strengths = teamIndex === 0 ? [45] : teamIndex === 1 ? [95] : [45, 55, 65, 75, 85, 95];
    return strengths.flatMap((strength, seasonIndex) =>
      setup.catalog.candidates.map((player) => ({
        ...player,
        franchiseId: opponent.teamId,
        seasonKey: seasonKeySchema.parse(`200${String(seasonIndex)}-0${String(seasonIndex + 1)}`),
        summaryRatings: { ...player.summaryRatings, overallRating: strength },
      })),
    );
  });
  const catalog = { ...setup.catalog, candidates };
  const averages: number[] = [];
  for (let index = 0; index < 64; index += 1) {
    const seed = seedSchema.parse(index.toString(16).padStart(16, '0'));
    const rng = createRng(havocInstanceSeed(seed, 'cap-rush-league-strength-v1'));
    const target = 65 + ((rng.next() + rng.next()) / 2) * 20;
    const field = buildCapRushHistoricalField(bracket, catalog, seed);
    const strengths = field.opponents.map((team) =>
      team.players.reduce((sum, player) => sum + (player.overall ?? 0), 0) / 5,
    );
    expect(strengths[0]).toBe(45);
    expect(strengths[1]).toBe(95);
    for (const strength of strengths.slice(2)) {
      expect(Math.abs(strength - target)).toBeLessThanOrEqual(15);
    }
    averages.push(strengths.reduce((sum, strength) => sum + strength, 0) / strengths.length);
  }
  expect(Math.min(...averages)).toBeLessThan(70);
  expect(Math.max(...averages)).toBeGreaterThan(80);
});

test('historical fields reject franchises without a complete eligible lineup', () => {
  const setup = capRushTestSetup();
  expect(() =>
    buildCapRushHistoricalField(
      setup.lockSources.bracket,
      { ...setup.catalog, candidates: [] },
      seedSchema.parse('0123456789abcdef'),
    ),
  ).toThrow('Cap Rush has no historical lineup');
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
