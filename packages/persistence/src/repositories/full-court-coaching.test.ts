import { afterEach, expect, test } from 'bun:test';
import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  fullCourtCoachingPlanSchema,
  idSchema,
  type FullCourtCoachingPlan,
} from '@hoop-rush/data-contracts';
import { fullCourtCoachingRecordSchema } from '../schemas/full-court-coaching-record.ts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtCoachingRepository } from './full-court-coaching.ts';

afterEach(restoreIndexedDb);

const RUN_ID = idSchema.parse('full-court-coaching');
const OTHER_RUN_ID = idSchema.parse('full-court-coaching-other');

const CUSTOM_PLAN: FullCourtCoachingPlan = fullCourtCoachingPlanSchema.parse({
  schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
  tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
  rotation: {
    startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
    minuteTargets: { p1: 40, p2: 40, p3: 40, p4: 40, p5: 40, p6: 40 },
    closingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
  },
  units: [{ name: 'Bench Mob', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] }],
});

test('saves, overwrites, and isolates per-run coaching plans', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-coaching');
  try {
    const repository = createFullCourtCoachingRepository(first);
    expect(await repository.load(RUN_ID)).toBeNull();

    await repository.save(RUN_ID, FULL_COURT_DEFAULT_COACHING_PLAN);
    const other = createFullCourtCoachingRepository(second);
    expect(await other.load(RUN_ID)).toEqual(FULL_COURT_DEFAULT_COACHING_PLAN);

    await other.save(OTHER_RUN_ID, CUSTOM_PLAN);
    expect(await repository.load(OTHER_RUN_ID)).toEqual(CUSTOM_PLAN);
    expect(await repository.load(RUN_ID)).toEqual(FULL_COURT_DEFAULT_COACHING_PLAN);

    const updated = fullCourtCoachingPlanSchema.parse({
      schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
      tactics: { pace: 'slow', offense: 'interior', defense: 'protect-paint' },
    });
    await repository.save(RUN_ID, updated);
    expect(await other.load(RUN_ID)).toEqual(updated);
    expect(await repository.load(OTHER_RUN_ID)).toEqual(CUSTOM_PLAN);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects an invalid plan without changing the stored plan', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-coaching-invalid');
  try {
    const repository = createFullCourtCoachingRepository(first);
    await repository.save(RUN_ID, CUSTOM_PLAN);
    const invalid = {
      ...CUSTOM_PLAN,
      rotation: {
        ...CUSTOM_PLAN.rotation,
        minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48, p5: 47 },
      },
    } as unknown as FullCourtCoachingPlan;
    await expect(repository.save(RUN_ID, invalid)).rejects.toThrow('minute targets must total 240');
    expect(await repository.load(RUN_ID)).toEqual(CUSTOM_PLAN);
  } finally {
    first.close();
  }
});

test('rejects duplicate named units without changing the stored plan', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-coaching-unit-invalid');
  try {
    const repository = createFullCourtCoachingRepository(first);
    await repository.save(RUN_ID, CUSTOM_PLAN);
    const invalid = {
      ...CUSTOM_PLAN,
      units: [
        { name: 'Bench Mob', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] },
        { name: ' bench mob ', playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'] },
      ],
    } as unknown as FullCourtCoachingPlan;
    await expect(repository.save(RUN_ID, invalid)).rejects.toThrow(
      'named unit names must be unique',
    );
    expect(await repository.load(RUN_ID)).toEqual(CUSTOM_PLAN);
  } finally {
    first.close();
  }
});

test('validates stored coaching records on read', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-coaching-read');
  try {
    const repository = createFullCourtCoachingRepository(first);
    const stored = fullCourtCoachingRecordSchema.parse({
      saveSchemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
      runId: RUN_ID,
      plan: CUSTOM_PLAN,
    });

    await first.table('fullCourtCoaching').put({
      ...stored,
      plan: { ...stored.plan, schemaVersion: 2 },
    });
    await expect(repository.load(RUN_ID)).rejects.toThrow('Invalid Full Court coaching save');

    await first.table('fullCourtCoaching').put({ ...stored, saveSchemaVersion: 99 });
    await expect(repository.load(RUN_ID)).rejects.toThrow('stored save schema 99');

    await first.fullCourtCoaching.put(stored);
    expect(await repository.load(RUN_ID)).toEqual(CUSTOM_PLAN);
  } finally {
    first.close();
  }
});
