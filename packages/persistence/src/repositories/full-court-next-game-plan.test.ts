import { afterEach, expect, test } from 'bun:test';
import {
  FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
  idSchema,
  type FullCourtNextGamePlan,
} from '@hoop-rush/data-contracts';
import { fullCourtNextGamePlanRecordSchema } from '../schemas/full-court-next-game-plan-record.ts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtNextGamePlanRepository } from './full-court-next-game-plan.ts';

afterEach(restoreIndexedDb);

const RUN_ID = idSchema.parse('full-court-next-game-plan');
const OTHER_RUN_ID = idSchema.parse('full-court-next-game-plan-other');
const GAME_ID = 'crl-01-bos-nyk';
const OTHER_GAME_ID = 'crl-02-bos-nyk';

function plan(overrides: Partial<FullCourtNextGamePlan> = {}): FullCourtNextGamePlan {
  const gameId = overrides.gameId ?? GAME_ID;
  const opponentTeamId = overrides.opponentTeamId ?? 'nyk';
  return {
    schemaVersion: FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
    gameId,
    opponentTeamId,
    restingPlayerIds: ['usr-3'],
    defensiveMatchups: {
      gameId,
      opponentTeamId,
      assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-1' }],
    },
    ...overrides,
  };
}

test('saves, overwrites, and isolates per-run next-game plans', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-next-game-plan');
  try {
    const repository = createFullCourtNextGamePlanRepository(first);
    expect(await repository.load(RUN_ID)).toBeNull();

    await repository.save(RUN_ID, plan());
    const other = createFullCourtNextGamePlanRepository(second);
    expect(await other.load(RUN_ID)).toEqual(plan());

    const otherGame = plan({ gameId: OTHER_GAME_ID, restingPlayerIds: ['usr-4'] });
    await other.save(OTHER_RUN_ID, otherGame);
    expect(await repository.load(OTHER_RUN_ID)).toEqual(otherGame);
    expect(await repository.load(RUN_ID)).toEqual(plan());

    const updated = plan({ restingPlayerIds: ['usr-2'] });
    await repository.save(RUN_ID, updated);
    expect(await other.load(RUN_ID)).toEqual(updated);
    expect(await other.load(OTHER_RUN_ID)).toEqual(otherGame);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects an invalid plan without changing the stored plan', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-next-game-plan-invalid');
  try {
    const repository = createFullCourtNextGamePlanRepository(first);
    await repository.save(RUN_ID, plan());
    await expect(
      repository.save(
        RUN_ID,
        plan({
          restingPlayerIds: ['usr-3', 'usr-3'],
        }),
      ),
    ).rejects.toThrow('resting players must be unique');
    expect(await repository.load(RUN_ID)).toEqual(plan());
  } finally {
    first.close();
  }
});

test('clears only the plan whose fixture still matches the requested game id', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-next-game-plan-clear');
  try {
    const repository = createFullCourtNextGamePlanRepository(first);
    const other = createFullCourtNextGamePlanRepository(second);

    await repository.save(RUN_ID, plan());
    const newer = plan({ gameId: OTHER_GAME_ID });
    await other.save(RUN_ID, newer);

    await repository.clear(RUN_ID, GAME_ID);
    expect(await other.load(RUN_ID)).toEqual(newer);

    await repository.clear(RUN_ID, OTHER_GAME_ID);
    expect(await other.load(RUN_ID)).toBeNull();
  } finally {
    first.close();
    second.close();
  }
});

test('clears a run plan without a fixture guard', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-next-game-plan-clear-all');
  try {
    const repository = createFullCourtNextGamePlanRepository(first);
    await repository.save(RUN_ID, plan());
    await repository.clear(RUN_ID);
    expect(await repository.load(RUN_ID)).toBeNull();
  } finally {
    first.close();
  }
});

test('validates stored next-game plan records on read', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-next-game-plan-read');
  try {
    const repository = createFullCourtNextGamePlanRepository(first);
    const stored = fullCourtNextGamePlanRecordSchema.parse({
      saveSchemaVersion: FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
      runId: RUN_ID,
      plan: plan(),
    });

    await first.table('fullCourtNextGamePlans').put({
      ...stored,
      plan: { ...stored.plan, schemaVersion: 2 },
    });
    await expect(repository.load(RUN_ID)).rejects.toThrow('Invalid Full Court next-game plan save');

    await first.table('fullCourtNextGamePlans').put({ ...stored, saveSchemaVersion: 99 });
    await expect(repository.load(RUN_ID)).rejects.toThrow('stored save schema 99');

    await first.fullCourtNextGamePlans.put(stored);
    expect(await repository.load(RUN_ID)).toEqual(plan());
  } finally {
    first.close();
  }
});
