import { afterEach, describe, expect, test } from 'bun:test';
import { PROFILE_SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

afterEach(restoreIndexedDb);

describe('local profiles', () => {
  test('retains the selected career and archives other profiles and their runs', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-migration'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const selected = await repo.initialize(crypto.randomUUID());
      const other = { ...selected, id: crypto.randomUUID(), name: 'Other', games: 4 };
      await db.profiles.add(other);
      await db.profileBindings.add({
        saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
        id: 'challenge:old',
        profileId: other.id,
      });
      await db.profileGames.add({
        saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
        id: 'challenge:old:1',
        profileId: other.id,
        unlocked: ['welcome'],
      });
      expect(await repo.initialize(crypto.randomUUID())).toEqual(selected);
      expect(await repo.list()).toEqual([selected]);
      expect(await db.archivedProfiles.get(other.id)).toEqual(other);
      expect(await repo.loadBound('challenge:old')).toBeNull();
      expect(await repo.listUnlocks('challenge:old')).toEqual([]);
      expect(
        await repo.recordGame('challenge:old', '2', { won: true, multiplayer: false, players: [] }),
      ).toEqual([]);
      expect(await repo.recordMatch('challenge:old', true)).toEqual([]);
      expect(await repo.initialize(crypto.randomUUID())).toEqual(selected);
      expect(await repo.list()).toEqual([selected]);
    } finally {
      db.close();
    }
  });
  test('rolls back the entire completed match if a game receipt is invalid', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-match-rollback'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      await repo.bind('fixed-five:room');
      const facts = { won: true, multiplayer: true, players: [] };
      await expect(
        repo.recordCompletedMatch(
          'fixed-five:room',
          [
            { gameId: '1', facts },
            { gameId: 'x'.repeat(160), facts },
          ],
          true,
        ),
      ).rejects.toThrow();
      const saved = (await repo.list()).find((item) => item.id === profile.id);
      expect(saved?.games).toBe(0);
      expect(saved?.multiplayerStreak).toBe(0);
      expect(await repo.listUnlocks('fixed-five:room')).toEqual([]);
    } finally {
      db.close();
    }
  });
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
  test('reuses the local profile and counts each accepted game once', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const first = await repo.initialize(crypto.randomUUID());
      await repo.bind('challenge:run');
      expect((await repo.initialize(crypto.randomUUID())).id).toBe(first.id);
      const facts = {
        won: true,
        multiplayer: false,
        players: [{ points: 10, assists: 0, steals: 3, blocks: 0 }],
      };
      expect(await repo.recordGame('challenge:run', '1', facts)).toEqual(['welcome', 'hands-off']);
      expect(await repo.recordGame('challenge:run', '1', facts)).toEqual(['welcome', 'hands-off']);
      const profiles = await repo.list();
      expect(profiles.find((item) => item.id === first.id)?.games).toBe(1);
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
        repo.dispatch({
          kind: 'customize',
          id: profile.id,
          name: 'ab',
          avatar: 'initials',
          border: 'classic',
          nameColor: 'white',
          title: 'none',
          featuredAchievement: null,
        }),
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
