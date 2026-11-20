import { afterEach, expect, test } from 'bun:test';
import {
  CAP_RUSH_TAKEOVER_TEAMS,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  capRushLeagueGameId,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  fullCourtTeamHealthSchema,
  idSchema,
  seedSchema,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtTeamHealth,
} from '@hoop-rush/data-contracts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  createFullCourtSeasonRepository,
  type DexieFullCourtSeasonRepository,
} from './full-court-season.ts';

afterEach(restoreIndexedDb);

const RUN_ID = idSchema.parse('full-court-season');
const LOCK_DIGEST = seedSchema.parse('0123456789abcdef');
const OTHER_DIGEST = seedSchema.parse('fedcba9876543210');
const TEAM_IDS = Array.from(
  { length: CAP_RUSH_TAKEOVER_TEAMS },
  (_, index) => `team${String(index + 1).padStart(2, '0')}`,
);

function teamHealth(teamId: string, throughDay: number): FullCourtTeamHealth {
  return fullCourtTeamHealthSchema.parse({
    version: FULL_COURT_HEALTH_VERSION,
    teamId,
    throughDay,
    players: {},
  });
}

function healthByTeam(
  slot: number,
  teams: readonly string[] = TEAM_IDS,
): Record<string, FullCourtTeamHealth> {
  return Object.fromEntries(
    teams.map((teamId, index) => [teamId, teamHealth(teamId, slot * 3 + (index % 2))]),
  );
}

function checkpointAt(input: {
  slot: number;
  healthByTeam: Record<string, FullCourtTeamHealth>;
  runId?: string;
  lockDigest?: string;
}): FullCourtSeasonCheckpoint {
  return fullCourtSeasonCheckpointSchema.parse({
    schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId: input.runId ?? RUN_ID,
    lockDigest: input.lockDigest ?? LOCK_DIGEST,
    completedThroughSlot: input.slot,
    healthByTeam: input.healthByTeam,
  });
}

function initialCheckpoint(): FullCourtSeasonCheckpoint {
  return checkpointAt({ slot: 0, healthByTeam: {} });
}

function slotCheckpoint(
  slot: number,
  overrides: { runId?: string; lockDigest?: string } = {},
): FullCourtSeasonCheckpoint {
  return checkpointAt({ slot, healthByTeam: healthByTeam(slot), ...overrides });
}

function scoresForSlot(slot: number, homeBase = 100): FullCourtSeasonScore[] {
  return Array.from({ length: CAP_RUSH_TAKEOVER_TEAMS / 2 }, (_, index) => {
    const homeTeamId = TEAM_IDS[index * 2];
    const awayTeamId = TEAM_IDS[index * 2 + 1];
    if (homeTeamId === undefined || awayTeamId === undefined) {
      throw new Error('Missing test teams');
    }
    return fullCourtSeasonScoreSchema.parse({
      gameId: capRushLeagueGameId(slot, homeTeamId, awayTeamId),
      slot,
      homeTeamId,
      awayTeamId,
      outcome: { kind: 'played', homePoints: homeBase + index, awayPoints: 90 + index },
    });
  });
}

async function storedCounts(db: HoopRushDatabase): Promise<[number, number]> {
  return [await db.fullCourtSeasonCheckpoints.count(), await db.fullCourtSeasonScores.count()];
}

async function expectUnchanged(
  repository: DexieFullCourtSeasonRepository,
  checkpoint: FullCourtSeasonCheckpoint,
  scores: FullCourtSeasonScore[],
): Promise<void> {
  expect(await repository.load(RUN_ID)).toEqual(checkpoint);
  expect(await repository.listScores(RUN_ID)).toEqual(scores);
}

