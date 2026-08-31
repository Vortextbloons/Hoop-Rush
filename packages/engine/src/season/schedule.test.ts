import { describe, expect, it } from 'vitest';
import {
  SEASON_COMMITTED_SCHEDULE_SEED,
  SEASON_GAME_COUNT,
  SEASON_ROUND_COUNT,
  seasonScheduleSchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, seedFromString } from '@hoop-rush/test-fixtures';
import { auditSeasonSchedule, generateSeasonSchedule } from './schedule.ts';
import {
  conferenceNonDivisionOpponentsOf,
  divisionOpponentsOf,
  oppositeConferenceOpponentsOf,
} from './league.ts';
const SEEDS = [SEASON_COMMITTED_SCHEDULE_SEED, seedFromString('schedule-test-1')];
describe('generateSeasonSchedule', () => {
  it('generates the committed schedule with the committed seed', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
    expect(seasonScheduleSchema.safeParse(schedule).success).toBe(true);
    expect(auditSeasonSchedule(schedule, league)).toEqual([]);
    expect(schedule.games).toHaveLength(SEASON_GAME_COUNT);
    expect(schedule.rounds).toBe(SEASON_ROUND_COUNT);
    expect(schedule.games[0]?.gameId).toBe('s000001');
    expect(schedule.games[schedule.games.length - 1]?.gameId).toBe('s001230');
  });
  it('regenerates byte-identically for the same seed', () => {
    const league = buildSeasonLeague();
    for (const seed of SEEDS) {
      const first = generateSeasonSchedule({ league, seed });
      const second = generateSeasonSchedule({ league, seed });
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
  });
  it('keeps every franchise at 82 games with 41 home and 41 away', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    for (const game of schedule.games) {
      home.set(game.homeFranchiseId, (home.get(game.homeFranchiseId) ?? 0) + 1);
      away.set(game.awayFranchiseId, (away.get(game.awayFranchiseId) ?? 0) + 1);
    }
    for (const team of league.teams) {
      expect(home.get(team.franchiseId)).toBe(41);
      expect(away.get(team.franchiseId)).toBe(41);
    }
  });
  it('structures every round as 15 games', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
    for (let round = 1; round <= SEASON_ROUND_COUNT; round += 1) {
      const games = schedule.games.filter((game) => game.round === round);
      expect(games).toHaveLength(15);
    }
  });
  it('applies the frozen frequency formula per team', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
    const opponentCounts = new Map<string, Map<string, number>>();
    for (const team of league.teams) opponentCounts.set(team.franchiseId, new Map());
    for (const game of schedule.games) {
      opponentCounts
        .get(game.homeFranchiseId)
        ?.set(
          game.awayFranchiseId,
          (opponentCounts.get(game.homeFranchiseId)?.get(game.awayFranchiseId) ?? 0) + 1,
        );
      opponentCounts
        .get(game.awayFranchiseId)
        ?.set(
          game.homeFranchiseId,
          (opponentCounts.get(game.awayFranchiseId)?.get(game.homeFranchiseId) ?? 0) + 1,
        );
    }
    for (const team of league.teams) {
      const counts = opponentCounts.get(team.franchiseId) ?? new Map();
      for (const opponent of divisionOpponentsOf(league, team.franchiseId)) {
        expect(counts.get(opponent)).toBe(4);
      }
      for (const opponent of oppositeConferenceOpponentsOf(league, team.franchiseId)) {
        expect(counts.get(opponent)).toBe(2);
      }
      const nonDivision = conferenceNonDivisionOpponentsOf(league, team.franchiseId);
      const four = nonDivision.filter((opponent) => counts.get(opponent) === 4);
      const three = nonDivision.filter((opponent) => counts.get(opponent) === 3);
      expect(four).toHaveLength(6);
      expect(three).toHaveLength(4);
    }
  });
  it('balances three-game pairings to six home games per team', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
    const homeVersus = new Map<string, Map<string, number>>();
    const opponentCounts = new Map<string, Map<string, number>>();
    for (const team of league.teams) {
      homeVersus.set(team.franchiseId, new Map());
      opponentCounts.set(team.franchiseId, new Map());
    }
    for (const game of schedule.games) {
      homeVersus
        .get(game.homeFranchiseId)
        ?.set(
          game.awayFranchiseId,
          (homeVersus.get(game.homeFranchiseId)?.get(game.awayFranchiseId) ?? 0) + 1,
        );
      opponentCounts
        .get(game.homeFranchiseId)
        ?.set(
          game.awayFranchiseId,
          (opponentCounts.get(game.homeFranchiseId)?.get(game.awayFranchiseId) ?? 0) + 1,
        );
      opponentCounts
        .get(game.awayFranchiseId)
        ?.set(
          game.homeFranchiseId,
          (opponentCounts.get(game.awayFranchiseId)?.get(game.homeFranchiseId) ?? 0) + 1,
        );
    }
    for (const team of league.teams) {
      let threeGameHome = 0;
      for (const opponent of conferenceNonDivisionOpponentsOf(league, team.franchiseId)) {
        if ((opponentCounts.get(team.franchiseId)?.get(opponent) ?? 0) !== 3) continue;
        threeGameHome += homeVersus.get(team.franchiseId)?.get(opponent) ?? 0;
      }
      expect(threeGameHome).toBe(6);
    }
  });
  it('generates valid schedules across many seeds', () => {
    const league = buildSeasonLeague();
    for (let i = 0; i < 3; i += 1) {
      const seed = seedFromString(`schedule-batch-${String(i)}`);
      const schedule = generateSeasonSchedule({ league, seed });
      expect(auditSeasonSchedule(schedule, league)).toEqual([]);
      expect(seasonScheduleSchema.safeParse(schedule).success).toBe(true);
    }
  });
  it('supports a league with an altered alignment', () => {
    const league = buildSeasonLeague();
    const altered = {
      ...league,
      teams: league.teams.map((team) => {
        if (team.franchiseId === 'hawks') return { ...team, division: 'central' as const };
        if (team.franchiseId === 'pistons') return { ...team, division: 'southeast' as const };
        return team;
      }),
    };
    const schedule = generateSeasonSchedule({ league: altered, seed: seedFromString('altered') });
    expect(auditSeasonSchedule(schedule, altered)).toEqual([]);
  });
  it('supports different generation versions', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({
      league,
      seed: seedFromString('gen-version'),
      generationVersion: 'schedule-gen-v2-test',
    });
    expect(auditSeasonSchedule(schedule, league)).toEqual([]);
  });
  it('rejects a league without 30 teams', () => {
    const league = buildSeasonLeague();
    const short = { ...league, teams: league.teams.slice(0, 29) };
    expect(() =>
      generateSeasonSchedule({ league: short, seed: seedFromString('short') }),
    ).toThrow();
  });
});
describe('auditSeasonSchedule', () => {
  it('detects a swapped pairing', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: seedFromString('audit-swap') });
    const games = schedule.games.map((game) => ({ ...game }));
    const first = games[0];
    if (!first) throw new Error('no games');
    games[0] = {
      ...first,
      homeFranchiseId: first.awayFranchiseId,
      awayFranchiseId: first.homeFranchiseId,
    };
    const failures = auditSeasonSchedule({ ...schedule, games }, league);
    expect(failures.length).toBeGreaterThan(0);
  });
  it('detects a changed round and a duplicated game', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: seedFromString('audit-round') });
    const games = schedule.games.map((game) => ({ ...game }));
    const first = games[0];
    if (!first) throw new Error('no games');
    games[0] = { ...first, round: 82 };
    const roundFailures = auditSeasonSchedule({ ...schedule, games }, league);
    expect(roundFailures.length).toBeGreaterThan(0);
    const duplicated = [...games, { ...first }];
    const duplicateFailures = auditSeasonSchedule({ ...schedule, games: duplicated }, league);
    expect(duplicateFailures.length).toBeGreaterThan(0);
  });
  it('detects a removed game and a self-game', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: seedFromString('audit-missing') });
    const removed = schedule.games.slice(1);
    expect(auditSeasonSchedule({ ...schedule, games: removed }, league).length).toBeGreaterThan(0);
    const games = schedule.games.map((game) => ({ ...game }));
    const first = games[0];
    if (!first) throw new Error('no games');
    games[0] = { ...first, awayFranchiseId: first.homeFranchiseId };
    expect(auditSeasonSchedule({ ...schedule, games }, league).length).toBeGreaterThan(0);
  });
  it('flags a league mismatch', () => {
    const league = buildSeasonLeague();
    const schedule = generateSeasonSchedule({ league, seed: seedFromString('audit-league') });
    const other = buildSeasonLeague({
      teams: league.teams.filter((team) => team.franchiseId !== 'celtics'),
    });
    expect(auditSeasonSchedule(schedule, other).length).toBeGreaterThan(0);
  });
});
