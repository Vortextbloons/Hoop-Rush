import { afterEach, expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_TAKEOVER_TEAMS,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_PLAYOFFS_VERSION,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  capRushLeagueGameId,
  fullCourtPlayoffCheckpointSchema,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  idSchema,
  seedSchema,
  type FullCourtSeasonScore,
  type FullCourtTeamHealth,
} from '@hoop-rush/data-contracts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtPlayoffRepository } from './full-court-playoffs.ts';
import { createFullCourtSeasonRepository } from './full-court-season.ts';

afterEach(restoreIndexedDb);

const RUN_ID = idSchema.parse('full-court-signed');
const LOCK_DIGEST = seedSchema.parse('0123456789abcdef');
const TEAM_IDS = Array.from(
  { length: CAP_RUSH_TAKEOVER_TEAMS },
  (_, index) => `team${String(index + 1).padStart(2, '0')}`,
);

function teamHealth(teamId: string, throughDay: number): FullCourtTeamHealth {
  return {
    version: FULL_COURT_HEALTH_VERSION,
    teamId,
    throughDay,
    players: {},
  };
}

function healthByTeam(throughDay: number): Record<string, FullCourtTeamHealth> {
  return Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, teamHealth(teamId, throughDay)]));
}

function playoffHealthByTeam(throughDay: number): Record<string, FullCourtTeamHealth> {
  return Object.fromEntries(
    CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => [
      franchiseId,
      teamHealth(franchiseId, throughDay),
    ]),
  );
}

function signedOutcome(): FullCourtSeasonScore['outcome'] {
  return {
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
  };
}

test('round-trips a signed regular-season score through compact storage', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-signed-season');
  try {
    const repository = createFullCourtSeasonRepository(first);
    await repository.create(
      fullCourtSeasonCheckpointSchema.parse({
        schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
        runId: RUN_ID,
        lockDigest: LOCK_DIGEST,
        completedThroughSlot: 0,
        healthByTeam: {},
      }),
    );
    const scores = Array.from({ length: CAP_RUSH_TAKEOVER_TEAMS / 2 }, (_, index) => {
      const homeTeamId = TEAM_IDS[index * 2];
      const awayTeamId = TEAM_IDS[index * 2 + 1];
      if (homeTeamId === undefined || awayTeamId === undefined) {
        throw new Error('Missing test teams');
      }
      return fullCourtSeasonScoreSchema.parse({
        gameId: capRushLeagueGameId(1, homeTeamId, awayTeamId),
        slot: 1,
        homeTeamId,
        awayTeamId,
        outcome:
          index === 0 ? signedOutcome() : { kind: 'played', homePoints: 100, awayPoints: 90 },
      });
    });
    const checkpoint = fullCourtSeasonCheckpointSchema.parse({
      schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
      runId: RUN_ID,
      lockDigest: LOCK_DIGEST,
      completedThroughSlot: 1,
      healthByTeam: healthByTeam(4),
    });

    expect(await repository.commitSlot(checkpoint, scores)).toEqual({ status: 'committed' });
    expect(await repository.listScores(RUN_ID)).toEqual(scores);
    expect(scores[0]?.outcome).toMatchObject({
      benchPoints: { away: -1 },
      starterPoints: { away: 86 },
      lineups: { side: 'home', version: 1 },
    });

    first.close();
    const reopened = createFullCourtSeasonRepository(second);
    expect(await reopened.listScores(RUN_ID)).toEqual(scores);
  } finally {
    first.close();
    second.close();
  }
});

test('round-trips a signed playoff score through the playoff checkpoint', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-signed-playoffs');
  try {
    const before = fullCourtPlayoffCheckpointSchema.parse({
      schemaVersion: FULL_COURT_PLAYOFFS_VERSION,
      runId: RUN_ID,
      lockDigest: LOCK_DIGEST,
      games: [],
      healthByTeam: playoffHealthByTeam(170),
    });
    const after = fullCourtPlayoffCheckpointSchema.parse({
      ...before,
      games: [
        {
          gameId: 'fcp-1-0-1',
          dayOffset: 173,
          homeTeamId: 'celtics',
          awayTeamId: 'knicks',
          winnerTeamId: 'celtics',
          outcome: signedOutcome(),
        },
      ],
      healthByTeam: {
        ...before.healthByTeam,
        celtics: teamHealth('celtics', 173),
        knicks: teamHealth('knicks', 173),
      },
    });
    const repository = createFullCourtPlayoffRepository(first);
    await repository.create(before);
    await repository.commitGame(after);
    expect((await repository.load(RUN_ID))?.games[0]?.outcome).toMatchObject({
      benchPoints: { away: -1 },
      starterPoints: { away: 86 },
    });

    first.close();
    const reopened = createFullCourtPlayoffRepository(second);
    expect(await reopened.load(RUN_ID)).toEqual(after);
  } finally {
    first.close();
    second.close();
  }
});
