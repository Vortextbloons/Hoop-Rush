import { afterEach, describe, expect, it } from 'vitest';
import { buildChallengeRun, buildGameSimulationInput } from '@hoop-rush/test-fixtures';
import {
  acceptGameResult,
  createEngineContext,
  createGameInput,
  simulateGame,
} from '@hoop-rush/engine';
import { storedRunRecordSchema } from '../schemas/run-record.ts';
import { DexieChallengeRepository } from './dexie.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';
import { challengeRunProgressDigest } from './dexie.ts';

describe('dexie active run save/load round-trip', () => {
  afterEach(restoreIndexedDb);

  it('preserves accepted games across save and load', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('dexie-active-roundtrip'));
    const repo = new DexieChallengeRepository(db);
    const context = createEngineContext();
    const profile = buildGameSimulationInput().profile;
    const fixture = buildChallengeRun({ runId: 'roundtrip-run' });
    const base = {
      ...fixture,
      versions: { ...fixture.versions, engineVersion: context.engineVersion },
    };
    const input1 = createGameInput(base, profile, 1);
    const run1 = acceptGameResult(base, simulateGame(input1, context));
    const input2 = createGameInput(run1, profile, 2);
    const run2 = acceptGameResult(run1, simulateGame(input2, context));
    expect(run2.games).toHaveLength(2);
    const record = storedRunRecordSchema.parse({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: run2,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    await repo.saveActiveRun(record);

    const loaded = await repo.loadActiveRun();
    expect(loaded).not.toBeNull();
    expect(loaded?.run.runId).toBe('roundtrip-run');
    expect(loaded?.run.games).toHaveLength(2);
    expect(loaded?.run.games.map((g) => g.gameNumber)).toEqual([1, 2]);
    expect(loaded?.run.aggregates).toEqual(record.run.aggregates);
    expect(loaded?.run.games).toEqual(record.run.games);
    expect(challengeRunProgressDigest(loaded?.run ?? record.run)).toBe(
      challengeRunProgressDigest(record.run),
    );
    const reloaded = await repo.loadActiveRun();
    expect(challengeRunProgressDigest(reloaded?.run ?? record.run)).toBe(
      challengeRunProgressDigest(record.run),
    );
  });

  it('re-saving a fresh run clears previously stored games', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('dexie-active-overwrite'));
    const repo = new DexieChallengeRepository(db);
    const context = createEngineContext();
    const profile = buildGameSimulationInput().profile;
    const fixtureBase = buildChallengeRun({ runId: 'overwrite-run' });
    const base = {
      ...fixtureBase,
      versions: { ...fixtureBase.versions, engineVersion: context.engineVersion },
    };
    const input = createGameInput(base, profile, 1);
    const withGame = acceptGameResult(base, simulateGame(input, context));
    await repo.saveActiveRun({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: withGame,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect((await repo.loadActiveRun())?.run.games).toHaveLength(1);

    const fresh = buildChallengeRun({ runId: 'overwrite-run' });
    await repo.saveActiveRun({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: fresh,
      updatedAtIso: '2026-01-02T00:00:00.000Z',
    });
    const reloaded = await repo.loadActiveRun();
    expect(reloaded?.run.games).toHaveLength(0);
    expect(await db.activeGames.count()).toBe(0);
  });
});
