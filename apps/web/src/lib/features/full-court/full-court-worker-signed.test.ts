import { expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_TAKEOVER_TEAMS,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  capRushLeagueGameId,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { fullCourtWorkerSlotResultSchema } from './full-court-worker-protocol.ts';

test('accepts a signed simulated slot outcome from the worker envelope', () => {
  const runId = idSchema.parse('worker-signed');
  const digest = seedSchema.parse('0123456789abcdef');
  const teamIds = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => franchiseId);
  const healthByTeam = Object.fromEntries(
    teamIds.map((teamId) => [
      teamId,
      { version: FULL_COURT_HEALTH_VERSION, teamId, throughDay: 4, players: {} },
    ]),
  );
  const checkpoint = fullCourtSeasonCheckpointSchema.parse({
    schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId,
    lockDigest: digest,
    completedThroughSlot: 1,
    healthByTeam,
  });
  const scores = Array.from({ length: CAP_RUSH_TAKEOVER_TEAMS / 2 }, (_, index) => {
    const homeTeamId = teamIds[index * 2];
    const awayTeamId = teamIds[index * 2 + 1];
    if (homeTeamId === undefined || awayTeamId === undefined) {
      throw new Error('missing teams');
    }
    return fullCourtSeasonScoreSchema.parse({
      gameId: capRushLeagueGameId(1, homeTeamId, awayTeamId),
      slot: 1,
      homeTeamId,
      awayTeamId,
      outcome:
        index === 0
          ? {
              kind: 'played',
              homePoints: 98,
              awayPoints: 85,
              benchPoints: { home: 45, away: -1 },
              benchPlayers: { home: 5, away: 1 },
              starterPoints: { home: 53, away: 86 },
              lineups: {
                version: 1,
                side: 'home',
                sampleThreshold: 20,
                lineups: [
                  {
                    playerIds: ['a', 'b', 'c', 'd', 'e'],
                    players: ['a', 'b', 'c', 'd', 'e'].map((playerId) => ({
                      playerId,
                      displayName: playerId.toUpperCase(),
                    })),
                    seconds: 900,
                    offensivePossessions: 60,
                    defensivePossessions: 58,
                    pointsFor: 98,
                    pointsAgainst: 85,
                  },
                ],
                omitted: {
                  lineups: 0,
                  seconds: 0,
                  offensivePossessions: 0,
                  defensivePossessions: 0,
                  pointsFor: 0,
                  pointsAgainst: 0,
                },
              },
            }
          : { kind: 'played', homePoints: 100, awayPoints: 90 },
    });
  });

  const parsed = fullCourtWorkerSlotResultSchema.parse({
    schemaVersion: 1,
    type: 'full-court-slot-result',
    requestId: 'signed-slot',
    outcome: {
      kind: 'simulated',
      checkpoint,
      scores,
      userGame: {
        kind: 'played',
        result: { schemaVersion: 1, home: {}, away: {} },
        tape: null,
        health: {
          home: healthByTeam[teamIds[0] ?? ''],
          away: healthByTeam[teamIds[1] ?? ''],
        },
        injuries: [],
      },
    },
  });
  expect(parsed.outcome).toMatchObject({ kind: 'simulated' });
  if (parsed.outcome.kind !== 'simulated') throw new Error('expected a simulated slot');
  expect(parsed.outcome.scores[0]?.outcome).toMatchObject({
    lineups: { side: 'home', version: 1 },
  });
});
