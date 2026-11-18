import { afterEach, describe, expect, it } from 'bun:test';
import { DexieFixedFiveRepository } from './fixed-five.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

afterEach(restoreIndexedDb);

describe('DexieFixedFiveRepository', () => {
  it('records career progress and achievement evidence in one transaction', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('fixed-five-career'));
    const repo = new DexieFixedFiveRepository(db);
    const profiles = new DexieProfileRepository(db);
    await profiles.initialize(crypto.randomUUID());
    const bindingId = 'fixed-five:room';
    await profiles.bind(bindingId, 'p2');
    const splash = {
      id: 'the-splash-brothers' as const,
      evidence: 'completed an 82-0 shared season with another player',
    };
    await repo.recordCareer(
      bindingId,
      [{ gameId: '1', facts: { won: true, multiplayer: true, players: [] } }],
      true,
      'career',
      [splash],
    );
    expect(await profiles.listUnlocks(bindingId)).toContain(splash.id);
    const profile = await profiles.loadBound(bindingId);
    expect(profile?.games).toBe(1);
    expect(profile?.wins).toBe(1);
    expect(profile?.achievementMoments).toEqual([splash]);
    db.close();
  });
});
