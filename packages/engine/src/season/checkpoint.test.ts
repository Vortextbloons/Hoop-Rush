import { describe, expect, it } from 'vitest';
import {
  franchiseIdSchema,
  seasonGameIdSchema,
  type SeasonGameSummary,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { reconstructSeasonGames } from './checkpoint.ts';
import { buildTestRun, scheduleOf } from './block-test-support.ts';
function tinySchedule(): SeasonSchedule {
  return scheduleOf(buildTestRun().run);
}
function summaryOf(
  gameId: string,
  round: number,
  homeScore: number,
  awayScore: number,
): SeasonGameSummary {
  const homeFranchiseId = round % 2 === 1 ? 'lakers' : 'celtics';
  const awayFranchiseId = homeFranchiseId === 'lakers' ? 'celtics' : 'lakers';
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v4',
    gameId: seasonGameIdSchema.parse(gameId),
    round,
    homeFranchiseId: franchiseIdSchema.parse(homeFranchiseId),
    awayFranchiseId: franchiseIdSchema.parse(awayFranchiseId),
    status: 'final',
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox: {
      franchiseId: franchiseIdSchema.parse(homeFranchiseId),
      points: homeScore,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 90,
      threePointersMade: 10,
      threePointersAttempted: 30,
      freeThrowsMade: 20,
      freeThrowsAttempted: 25,
      offensiveRebounds: 10,
      defensiveRebounds: 30,
      assists: 25,
      steals: 8,
      blocks: 5,
      turnovers: 12,
      fouls: 18,
      possessions: 100,
    },
    awayBox: {
      franchiseId: franchiseIdSchema.parse(awayFranchiseId),
      points: awayScore,
      fieldGoalsMade: 38,
      fieldGoalsAttempted: 88,
      threePointersMade: 9,
      threePointersAttempted: 28,
      freeThrowsMade: 22,
      freeThrowsAttempted: 26,
      offensiveRebounds: 11,
      defensiveRebounds: 29,
      assists: 23,
      steals: 7,
      blocks: 4,
      turnovers: 13,
      fouls: 19,
      possessions: 101,
    },
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
  };
}
describe('season game reconstruction (M2.3)', () => {
  it('overlays final and forfeit state on the scheduled base in schedule order', () => {
    const schedule = tinySchedule();
    const first = schedule.games[0];
    const second = schedule.games[1];
    if (first === undefined || second === undefined) throw new Error('schedule too short');
    const finalSummary = summaryOf(first.gameId, first.round, 110, 100);
    const forfeit: SeasonGameSummary = {
      ...summaryOf(second.gameId, second.round, 2, 0),
      status: 'forfeit',
      forfeitLoserFranchiseId: second.awayFranchiseId,
      homePlayers: [],
      awayPlayers: [],
      homeBox: {
        franchiseId: second.homeFranchiseId,
        points: 0,
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
        possessions: 0,
      },
      awayBox: {
        franchiseId: second.awayFranchiseId,
        points: 0,
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
        possessions: 0,
      },
    };
    const games = reconstructSeasonGames(schedule, [finalSummary, forfeit]);
    expect(games).toHaveLength(1230);
    expect(games[0]?.gameId).toBe(first.gameId);
    expect(games[1]?.gameId).toBe(second.gameId);
    expect(games[0]).toMatchObject({
      status: 'final',
      homeScore: 110,
      awayScore: 100,
      forfeitLoserFranchiseId: null,
    });
    expect(games[1]).toMatchObject({
      status: 'forfeit',
      homeScore: null,
      awayScore: null,
      forfeitLoserFranchiseId: second.awayFranchiseId,
    });
    expect(games[2]).toMatchObject({ status: 'scheduled', homeScore: null, awayScore: null });
  });
});
