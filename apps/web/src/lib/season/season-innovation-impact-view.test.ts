import { describe, expect, it } from 'vitest';
import {
  seasonInnovationImpactOf,
  type SeasonInnovationRule,
} from './season-innovation-impact-view';
import type { SeasonGameSummary, SeasonRetainedGameDetail } from '@hoop-rush/data-contracts';

const HOME = 'lakers';
const AWAY = 'celtics';

function summary(input: {
  gameId: string;
  rule: SeasonInnovationRule | 'standard';
  homeScore: number;
  awayScore: number;
  possessions?: number;
  turnovers?: number;
  shotClockViolations?: number;
  fourPointers?: { made: number; attempted: number };
  overtimeRace?: { homePoints: number; awayPoints: number };
  homeFranchiseId?: string;
}): SeasonGameSummary {
  const homeBox = {
    franchiseId: input.homeFranchiseId ?? HOME,
    points: input.homeScore,
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
    turnovers: input.turnovers ?? 0,
    fouls: 0,
    possessions: input.possessions ?? 0,
    ...(input.shotClockViolations === undefined
      ? {}
      : { shotClockViolations: input.shotClockViolations }),
    ...(input.fourPointers === undefined
      ? {}
      : {
          fourPointersMade: input.fourPointers.made,
          fourPointersAttempted: input.fourPointers.attempted,
        }),
  };
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v4',
    gameId: input.gameId as SeasonGameSummary['gameId'],
    round: 1,
    homeFranchiseId: (input.homeFranchiseId ?? HOME) as SeasonGameSummary['homeFranchiseId'],
    awayFranchiseId: AWAY as SeasonGameSummary['awayFranchiseId'],
    status: 'final',
    overtimePeriods: input.overtimeRace === undefined ? 0 : 1,
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    forfeitLoserFranchiseId: null,
    homeBox,
    awayBox: { ...homeBox, franchiseId: AWAY, points: input.awayScore },
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
    ...(input.rule === 'standard' ? {} : { gameRule: input.rule }),
    ...(input.overtimeRace === undefined
      ? {}
      : { overtimeRace: { target: 7, ...input.overtimeRace } }),
  } as unknown as SeasonGameSummary;
}

function detailFor(
  gameId: string,
  overtimeRace: { homePoints: number; awayPoints: number; possessions: number },
): SeasonRetainedGameDetail {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    gameId: gameId as SeasonRetainedGameDetail['gameId'],
    round: 1,
    homeFranchiseId: HOME as SeasonRetainedGameDetail['homeFranchiseId'],
    awayFranchiseId: AWAY as SeasonRetainedGameDetail['awayFranchiseId'],
    result: {
      outcome: 'completed',
      overtimeRace: { target: 7, ...overtimeRace },
    },
    injuryEvents: [],
  } as unknown as SeasonRetainedGameDetail;
}

describe('season innovation impact view', () => {
  it('keeps the impact scoped to the human team’s home games', () => {
    const impact = seasonInnovationImpactOf({
      summaries: [
        summary({
          gameId: 's000001',
          rule: 'deep-four',
          homeScore: 112,
          awayScore: 100,
          possessions: 100,
          fourPointers: { made: 2, attempted: 5 },
        }),
        summary({
          gameId: 's000002',
          rule: 'deep-four',
          homeScore: 101,
          awayScore: 110,
          possessions: 90,
          homeFranchiseId: AWAY,
        }),
        summary({
          gameId: 's000003',
          rule: 'standard',
          homeScore: 120,
          awayScore: 100,
          possessions: 100,
        }),
      ],
      humanFranchiseId: HOME,
      rule: 'deep-four',
    });

    expect(impact?.games).toHaveLength(1);
    expect(impact?.wins).toBe(1);
    expect(impact?.losses).toBe(0);
    expect(impact?.averageMargin).toBe(12);
    expect(impact?.pointsPer100).toBe(112);
    expect(impact?.evidence).toEqual({
      kind: 'deep-four',
      attempts: 5,
      makes: 2,
      points: 8,
    });
  });

  it('reports direct twenty-second-clock evidence and preserves missing fields', () => {
    const impact = seasonInnovationImpactOf({
      summaries: [
        summary({
          gameId: 's000004',
          rule: 'twenty-second-clock',
          homeScore: 108,
          awayScore: 104,
          possessions: 96,
          turnovers: 14,
          shotClockViolations: 3,
        }),
        summary({
          gameId: 's000005',
          rule: 'twenty-second-clock',
          homeScore: 98,
          awayScore: 103,
          possessions: 94,
          turnovers: 11,
        }),
      ],
      humanFranchiseId: HOME,
      rule: 'twenty-second-clock',
    });

    expect(impact?.evidence).toEqual({
      kind: 'twenty-second-clock',
      possessions: 190,
      turnovers: 25,
      shotClockViolations: null,
    });
  });

  it('uses retained details for first-to-seven race possessions', () => {
    const impact = seasonInnovationImpactOf({
      summaries: [
        summary({
          gameId: 's000006',
          rule: 'first-to-seven-overtime',
          homeScore: 104,
          awayScore: 101,
          possessions: 90,
          overtimeRace: { homePoints: 7, awayPoints: 5 },
        }),
      ],
      details: [detailFor('s000006', { homePoints: 7, awayPoints: 5, possessions: 9 })],
      humanFranchiseId: HOME,
      rule: 'first-to-seven-overtime',
    });

    expect(impact?.evidence).toEqual({
      kind: 'first-to-seven-overtime',
      overtimeGames: 1,
      raceHomePoints: 7,
      raceAwayPoints: 5,
      racePossessions: 9,
    });
  });

  it('returns null when no matching home game has been played', () => {
    expect(
      seasonInnovationImpactOf({
        summaries: [
          summary({
            gameId: 's000007',
            rule: 'standard',
            homeScore: 100,
            awayScore: 90,
            possessions: 0,
          }),
        ],
        humanFranchiseId: HOME,
        rule: 'deep-four',
      }),
    ).toBeNull();
  });
});
