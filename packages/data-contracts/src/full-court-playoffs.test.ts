import { describe, expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_PLAYOFFS_VERSION,
  fullCourtPlayoffCheckpointSchema,
} from './index.ts';

function baseCheckpoint() {
  return {
    schemaVersion: FULL_COURT_PLAYOFFS_VERSION,
    runId: 'fc-playoff-contract',
    lockDigest: '0123456789abcdef',
    games: [],
    healthByTeam: Object.fromEntries(
      CAP_RUSH_FRANCHISE_ALIGNMENT.map(
        ({ franchiseId }) =>
          [
            franchiseId,
            {
              teamId: franchiseId,
              version: FULL_COURT_HEALTH_VERSION,
              throughDay: 170,
              players: {},
            },
          ] as const,
      ),
    ),
  };
}

describe('full court playoff contracts', () => {
  test('accepts legacy playoff scores without evidence or adaptations', () => {
    const parsed = fullCourtPlayoffCheckpointSchema.parse({
      ...baseCheckpoint(),
      games: [
        {
          gameId: 'fcp-1-0-1',
          dayOffset: 173,
          homeTeamId: 'celtics',
          awayTeamId: 'knicks',
          winnerTeamId: 'celtics',
          outcome: { kind: 'played', homePoints: 102, awayPoints: 96 },
        },
      ],
    });
    expect(parsed.games[0]?.evidence).toBeUndefined();
    expect(parsed.games[0]?.adaptations).toBeUndefined();
  });

  test('accepts played playoff scores with bounded evidence and adaptations', () => {
    const parsed = fullCourtPlayoffCheckpointSchema.parse({
      ...baseCheckpoint(),
      games: [
        {
          gameId: 'fcp-1-0-3',
          dayOffset: 177,
          homeTeamId: 'celtics',
          awayTeamId: 'knicks',
          winnerTeamId: 'knicks',
          outcome: { kind: 'played', homePoints: 94, awayPoints: 99 },
          evidence: {
            home: {
              fieldGoalAttempts: 84,
              rimAttempts: 41,
              leadUsageCentis: 2450,
              teamUsageCentis: 10400,
            },
            away: {
              fieldGoalAttempts: 80,
              rimAttempts: 24,
              leadUsageCentis: 2900,
              teamUsageCentis: 10100,
            },
          },
          adaptations: {
            away: {
              defense: 'protect-paint',
              reason: 'persistent-inside-scoring',
              sampleGames: 2,
              windowGames: 2,
              observedShareBps: 4820,
              thresholdShareBps: 4600,
            },
          },
        },
      ],
    });
    expect(parsed.games[0]?.adaptations?.away?.defense).toBe('protect-paint');
  });

  test('rejects evidence or adaptations on forfeits and out-of-bounds totals', () => {
    expect(
      fullCourtPlayoffCheckpointSchema.safeParse({
        ...baseCheckpoint(),
        games: [
          {
            gameId: 'fcp-1-0-1',
            dayOffset: 173,
            homeTeamId: 'celtics',
            awayTeamId: 'knicks',
            winnerTeamId: 'celtics',
            outcome: { kind: 'forfeit', losingSides: ['away'] },
            evidence: {
              home: {
                fieldGoalAttempts: 80,
                rimAttempts: 30,
                leadUsageCentis: 2200,
                teamUsageCentis: 9800,
              },
              away: {
                fieldGoalAttempts: 80,
                rimAttempts: 30,
                leadUsageCentis: 2200,
                teamUsageCentis: 9800,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      fullCourtPlayoffCheckpointSchema.safeParse({
        ...baseCheckpoint(),
        games: [
          {
            gameId: 'fcp-1-0-1',
            dayOffset: 173,
            homeTeamId: 'celtics',
            awayTeamId: 'knicks',
            winnerTeamId: 'celtics',
            outcome: { kind: 'played', homePoints: 100, awayPoints: 95 },
            evidence: {
              home: {
                fieldGoalAttempts: 40,
                rimAttempts: 41,
                leadUsageCentis: 2000,
                teamUsageCentis: 8000,
              },
              away: {
                fieldGoalAttempts: 40,
                rimAttempts: 10,
                leadUsageCentis: 2000,
                teamUsageCentis: 8000,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
