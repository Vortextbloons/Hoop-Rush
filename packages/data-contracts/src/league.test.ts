import { describe, expect, it } from 'vitest';
import {
  LEAGUE_RECORD_VERSION,
  LEAGUE_SCHEDULE_VERSION,
  leagueRecordDigest,
  leagueRecordSchema,
  leagueWorkerMessageSchema,
  leagueWorkerRequestSchema,
  franchiseIdSchema,
  playerIdSchema,
  seedSchema,
} from './index.ts';
import type { LeagueRecord } from './league.ts';

const TEAM_IDS = Array.from({ length: 30 }, (_, index) => `fixture-${String(index)}`);

function buildRecordMaterial(): Omit<LeagueRecord, 'digest'> {
  return {
    leagueVersion: LEAGUE_RECORD_VERSION,
    scheduleVersion: LEAGUE_SCHEDULE_VERSION,
    seed: seedSchema.parse('aaaaaaaaaaaaaaaa'),
    bracketVersion: 'bracket-v1',
    dataVersion: 'data-v1',
    eraProfileVersion: 'profile-v1',
    gamesSimulated: 1189,
    teams: TEAM_IDS.map((teamId) => ({
      teamId: franchiseIdSchema.parse(teamId),
      gamesPlayed: 79,
      wins: 40,
      losses: 39,
    })),
    players: TEAM_IDS.flatMap((teamId, teamIndex) =>
      Array.from({ length: 5 }, (_, slot) => ({
        playerId: playerIdSchema.parse(`p-${String(teamIndex)}-${String(slot)}`),
        teamId: franchiseIdSchema.parse(teamId),
        games: 79,
        totalValueBase: 100,
        totalValueBaseSquared: 200,
        totalShots: 100,
        totalShotsSquared: 150,
        totalValueShots: 120,
        totalPoints: 900,
        totalRebounds: 300,
        totalAssists: 200,
        totalSteals: 50,
        totalBlocks: 25,
        totalGameScore: 600,
        totalTrueShooting: 40,
      })),
    ),
  };
}

describe('league record schema', () => {
  it('round-trips a league record with a stable digest', () => {
    const material = buildRecordMaterial();
    const record = leagueRecordSchema.parse({
      ...material,
      digest: leagueRecordDigest(material),
    });
    const { digest, ...withoutDigest } = record;
    expect(digest).toBe(leagueRecordDigest(material));
    expect(leagueRecordDigest(withoutDigest)).toBe(record.digest);
  });

  it('rejects league records with the wrong team or player counts', () => {
    const material = buildRecordMaterial();
    expect(
      leagueRecordSchema.safeParse({
        ...material,
        teams: material.teams.slice(0, 29),
        digest: '0'.repeat(32),
      }).success,
    ).toBe(false);
    expect(
      leagueRecordSchema.safeParse({
        ...material,
        players: material.players.slice(0, 149),
        digest: '0'.repeat(32),
      }).success,
    ).toBe(false);
  });
});

describe('league worker wire schema', () => {
  it('validates league worker messages', () => {
    const material = buildRecordMaterial();
    const record = leagueRecordSchema.parse({
      ...material,
      digest: leagueRecordDigest(material),
    });
    expect(
      leagueWorkerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'progress',
        requestId: 'req-1',
        gamesDone: 96,
        gamesTotal: 1189,
      }).success,
    ).toBe(true);
    expect(
      leagueWorkerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'result',
        requestId: 'req-1',
        record,
      }).success,
    ).toBe(true);
    expect(
      leagueWorkerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'error',
        requestId: 'req-1',
        message: 'boom',
      }).success,
    ).toBe(true);
    expect(
      leagueWorkerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'result',
        requestId: 'req-1',
        record: { ...record, digest: 'nope' },
      }).success,
    ).toBe(false);
    expect(
      leagueWorkerRequestSchema.safeParse({
        schemaVersion: 1,
        type: 'compute',
        requestId: 'req-1',
        seed: 'bbbbbbbbbbbbbbbb',
        bracket: {
          bracketVersion: 'bracket-v1',
          scheduleVersion: 'schedule-v1',
          opponents: [],
          schedule: [],
        },
        profile: {},
      }).success,
    ).toBe(false);
    expect(
      leagueWorkerRequestSchema.safeParse({
        schemaVersion: 1,
        type: 'cancel',
        requestId: 'req-1',
      }).success,
    ).toBe(true);
  });
});
