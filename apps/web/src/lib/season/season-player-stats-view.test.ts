import { describe, expect, it } from 'vitest';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import type { SeasonGameSummary, SeasonRoster } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, seedSchema, seasonGameIdSchema } from '@hoop-rush/data-contracts';
import { humanSeasonPlayerStats, type SeasonPlayerStatsView } from './season-player-stats-view';
const SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
const league = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
const schedule = generateSeasonSchedule({ league, seed: SEED });
const run = buildSeasonRunFixture({
  schedule,
  league,
  seed: SEED,
  humanFranchiseId: franchiseIdSchema.parse('lakers'),
});
const rosterOf = (franchiseId: string): SeasonRoster => {
  const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
  if (roster === undefined) throw new Error(`no roster for ${franchiseId}`);
  return roster;
};
function lineOf(
  roster: SeasonRoster,
  index: number,
  overrides: Partial<Record<string, number>> = {},
) {
  const entry = roster.players[index];
  if (entry === undefined) throw new Error('roster index out of range');
  return {
    playerVersionId: entry.playerVersionId,
    seconds: 720,
    points: 10,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 9,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 1,
    freeThrowsAttempted: 2,
    offensiveRebounds: 1,
    defensiveRebounds: 2,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 1,
    ...overrides,
  };
}
function boxOf(roster: SeasonRoster) {
  return {
    franchiseId: roster.franchiseId,
    points: 100,
    fieldGoalsMade: 40,
    fieldGoalsAttempted: 90,
    threePointersMade: 10,
    threePointersAttempted: 30,
    freeThrowsMade: 10,
    freeThrowsAttempted: 20,
    offensiveRebounds: 10,
    defensiveRebounds: 20,
    assists: 30,
    steals: 10,
    blocks: 5,
    turnovers: 20,
    fouls: 15,
    possessions: 100,
  };
}
function summary(home: SeasonRoster, away: SeasonRoster): SeasonGameSummary {
  return {
    schemaVersion: 1,
    summaryVersion: run.versions.summaryVersion,
    gameId: seasonGameIdSchema.parse('s000001'),
    round: 1,
    homeFranchiseId: home.franchiseId,
    awayFranchiseId: away.franchiseId,
    status: 'final',
    overtimePeriods: 0,
    homeScore: 100,
    awayScore: 95,
    forfeitLoserFranchiseId: null,
    homeBox: boxOf(home),
    awayBox: boxOf(away),
    homePlayers: home.players.map((_, index) => lineOf(home, index)),
    awayPlayers: away.players.map((_, index) => lineOf(away, index)),
    injuryEvents: [],
  };
}
const roster = rosterOf('lakers');
const input = {
  roster,
  summaries: [] as SeasonGameSummary[],
  overallRatingOf: () => 87,
  playablePositions: () => ['PG', 'SG'],
};
function viewOf(input: Parameters<typeof humanSeasonPlayerStats>[0]): SeasonPlayerStatsView {
  return humanSeasonPlayerStats(input);
}
describe('humanSeasonPlayerStats', () => {
  it('joins the ten roster players in roster order', () => {
    const view = viewOf(input);
    expect(view.franchiseId).toBe('lakers');
    expect(view.rows).toHaveLength(10);
    expect(view.rows.map((row) => row.playerVersionId)).toEqual(
      roster.players.map((entry) => entry.playerVersionId),
    );
  });
  it('reports no stats before any block is accepted', () => {
    const view = viewOf(input);
    expect(view.hasStats).toBe(false);
    for (const row of view.rows) {
      expect(row.gamesPlayed).toBe(0);
      expect(row.points).toBe(0);
      expect(row.fieldGoalPct).toBeNull();
      expect(row.threePointPct).toBeNull();
      expect(row.freeThrowPct).toBeNull();
    }
  });
  it('carries identity, OVR, and positions from the roster and lookups', () => {
    const view = viewOf(input);
    const first = view.rows[0];
    expect(first?.displayName).toBe(roster.players[0]?.displayName);
    expect(first?.seasonKey).toBe(roster.players[0]?.seasonKey);
    expect(first?.overallRating).toBe(87);
    expect(first?.positions).toEqual(['PG', 'SG']);
  });
  it('folds totals, per-game rates, and percentages from accepted summaries', () => {
    const away = rosterOf('celtics');
    const view = viewOf({ ...input, summaries: [summary(roster, away)] });
    expect(view.hasStats).toBe(true);
    for (const row of view.rows) {
      expect(row.gamesPlayed).toBe(1);
      expect(row.minutes).toBe(12);
      expect(row.minutesPerGame).toBe(12);
      expect(row.points).toBe(10);
      expect(row.pointsPerGame).toBe(10);
      expect(row.rebounds).toBe(3);
      expect(row.reboundsPerGame).toBe(3);
      expect(row.assists).toBe(3);
      expect(row.assistsPerGame).toBe(3);
      expect(row.steals).toBe(1);
      expect(row.blocks).toBe(0);
      expect(row.turnovers).toBe(2);
      expect(row.fouls).toBe(1);
      expect(row.fieldGoalsMade).toBe(4);
      expect(row.fieldGoalsAttempted).toBe(9);
      expect(row.fieldGoalPct).toBeCloseTo(4 / 9);
      expect(row.threePointersMade).toBe(1);
      expect(row.threePointersAttempted).toBe(3);
      expect(row.threePointPct).toBeCloseTo(1 / 3);
      expect(row.freeThrowsMade).toBe(1);
      expect(row.freeThrowsAttempted).toBe(2);
      expect(row.freeThrowPct).toBeCloseTo(0.5);
    }
  });
  it('rates over multiple games and leaves percentages null with zero attempts', () => {
    const away = rosterOf('celtics');
    const home = rosterOf('lakers');
    const zeroAttempts = {
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
    };
    const games = [
      {
        ...summary(home, away),
        homePlayers: home.players.map((_, index) => lineOf(home, index, zeroAttempts)),
      },
      {
        ...summary(home, away),
        gameId: seasonGameIdSchema.parse('s000002'),
        homePlayers: home.players.map((_, index) => lineOf(home, index, zeroAttempts)),
      },
    ];
    const view = viewOf({ ...input, summaries: games });
    for (const row of view.rows) {
      expect(row.gamesPlayed).toBe(2);
      expect(row.minutesPerGame).toBe(12);
      expect(row.pointsPerGame).toBe(10);
      expect(row.fieldGoalPct).toBeNull();
      expect(row.threePointPct).toBeNull();
      expect(row.freeThrowPct).toBeNull();
    }
  });
  it('keeps one row per roster version across multiple games', () => {
    const away = rosterOf('celtics');
    const summary1 = summary(roster, away);
    const summary2 = {
      ...summary(roster, away),
      gameId: seasonGameIdSchema.parse('s000002'),
      homeFranchiseId: franchiseIdSchema.parse('celtics'),
      awayFranchiseId: franchiseIdSchema.parse('lakers'),
    };
    const view = viewOf({ ...input, summaries: [summary1, summary2] });
    expect(view.rows).toHaveLength(10);
    for (const row of view.rows) {
      expect(row.gamesPlayed).toBe(2);
      expect(row.points).toBe(20);
    }
  });
});
