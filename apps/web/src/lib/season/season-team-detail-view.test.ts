import { describe, expect, it } from 'vitest';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import type { SeasonGameSummary, SeasonRoster, SeasonRotation } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, seedSchema, seasonGameIdSchema } from '@hoop-rush/data-contracts';
import {
  normalizeTeamProjection,
  rawSeasonTeamRatings,
  seasonLeagueTeamProjections,
  seasonTeamDetail,
  type SeasonTeamDetail,
} from './season-team-detail-view';
const SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
const league = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
const schedule = generateSeasonSchedule({ league, seed: SEED });
const run = buildSeasonRunFixture({
  schedule,
  league,
  seed: SEED,
  humanFranchiseId: franchiseIdSchema.parse('lakers'),
});
function zeroRawProjection() {
  return { overall: 0, offense: 0, defense: 0 };
}
const rosterOf = (franchiseId: string): SeasonRoster => {
  const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
  if (roster === undefined) throw new Error(`no roster for ${franchiseId}`);
  return roster;
};
const rotationOf = (franchiseId: string): SeasonRotation => {
  const rotation = run.rotations.find((r) => r.franchiseId === franchiseId);
  if (rotation === undefined) throw new Error(`no rotation for ${franchiseId}`);
  return rotation;
};
function zeroLine(roster: SeasonRoster, index: number, seconds = 720, points = 10) {
  const entry = roster.players[index];
  if (entry === undefined) throw new Error('roster index out of range');
  return {
    playerVersionId: entry.playerVersionId,
    seconds,
    points,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}
function zeroBox(roster: SeasonRoster, points: number) {
  return {
    franchiseId: roster.franchiseId,
    points,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 100,
  };
}
function summary(home: SeasonRoster, away: SeasonRoster): SeasonGameSummary {
  const homePoints = home.players.reduce((sum, _, index) => sum + (index % 2 === 0 ? 12 : 4), 0);
  return {
    schemaVersion: 1,
    summaryVersion: run.versions.summaryVersion,
    gameId: seasonGameIdSchema.parse('s000001'),
    round: 1,
    homeFranchiseId: home.franchiseId,
    awayFranchiseId: away.franchiseId,
    status: 'final',
    overtimePeriods: 0,
    homeScore: homePoints,
    awayScore: 80,
    forfeitLoserFranchiseId: null,
    homeBox: zeroBox(home, homePoints),
    awayBox: zeroBox(away, 80),
    homePlayers: home.players.map((_, index) =>
      zeroLine(home, index, 720, index % 2 === 0 ? 12 : 4),
    ),
    awayPlayers: away.players.map((_, index) => zeroLine(away, index)),
    injuryEvents: [],
  };
}
const input = {
  roster: rosterOf('lakers'),
  rotation: rotationOf('lakers'),
  rosters: run.rosters,
  rotations: run.rotations,
  standings: run.standings,
  league: run.league,
  summaries: [] as SeasonGameSummary[],
  overallRatingOf: () => 87,
  summaryRatingsOf: () => ({ overallRating: 80, offenseRating: 82, defenseRating: 74 }),
  playablePositions: () => ['PG', 'SG'],
};
function detailOf(input: Parameters<typeof seasonTeamDetail>[0]): SeasonTeamDetail {
  const detail = seasonTeamDetail(input);
  if (detail === null) throw new Error('expected a team detail');
  return detail;
}
describe('seasonTeamDetail', () => {
  it('joins the ten roster players to the locked rotation in rotation order', () => {
    const detail = detailOf(input);
    expect(detail.starters).toHaveLength(5);
    expect(detail.bench).toHaveLength(5);
    const all = [...detail.starters, ...detail.bench];
    expect(all).toHaveLength(10);
    expect(new Set(all.map((row) => row.playerVersionId)).size).toBe(10);
  });
  it('describes starter slots and bench order from the rotation', () => {
    const detail = detailOf(input);
    expect(detail.starters.map((row) => row.role)).toEqual([
      'Starter PG',
      'Starter SG',
      'Starter SF',
      'Starter PF',
      'Starter C',
    ]);
    expect(detail.bench.map((row) => row.role)).toEqual([
      'Bench 1',
      'Bench 2',
      'Bench 3',
      'Bench 4',
      'Bench 5',
    ]);
  });
  it('accounts target minutes to exactly 240', () => {
    const detail = detailOf(input);
    expect(detail.minutesTotal).toBe(240);
    const all = [...detail.starters, ...detail.bench];
    expect(all.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
  });
  it('marks the closing five independently of the starters', () => {
    const detail = detailOf(input);
    const rotation = rotationOf('lakers');
    const closing = detail.closingFive.map((row) => row.playerVersionId);
    expect(closing).toEqual(rotation.closingFive);
    for (const row of [...detail.starters, ...detail.bench]) {
      expect(row.closing).toBe(rotation.closingFive.includes(row.playerVersionId));
    }
  });
  it('carries the franchise record, conference, and point differential', () => {
    const detail = detailOf(input);
    expect(detail.franchiseId).toBe('lakers');
    expect(detail.conference).toBe('west');
    expect(detail.wins).toBe(0);
    expect(detail.losses).toBe(0);
    expect(detail.gamesPlayed).toBe(0);
    expect(detail.diff).toBe(0);
    expect(detail.hasStats).toBe(false);
  });
  it('forwards OVR and positions from the lookup functions', () => {
    const detail = detailOf(input);
    for (const row of [...detail.starters, ...detail.bench]) {
      expect(row.overallRating).toBe(87);
      expect(row.positions).toEqual(['PG', 'SG']);
    }
  });
  it('builds the league-normalized 0-100 strip from the player ratings', () => {
    const detail = detailOf(input);
    expect(detail.projection).toEqual({ overall: 76, offense: 76, defense: 76 });
  });
  it('hides the strip when no rostered player ratings resolve', () => {
    const detail = seasonTeamDetail({ ...input, summaryRatingsOf: () => null });
    expect(detail?.projection).toBeNull();
  });
  it('folds per-player season rates from accepted summaries', () => {
    const away = rosterOf('celtics');
    const detail = detailOf({ ...input, summaries: [summary(input.roster, away)] });
    expect(detail.hasStats).toBe(true);
    for (const row of detail.starters) {
      expect(row.stats).not.toBeNull();
      expect(row.stats?.gamesPlayed).toBe(1);
      expect(row.stats?.minutesPerGame).toBe(12);
    }
    const first = detail.starters[0];
    expect(first?.stats?.pointsPerGame).toBe(12);
    expect(first?.stats?.reboundsPerGame).toBe(0);
  });
  it('returns null for a franchise missing from the standings', () => {
    expect(
      seasonTeamDetail({
        ...input,
        roster: { ...input.roster, franchiseId: franchiseIdSchema.parse('nonexistent') },
      }),
    ).toBeNull();
  });
});
describe('seasonLeagueTeamProjections', () => {
  it('maps the weakest and strongest franchises to the display floor and ceiling', () => {
    const ratings = new Map<
      string,
      {
        overallRating: number;
        offenseRating: number;
        defenseRating: number;
      }
    >();
    for (const roster of run.rosters) {
      const tier =
        roster.franchiseId === 'lakers' ? 'high' : roster.franchiseId === 'celtics' ? 'low' : 'mid';
      for (const entry of roster.players) {
        ratings.set(entry.playerVersionId, {
          overallRating: tier === 'high' ? 90 : tier === 'low' ? 68 : 78,
          offenseRating: tier === 'high' ? 92 : tier === 'low' ? 66 : 76,
          defenseRating: tier === 'high' ? 88 : tier === 'low' ? 70 : 80,
        });
      }
    }
    const summaryRatingsOf = (playerVersionId: string) => ratings.get(playerVersionId) ?? null;
    const projections = seasonLeagueTeamProjections({
      rosters: run.rosters,
      rotations: run.rotations,
      summaryRatingsOf,
    });
    expect(projections.get('lakers')).toEqual({ overall: 94, offense: 94, defense: 94 });
    expect(projections.get('celtics')).toEqual({ overall: 58, offense: 58, defense: 58 });
    const mids = [...projections.entries()]
      .filter(([franchiseId]) => franchiseId !== 'lakers' && franchiseId !== 'celtics')
      .map(([, projection]) => projection.overall);
    for (const overall of mids) {
      expect(overall).toBeGreaterThan(58);
      expect(overall).toBeLessThan(94);
    }
  });
  it('weights heavy-minute stars more than equal-minute benches on the same roster', () => {
    const roster = input.roster;
    const ratings = new Map<
      string,
      {
        overallRating: number;
        offenseRating: number;
        defenseRating: number;
      }
    >();
    for (const entry of roster.players) {
      ratings.set(entry.playerVersionId, {
        overallRating: 70,
        offenseRating: 70,
        defenseRating: 70,
      });
    }
    const star = roster.players[0];
    const bench = roster.players[5];
    if (star === undefined || bench === undefined)
      throw new Error('fixture roster missing players');
    ratings.set(star.playerVersionId, { overallRating: 95, offenseRating: 95, defenseRating: 95 });
    ratings.set(bench.playerVersionId, { overallRating: 62, offenseRating: 62, defenseRating: 62 });
    const summaryRatingsOf = (playerVersionId: string) => ratings.get(playerVersionId) ?? null;
    const baselines = {
      overall: { min: 70, max: 80 },
      offense: { min: 70, max: 80 },
      defense: { min: 70, max: 80 },
    };
    const starHeavy = normalizeTeamProjection(
      rawSeasonTeamRatings({
        roster,
        rotation: {
          ...input.rotation,
          targetMinutes: roster.players.map((entry, index) => ({
            playerVersionId: entry.playerVersionId,
            minutes: index === 0 ? 40 : index === 5 ? 8 : 22,
          })),
        },
        summaryRatingsOf,
      }) ?? zeroRawProjection(),
      baselines,
    );
    const balanced = normalizeTeamProjection(
      rawSeasonTeamRatings({
        roster,
        rotation: {
          ...input.rotation,
          targetMinutes: roster.players.map((entry) => ({
            playerVersionId: entry.playerVersionId,
            minutes: 24,
          })),
        },
        summaryRatingsOf,
      }) ?? zeroRawProjection(),
      baselines,
    );
    expect(starHeavy.overall).toBeGreaterThan(balanced.overall);
  });
});
