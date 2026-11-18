import { afterEach, describe, expect, it } from 'bun:test';
import { buildChallengeRun, buildGameSimulationInput } from '@hoop-rush/test-fixtures';
import {
  acceptGameResult,
  challengeRunProgressDigest,
  createEngineContext,
  createGameInput,
  simulateGame,
} from '@hoop-rush/engine';
import { storedRunRecordSchema } from '../schemas/run-record.ts';
import { DexieChallengeRepository } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

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

  it('commits an ordered game batch and its checkpoint in one transaction', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('dexie-active-batch'));
    const repo = new DexieChallengeRepository(db);
    const context = createEngineContext();
    const profile = buildGameSimulationInput().profile;
    const fixture = buildChallengeRun({ runId: 'batch-run' });
    const base = {
      ...fixture,
      versions: { ...fixture.versions, engineVersion: context.engineVersion },
    };
    await repo.saveActiveRun({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: base,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const appends = [];
    let current = base;
    for (let gameNumber = 1; gameNumber <= 3; gameNumber += 1) {
      const result = simulateGame(createGameInput(current, profile, gameNumber), context);
      current = acceptGameResult(current, result);
      appends.push({
        runId: current.runId,
        gameNumber,
        result,
        aggregates: current.aggregates,
        status: current.status === 'finished' ? ('finished' as const) : ('active' as const),
        firstLossGameNumber: current.firstLossGameNumber,
      });
    }
    await repo.appendActiveGames(appends);
    const loaded = await repo.loadActiveRun();
    expect(loaded?.run.games.map((game) => game.gameNumber)).toEqual([1, 2, 3]);
    expect(loaded?.run.aggregates).toEqual(current.aggregates);
    expect((await db.active.get('active'))?.gamesPlayed).toBe(3);
  });

  it('rejects an out-of-order batch without writing any game rows', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('dexie-active-batch-order'));
    const repo = new DexieChallengeRepository(db);
    const context = createEngineContext();
    const profile = buildGameSimulationInput().profile;
    const fixture = buildChallengeRun({ runId: 'batch-order-run' });
    const base = {
      ...fixture,
      versions: { ...fixture.versions, engineVersion: context.engineVersion },
    };
    await repo.saveActiveRun({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: base,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const second = acceptGameResult(
      acceptGameResult(base, simulateGame(createGameInput(base, profile, 1), context)),
      simulateGame(createGameInput(base, profile, 2), context),
    );
    const secondGame = second.games[1];
    if (secondGame === undefined) throw new Error('missing second fixture game');
    const outOfOrder = [
      {
        runId: second.runId,
        gameNumber: 2,
        result: secondGame,
        aggregates: second.aggregates,
        status: 'active' as const,
        firstLossGameNumber: second.firstLossGameNumber,
      },
    ];
    await expect(repo.appendActiveGames(outOfOrder)).rejects.toThrow('out of order');
    expect(await db.activeGames.count()).toBe(0);
    expect((await repo.loadActiveRun())?.run.games).toHaveLength(0);
  });

  it('records a season achievement when promoting the accepted result', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('dexie-season-achievement'));
    try {
      const repo = new DexieChallengeRepository(db);
      const profiles = new DexieProfileRepository(db);
      const context = createEngineContext();
      const base = buildChallengeRun({
        runId: 'perfect-classic',
        mode: 'classic',
        variant: 'ratings',
      });
      const game = simulateGame(buildGameSimulationInput(), context);
      const run = buildChallengeRun({
        ...base,
        status: 'finished',
        outcome: 'perfect',
        games: Array.from({ length: 82 }, (_, i) => ({
          ...game,
          gameNumber: i + 1,
          winner: 'home',
        })),
        aggregates: {
          ...base.aggregates,
          team: { ...base.aggregates.team, wins: 82, gamesPlayed: 82 },
        },
      });
      const bindingId = `challenge:${run.runId}`;
      await profiles.initialize(crypto.randomUUID());
      await profiles.bind(bindingId);
      const record = storedRunRecordSchema.parse({
        recordId: 'active',
        saveSchemaVersion: 2,
        run,
      });
      await repo.saveActiveRun(record);
      expect(await profiles.listUnlocks(bindingId)).toEqual([]);
      await repo.promoteActiveToCompleted(
        record,
        {
          recordId: run.runId,
          runId: run.runId,
          mode: run.mode,
          franchiseId: run.franchiseId,
          eraId: run.eraId,
          playerIds: run.playerIds,
          runSeed: run.runSeed,
          wins: 82,
          losses: 0,
          gamesPlayed: 82,
          outcome: 'perfect',
          completedAtIso: '2026-01-01T00:00:00.000Z',
        },
        { expectedGamesPlayed: 82, expectedRunDigest: challengeRunProgressDigest(run) },
      );
      expect(await profiles.listAchievementReveals(bindingId)).toContainEqual({
        id: 'better-than-73-9',
        evidence: '82-0 season',
      });
    } finally {
      db.close();
    }
  });
});
