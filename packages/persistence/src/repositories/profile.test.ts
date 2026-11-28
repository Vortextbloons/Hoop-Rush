import { afterEach, describe, expect, test, vi } from 'bun:test';
import {
  PROFILE_SAVE_SCHEMA_VERSION,
  achievementTitleFor,
  profileTitles,
  publicProfileSchema,
} from '@hoop-rush/data-contracts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

afterEach(restoreIndexedDb);

describe('local profiles', () => {
  test('keeps the previous lost room with the successor binding across repository instances', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-rematch'));
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      await repo.bind('draft-duel:previous', 'p2');
      await repo.rememberRematchAfterLoss(
        'draft-duel:previous',
        'draft-duel:next',
        'previous',
        'p2',
      );
      const reloaded = new DexieProfileRepository(db);
      expect(await reloaded.bind('draft-duel:next', 'p2')).toBe(profile.id);
      expect(await reloaded.rematchAfterLoss('draft-duel:next')).toBe('previous');
      expect(await reloaded.rematchAfterLoss('draft-duel:previous')).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test('keeps the first achievement moment when a result is retried or the feat is repeated', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('achievement-moments'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      await repo.initialize(crypto.randomUUID());
      await repo.bind('havoc:run');
      const first = { id: 'wilt-chamberlain-mode' as const, evidence: 'Player scored 101 points' };
      const repeated = { ...first, evidence: 'Player scored 103 points' };
      expect(await repo.awardAchievements('havoc:run', '12', [first, repeated])).toEqual([
        first.id,
      ]);
      expect(await repo.awardAchievements('havoc:run', '12', [repeated])).toEqual([first.id]);
      expect(await repo.awardAchievements('havoc:run', '13', [repeated])).toEqual([]);
      expect(await repo.listUnlocks('havoc:run')).toEqual([first.id]);
      expect((await repo.loadBound('havoc:run'))?.achievementMoments).toEqual([first]);
    } finally {
      db.close();
    }
  });

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

  test('folds a game batch into one profile write and dedupes receipts', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-batch'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      await repo.bind('challenge:season');
      const facts = { won: true, multiplayer: false, players: [] };
      const games = Array.from({ length: 82 }, (_, index) => ({
        gameId: String(index + 1),
        facts,
      }));
      const firstGame = games[0];
      if (firstGame === undefined) throw new Error('Missing test game');
      const put = vi.spyOn(db.profiles, 'put');
      await repo.recordGames('challenge:season', [...games, firstGame]);
      expect(put).toHaveBeenCalledTimes(1);
      put.mockRestore();
      expect((await repo.list()).find((item) => item.id === profile.id)?.games).toBe(82);
      expect(await db.profileGames.count()).toBe(82);
      await repo.recordGames('challenge:season', [firstGame]);
      expect((await repo.list()).find((item) => item.id === profile.id)?.games).toBe(82);
      expect(await db.profileGames.count()).toBe(82);
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

  test('equips a badge title and leaves every other profile field intact', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-equip-title'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      await repo.bind('havoc:title');
      await repo.recordGame('havoc:title', '1', {
        won: true,
        multiplayer: false,
        players: [{ points: 10, assists: 0, steals: 3, blocks: 0 }],
      });
      await repo.awardAchievements('havoc:title', 'title', [
        { id: 'brodie-mode', evidence: 'Recorded a triple-double' },
      ]);
      const before = await repo.loadBound('havoc:title');
      if (!before) throw new Error('Profile is missing');
      const equipped = await repo.equipTitle(profile.id, 'triple-double-machine');
      expect(equipped).toEqual({ ...before, title: 'triple-double-machine' });
      expect(await repo.list()).toEqual([equipped]);
    } finally {
      db.close();
    }
  });

  test('equips only titles unlocked by the matching badge', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('profile-title-locks'));
    await db.open();
    try {
      const repo = new DexieProfileRepository(db);
      const profile = await repo.initialize(crypto.randomUUID());
      await repo.bind('havoc:titles');
      await expect(repo.equipTitle(profile.id, 'century-club')).rejects.toThrow('Title is locked');
      await expect(repo.equipTitle(profile.id, 'defensive-wall')).rejects.toThrow(
        'Title is locked',
      );
      await expect(repo.equipTitle(crypto.randomUUID(), 'none')).rejects.toThrow(
        'Profile not found',
      );
      expect((await repo.loadBound('havoc:titles'))?.title).toBe('none');

      await repo.recordGame('havoc:titles', '1', {
        won: true,
        multiplayer: false,
        players: [{ points: 2, assists: 0, steals: 0, blocks: 3 }],
      });
      expect((await repo.equipTitle(profile.id, 'defensive-wall')).title).toBe('defensive-wall');
      await expect(repo.equipTitle(profile.id, 'floor-general')).rejects.toThrow('Title is locked');
      expect((await repo.equipTitle(profile.id, 'none')).title).toBe('none');
    } finally {
      db.close();
    }
  });

  test('shares badge title names and keeps them on the public profile', () => {
    expect(achievementTitleFor('better-than-73-9')).toBe('the-undefeated');
    expect(achievementTitleFor('brodie-mode')).toBe('triple-double-machine');
    expect(achievementTitleFor('wilt-chamberlain-mode')).toBe('century-club');
    expect(achievementTitleFor('the-reverse-sweep')).toBe('never-out');
    expect(achievementTitleFor('no-easy-buckets')).toBe('defensive-wall');
    expect(achievementTitleFor('silent-carry')).toBe('floor-general');
    expect(achievementTitleFor('welcome')).toBeUndefined();
    expect(profileTitles['triple-double-machine'].name).toBe('Triple-Double Machine');
    expect(
      publicProfileSchema.parse({
        name: 'Player',
        avatar: 'initials',
        border: 'classic',
        nameColor: 'white',
        title: 'century-club',
        featuredAchievement: 'wilt-chamberlain-mode',
        games: 1,
        wins: 1,
        bestStreak: 1,
        participantId: 'p1',
      }).title,
    ).toBe('century-club');
  });
});
