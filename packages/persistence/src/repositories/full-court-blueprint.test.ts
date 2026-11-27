import { afterEach, expect, test } from 'bun:test';
import {
  FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
  fullCourtBlueprintSchema,
  type FullCourtBlueprint,
} from '@hoop-rush/data-contracts';
import { fullCourtBlueprintRecordSchema } from '../schemas/full-court-blueprint-record.ts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtBlueprintRepository } from './full-court-blueprint.ts';

afterEach(restoreIndexedDb);

function makeBlueprint(
  name: string,
  tactics: FullCourtBlueprint['tactics'] = {
    pace: 'fast',
    offense: 'perimeter',
    defense: 'pressure',
  },
): FullCourtBlueprint {
  return fullCourtBlueprintSchema.parse({
    schemaVersion: 1,
    name,
    tactics,
  });
}

test('creates, lists in stable normalized key order, and removes blueprints', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-blueprints');
  try {
    const repository = createFullCourtBlueprintRepository(first);
    const other = createFullCourtBlueprintRepository(second);

    expect(await repository.list()).toEqual([]);

    const zebra = makeBlueprint('Zebra', {
      pace: 'slow',
      offense: 'interior',
      defense: 'protect-paint',
    });
    const beta = makeBlueprint('Beta', {
      pace: 'balanced',
      offense: 'ball-movement',
      defense: 'balanced',
    });
    const alpha = makeBlueprint('alpha');
    const aardvark = makeBlueprint('  aardvark  ');

    await repository.create(zebra);
    await repository.create(beta);
    await other.create(alpha);
    await other.create(aardvark);

    expect(await other.list()).toEqual([aardvark, alpha, beta, zebra]);

    await repository.remove('  BETA  ');
    expect(await other.list()).toEqual([aardvark, alpha, zebra]);

    await repository.remove('missing');
    await repository.remove('   ');
    expect(await repository.list()).toEqual([aardvark, alpha, zebra]);

    const recreatedBeta = makeBlueprint('BETA', {
      pace: 'fast',
      offense: 'ball-movement',
      defense: 'pressure',
    });
    await repository.create(recreatedBeta);
    expect(await other.list()).toEqual([aardvark, alpha, recreatedBeta, zebra]);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects trimmed, NFC, and case-insensitive duplicates without overwriting', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-blueprint-duplicate');
  try {
    const repository = createFullCourtBlueprintRepository(first);
    const original = makeBlueprint('  Pace\u0301 & Space  ', {
      pace: 'fast',
      offense: 'perimeter',
      defense: 'pressure',
    });
    await repository.create(original);

    const conflicting = makeBlueprint('PACÉ & SPACE', {
      pace: 'slow',
      offense: 'interior',
      defense: 'protect-paint',
    });
    await expect(repository.create(conflicting)).rejects.toThrow(
      'A saved strategy named "PACÉ & SPACE" already exists.',
    );
    expect(await repository.list()).toEqual([original]);
  } finally {
    first.close();
  }
});