test('creates, commits, replays, and resumes a Full Court season', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-season');
  try {
    const repository = createFullCourtSeasonRepository(first);
    const initial = initialCheckpoint();
    await repository.create(initial);
    expect(await repository.load(RUN_ID)).toEqual(initial);
    expect(await repository.listScores(RUN_ID)).toEqual([]);

    await repository.create(initial);
    await expect(
      repository.create(checkpointAt({ slot: 0, healthByTeam: {}, lockDigest: OTHER_DIGEST })),
    ).rejects.toThrow('already exists');

    const slotOne = slotCheckpoint(1);
    const scoresOne = scoresForSlot(1);
    expect(await repository.commitSlot(slotOne, scoresOne)).toEqual({ status: 'committed' });
    expect(await repository.load(RUN_ID)).toEqual(slotOne);
    expect(await repository.listScores(RUN_ID)).toEqual(scoresOne);
    expect(await repository.commitSlot(slotOne, scoresOne)).toEqual({ status: 'replayed' });
    expect(await storedCounts(first)).toEqual([1, 15]);

    first.close();
    const resumed = createFullCourtSeasonRepository(second);
    expect(await resumed.load(RUN_ID)).toEqual(slotOne);
    expect(await resumed.listScores(RUN_ID)).toEqual(scoresOne);

    const slotTwo = slotCheckpoint(2);
    const scoresTwo = scoresForSlot(2);
    await resumed.commitSlot(slotTwo, scoresTwo);
    expect(await resumed.load(RUN_ID)).toEqual(slotTwo);
    expect(await resumed.listScores(RUN_ID)).toEqual([...scoresOne, ...scoresTwo]);
    expect(await storedCounts(second)).toEqual([1, 30]);
  } finally {
    first.close();
    second.close();
  }
});

test('serializes competing slot commits across two database connections', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-season-race');
  try {
    const repository = createFullCourtSeasonRepository(first);
    await repository.create(initialCheckpoint());
    const other = createFullCourtSeasonRepository(second);
    const checkpoint = slotCheckpoint(1);
    const firstScores = scoresForSlot(1, 100);
    const secondScores = scoresForSlot(1, 120);
    const writes = await Promise.allSettled([
      repository.commitSlot(checkpoint, firstScores),
      other.commitSlot(checkpoint, secondScores),
    ]);
    expect(writes.map((write) => write.status).sort()).toEqual(['fulfilled', 'rejected']);
    const winner = writes[0].status === 'fulfilled' ? firstScores : secondScores;
    expect(await repository.load(RUN_ID)).toEqual(checkpoint);
    expect(await repository.listScores(RUN_ID)).toEqual(winner);
    expect(await storedCounts(first)).toEqual([1, 15]);

    await repository.commitSlot(slotCheckpoint(2), scoresForSlot(2));
    expect(await other.load(RUN_ID)).toEqual(slotCheckpoint(2));
    expect(await other.listScores(RUN_ID)).toHaveLength(30);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects conflicting replays, stale slots, and lock mismatches without partial writes', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-season-stale');
  try {
    const repository = createFullCourtSeasonRepository(first);
    await repository.create(initialCheckpoint());
    const slotOne = slotCheckpoint(1);
    const scoresOne = scoresForSlot(1);
    await repository.commitSlot(slotOne, scoresOne);

    const conflicting = scoresOne.map((score, index) =>
      index === 0 && score.outcome.kind === 'played'
        ? { ...score, outcome: { ...score.outcome, homePoints: score.outcome.homePoints + 1 } }
        : score,
    );
    await expect(repository.commitSlot(slotOne, conflicting)).rejects.toThrow(
      'already committed with different results',
    );
    await expectUnchanged(repository, slotOne, scoresOne);
    expect(await storedCounts(first)).toEqual([1, 15]);

    await expect(repository.commitSlot(slotCheckpoint(3), scoresForSlot(3))).rejects.toThrow(
      'out of order; expected 2',
    );
    await expect(
      repository.commitSlot(slotCheckpoint(2, { lockDigest: OTHER_DIGEST }), scoresForSlot(2)),
    ).rejects.toThrow('lock digest');
    await expectUnchanged(repository, slotOne, scoresOne);
    expect(await storedCounts(first)).toEqual([1, 15]);

    const slotTwo = slotCheckpoint(2);
    const scoresTwo = scoresForSlot(2);
    await repository.commitSlot(slotTwo, scoresTwo);
    await expect(repository.commitSlot(slotOne, scoresForSlot(1, 130))).rejects.toThrow('is stale');
    await expectUnchanged(repository, slotTwo, [...scoresOne, ...scoresTwo]);
    expect(await storedCounts(first)).toEqual([1, 30]);
  } finally {
    first.close();
  }
});

