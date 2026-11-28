import { expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  POSITIONS,
  playerVersionId,
  seasonKeySchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildCapRushTestCatalog } from '@hoop-rush/test-fixtures';
import { buildCapRushLeagueSchedule } from '../cap-rush/league-schedule.ts';
import { buildFullCourtHistoricalField, buildFullCourtLeagueSchedule } from './league.ts';

const runSeed = seedSchema.parse('0123456789abcdef');
const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
  teamId: franchiseId,
  displayName: franchiseId,
}));

test('historical rotations prefer their anchor and fill from neighboring franchise seasons', () => {
  const base = buildCapRushTestCatalog({ overalls: [82, 79, 76] });
  const anchor = seasonKeySchema.parse('1995-96');
  const previous = seasonKeySchema.parse('1994-95');
  const distant = seasonKeySchema.parse('1990-91');
  const catalog = {
    ...base,
    candidates: base.candidates.map((player, index) => {
      const seasonKey = index % 3 === 2 ? distant : index % 3 === 1 ? previous : anchor;
      return {
        ...player,
        seasonKey,
        playerVersionId: playerVersionId(
          player.playerId,
          player.franchiseId,
          player.eraId,
          seasonKey,
        ),
      };
    }),
  };
  const lakers = [{ teamId: 'lakers', displayName: 'Los Angeles Lakers' }];
  const teams = buildFullCourtHistoricalField({ catalog, field: lakers, runSeed });
  expect(teams).toHaveLength(1);
  const [team] = teams;
  if (team === undefined) throw new Error('Expected a historical opponent');
  expect(team.players).toHaveLength(10);
  expect(new Set(team.players.map((player) => player.playerId)).size).toBe(10);
  expect(team.players.filter((player) => player.seasonKey === team.seasonKey)).toHaveLength(5);
  expect(team.players.every((player) => player.franchiseId === 'lakers')).toBe(true);
  expect(team.players.every((player) => player.seasonKey !== distant)).toBe(true);
  expect(team.starterVersionIds).toEqual(
    team.players.slice(0, 5).map((player) => player.playerVersionId),
  );
  for (const [index, position] of POSITIONS.entries()) {
    expect(team.players[index]?.positions.playable).toContain(position);
  }
  expect(
    buildFullCourtHistoricalField({
      catalog: { ...catalog, candidates: [...catalog.candidates].reverse() },
      field: lakers,
      runSeed,
    }),
  ).toEqual(teams);
});

test('calendar preserves every Cap Rush fixture and gives each franchise deterministic rest days', () => {
  const games = buildFullCourtLeagueSchedule({ field, runSeed });
  expect(games).toHaveLength(1230);
  expect(
    games.map(({ gameId, slot, homeTeamId, awayTeamId }) => ({
      gameId,
      slot,
      homeTeamId,
      awayTeamId,
    })),
  ).toEqual([...buildCapRushLeagueSchedule({ field, runSeed }).games]);
  expect(buildFullCourtLeagueSchedule({ field: [...field].reverse(), runSeed })).toEqual(games);
  for (const team of field) {
    const days = games
      .filter((game) => game.homeTeamId === team.teamId || game.awayTeamId === team.teamId)
      .map((game) => game.dayOffset);
    const gaps = days.slice(1).map((day, index) => day - (days[index] ?? day));
    expect(days).toHaveLength(82);
    expect(gaps.every((gap) => gap > 0)).toBe(true);
    expect(gaps).toContain(1);
    expect(gaps.some((gap) => gap > 2)).toBe(true);
  }
});

test('the new field can draw both weak and strong historical leagues', () => {
  const weak = buildCapRushTestCatalog({ overalls: [64, 64, 64] });
  const strong = buildCapRushTestCatalog({ overalls: [89, 89, 89] });
  const catalog = {
    ...weak,
    candidates: [
      ...weak.candidates,
      ...strong.candidates.map((player) => ({
        ...player,
        seasonKey: seasonKeySchema.parse('2005-06'),
        playerVersionId: playerVersionId(
          player.playerId,
          player.franchiseId,
          player.eraId,
          '2005-06',
        ),
      })),
    ],
  };
  const opponents = [{ teamId: 'lakers', displayName: 'Los Angeles Lakers' }];
  const draws = new Set<string>();
  for (let index = 0; index < 40; index++) {
    const seed = seedSchema.parse(index.toString(16).padStart(16, '0'));
    const draw = buildFullCourtHistoricalField({
      catalog,
      field: opponents,
      runSeed: seed,
      variedStrength: true,
    });
    const [opponent] = draw;
    if (opponent === undefined) throw new Error('Expected a historical opponent');
    draws.add(opponent.seasonKey);
  }
  expect(draws).toEqual(new Set(['1995-96', '2005-06']));
});