test('rejects concurrent case-insensitive duplicates across connections without overwriting', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-blueprint-concurrent');
  try {
    const firstRepo = createFullCourtBlueprintRepository(first);
    const secondRepo = createFullCourtBlueprintRepository(second);

    const firstBlueprint = makeBlueprint('Zone Press', {
      pace: 'fast',
      offense: 'ball-movement',
      defense: 'pressure',
    });
    const secondBlueprint = makeBlueprint('  zone press  ', {
      pace: 'slow',
      offense: 'interior',
      defense: 'protect-paint',
    });

    const results = await Promise.allSettled([
      firstRepo.create(firstBlueprint),
      secondRepo.create(secondBlueprint),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(((rejected[0] as PromiseRejectedResult).reason as Error).message).toContain(
      'already exists',
    );

    const expectedWinner = results[0].status === 'fulfilled' ? firstBlueprint : secondBlueprint;
    expect(await firstRepo.list()).toEqual([expectedWinner]);
    expect(await secondRepo.list()).toEqual([expectedWinner]);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects invalid blueprint input without modifying stored blueprints', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-blueprint-invalid');
  try {
    const repository = createFullCourtBlueprintRepository(first);
    const saved = makeBlueprint('Motion');
    await repository.create(saved);

    await expect(repository.create(makeBlueprint('Motion'))).rejects.toThrow('already exists');
    await expect(
      repository.create({
        schemaVersion: 1,
        name: '   ',
        tactics: saved.tactics,
      }),
    ).rejects.toThrow();
    await expect(
      repository.create({
        schemaVersion: 2,
        name: 'Valid Name',
        tactics: saved.tactics,
      } as unknown as FullCourtBlueprint),
    ).rejects.toThrow();

    expect(await repository.list()).toEqual([saved]);
  } finally {
    first.close();
  }
});

test('validates stored blueprint records on read for schema and key match', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-blueprint-read');
  try {
    const repository = createFullCourtBlueprintRepository(first);
    const blueprint = makeBlueprint('Motion');
    const stored = fullCourtBlueprintRecordSchema.parse({
      saveSchemaVersion: FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
      key: 'motion',
      blueprint,
    });

    await first.table('fullCourtBlueprints').put({
      ...stored,
      key: 'wrong-key',
    });
    await expect(repository.list()).rejects.toThrow('blueprint key mismatch');
    await first.table('fullCourtBlueprints').clear();

    await first.table('fullCourtBlueprints').put({
      ...stored,
      key: 'Motion',
    });
    await expect(repository.list()).rejects.toThrow('blueprint key mismatch');
    await first.table('fullCourtBlueprints').clear();

    await first.table('fullCourtBlueprints').put({
      ...stored,
      saveSchemaVersion: 99,
    });
    await expect(repository.list()).rejects.toThrow('stored save schema 99');
    await first.table('fullCourtBlueprints').clear();

    await first.table('fullCourtBlueprints').put({
      ...stored,
      blueprint: { ...stored.blueprint, schemaVersion: 2 },
    });
    await expect(repository.list()).rejects.toThrow('Invalid Full Court blueprint save');
    await first.table('fullCourtBlueprints').clear();

    await first.fullCourtBlueprints.put(stored);
    expect(await repository.list()).toEqual([blueprint]);
  } finally {
    first.close();
  }
});

test('stores portable scoring roles, rejects pinned player IDs, and keeps v21/v22 tactics-only rows', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-blueprint-roles');
  try {
    const repository = createFullCourtBlueprintRepository(first);
    const other = createFullCourtBlueprintRepository(second);

    // Legacy v21/v22 tactics-only row stored directly in IndexedDB.
    await first.table('fullCourtBlueprints').put({
      saveSchemaVersion: 1,
      key: 'legacy pace',
      blueprint: {
        schemaVersion: 1,
        name: 'Legacy Pace',
        tactics: { pace: 'fast', offense: 'perimeter', defense: 'balanced' },
      },
    });

    const withRoles = fullCourtBlueprintSchema.parse({
      schemaVersion: 1,
      name: '  Motion Wing  ',
      tactics: { pace: 'balanced', offense: 'ball-movement', defense: 'pressure' },
      hierarchy: {
        primary: {
          kind: 'starter-slot',
          slot: 2,
          preferredPositions: ['SF', 'SG'],
          archetype: 'primaryCreator',
        },
        secondary: {
          kind: 'bench-slot',
          benchIndex: 0,
          preferredPositions: ['SG'],
          archetype: 'floorSpacer',
        },
        floorGeneral: {
          kind: 'role-fit',
          preferredPositions: ['PG'],
          archetype: 'primaryCreator',
        },
      },
    });
    await repository.create(withRoles);

    expect(await other.list()).toEqual([
      {
        schemaVersion: 1,
        name: 'Legacy Pace',
        tactics: { pace: 'fast', offense: 'perimeter', defense: 'balanced' },
      },
      withRoles,
    ]);

    // Never overwrite an existing tactics-only name with a new role blueprint.
    await expect(
      repository.create({
        ...withRoles,
        name: 'LEGACY PACE',
      }),
    ).rejects.toThrow('already exists');

    // Reject pinned run IDs inside blueprint hierarchy.
    await expect(
      repository.create({
        schemaVersion: 1,
        name: 'Pinned Run ID',
        tactics: withRoles.tactics,
        hierarchy: { primaryPlayerId: 'p1' },
      } as unknown as FullCourtBlueprint),
    ).rejects.toThrow();
  } finally {
    first.close();
    second.close();
  }
});
