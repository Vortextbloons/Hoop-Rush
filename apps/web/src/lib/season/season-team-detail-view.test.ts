import { describe, expect, it } from 'vitest';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import type { SeasonGameSummary, SeasonRoster, SeasonRotation } from '@hoop-rush/data-contracts';
import { seasonTeamDetail, type SeasonTeamDetail } from './season-team-detail-view';

/**
 * Season Run team detail view-model tests (M2.5 team drill-down): the
 * roster/rotation join, minutes accounting (240), closing-five marking,
 * folded player stats, and OVR/position lookups — all from recorded facts.
 */

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
const schedule = generateSeasonSchedule({ league, seed: SEED });
const run = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: 'lakers' });

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
    gameId: 's000001',
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
  standings: run.standings,
  league: run.league,
  summaries: [] as SeasonGameSummary[],
  overallRatingOf: () => 87,
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
      'Starter G',
      'Starter G',
      'Starter F',
      'Starter F',
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
        roster: { ...input.roster, franchiseId: 'nonexistent' },
      }),
    ).toBeNull();
  });
});
