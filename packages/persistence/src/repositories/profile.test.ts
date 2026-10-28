import { afterEach, describe, expect, test } from 'bun:test';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

afterEach(restoreIndexedDb);

describe('local profiles', () => {
  test('unlocks built different after five consecutive multiplayer series wins', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-matches'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      for (let match = 1; match <= 5; match += 1) {
        const id = `draft-duel:${String(match)}`;
        await repo.bind(id);
        const unlocked = await repo.recordMatch(id, true);
        expect(unlocked).toEqual(match === 5 ? ['built-different'] : []);
        expect(await repo.recordMatch(id, true)).toEqual(unlocked);
      }
      const saved = (await repo.list()).find((item) => item.id === profile.id);
      expect(saved?.multiplayerStreak).toBe(5);
      expect(saved?.achievements).toContain('built-different');
    } finally {
      db.close();
    }
  });
  test('binds a run to its original profile and counts each accepted game once', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const first = await repo.initialize(crypto.randomUUID());
      await repo.bind('challenge:run');
      const second = await repo.dispatch({
        kind: 'create',
        id: crypto.randomUUID(),
        name: 'Second',
      });
      const facts = {
        won: true,
        multiplayer: false,
        players: [{ points: 10, assists: 0, steals: 3, blocks: 0 }],
      };
      expect(await repo.recordGame('challenge:run', '1', facts)).toEqual(['welcome', 'hands-off']);
      expect(await repo.recordGame('challenge:run', '1', facts)).toEqual(['welcome', 'hands-off']);
      const profiles = await repo.list();
      expect(profiles.find((item) => item.id === first.id)?.games).toBe(1);
      expect(profiles.find((item) => item.id === second.id)?.games).toBe(0);
      expect(await repo.bind('challenge:run')).toBe(first.id);
    } finally {
      db.close();
    }
  });

  test('rejects locked customization and invalid names', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      await expect(
        repo.dispatch({ kind: 'create', id: crypto.randomUUID(), name: 'ab' }),
      ).rejects.toThrow();
      await expect(
        repo.dispatch({
          kind: 'customize',
          id: profile.id,
          name: profile.name,
          avatar: 'crown',
          border: 'classic',
          nameColor: 'white',
          title: 'none',
          featuredAchievement: null,
        }),
      ).rejects.toThrow('Cosmetic is locked');
    } finally {
      db.close();
    }
  });
});