test('rejects malformed slot fixtures without writing a checkpoint or scores', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-season-invalid');
  try {
    const repository = createFullCourtSeasonRepository(first);
    const initial = initialCheckpoint();
    await repository.create(initial);
    const checkpoint = slotCheckpoint(1);
    const scores = scoresForSlot(1);
    const firstTeam = TEAM_IDS[0];
    const otherSlotScore = scoresForSlot(2)[0];
    if (firstTeam === undefined || otherSlotScore === undefined) {
      throw new Error('Missing test teams');
    }

    const health = Object.fromEntries(
      Object.entries(healthByTeam(1)).filter(([teamId]) => teamId !== TEAM_IDS[29]),
    );
    health.extra01 = teamHealth('extra01', 4);

    const cases: ReadonlyArray<{
      name: string;
      scores: readonly FullCourtSeasonScore[];
      checkpoint?: FullCourtSeasonCheckpoint;
      message: string;
    }> = [
      { name: 'too few scores', scores: scores.slice(0, 14), message: 'requires 15 scores' },
      {
        name: 'mixed slots',
        scores: [otherSlotScore, ...scores.slice(1)],
        message: 'does not belong to committed slot',
      },
      {
        name: 'duplicate team',
        scores: scores.map((score, index) =>
          index === 1
            ? {
                ...score,
                awayTeamId: firstTeam,
                gameId: capRushLeagueGameId(1, score.homeTeamId, firstTeam),
              }
            : score,
        ),
        message: 'repeats team',
      },
      {
        name: 'mismatched game ID',
        scores: scores.map((score, index) =>
          index === 0
            ? { ...score, gameId: capRushLeagueGameId(1, firstTeam, TEAM_IDS[3] ?? '') }
            : score,
        ),
        message: 'does not match its slot and teams',
      },
      {
        name: 'health rows do not match fixtures',
        scores,
        checkpoint: checkpointAt({ slot: 1, healthByTeam: health }),
        message: 'does not match a committed fixture',
      },
    ];

    for (const entry of cases) {
      await expect(
        repository.commitSlot(entry.checkpoint ?? checkpoint, entry.scores),
      ).rejects.toThrow(entry.message);
      await expectUnchanged(repository, initial, []);
      expect(await storedCounts(first)).toEqual([1, 0]);
    }
  } finally {
    first.close();
  }
});

test('requires slot health to advance beyond the committed checkpoint', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-season-health');
  try {
    const repository = createFullCourtSeasonRepository(first);
    await repository.create(initialCheckpoint());
    const slotOne = slotCheckpoint(1);
    const scoresOne = scoresForSlot(1);
    await repository.commitSlot(slotOne, scoresOne);

    const nonAdvancing = checkpointAt({ slot: 2, healthByTeam: healthByTeam(1) });
    await expect(repository.commitSlot(nonAdvancing, scoresForSlot(2))).rejects.toThrow(
      'does not advance',
    );
    await expectUnchanged(repository, slotOne, scoresOne);
    expect(await storedCounts(first)).toEqual([1, 15]);
  } finally {
    first.close();
  }
});

test('rejects unsupported envelopes and mismatched keys on read', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-season-read');
  try {
    const repository = createFullCourtSeasonRepository(first);
    const initial = initialCheckpoint();
    await repository.create(initial);
    const stored = await first.fullCourtSeasonCheckpoints.get(RUN_ID);
    if (stored === undefined) throw new Error('Missing stored checkpoint');

    await first.table('fullCourtSeasonCheckpoints').put({ ...stored, saveSchemaVersion: 99 });
    await expect(repository.load(RUN_ID)).rejects.toThrow('stored save schema 99');

    await first.fullCourtSeasonCheckpoints.put({
      ...stored,
      checkpoint: { ...stored.checkpoint, runId: idSchema.parse('other-run') },
    });
    await expect(repository.load(RUN_ID)).rejects.toThrow('differs from its key');
  } finally {
    first.close();
  }
});
