import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeCollectionActiveTeam, prepareCollectionBasicGame } from '@hoop-rush/engine';
import { collectionGameAudit, collectionGameReproduce } from './commands/collection-game.ts';
import { loadCollectionCatalog } from './commands/collection.ts';
import { DEFAULT_MANIFEST, readJsonFile } from './commands/season-data.ts';

describe('collection game commands', () => {
  it('audits cpu legality, completion, accounting, and rewards', () => {
    const report = collectionGameAudit({ manifest: null, games: '8' });
    expect(report.exitCode).toBe(0);
    expect(report.failures).toEqual([]);
    const payload = report.payload as {
      fixedGames: number;
      heldOutGames: number;
      wins: number;
      losses: number;
      shortHandedGames: number;
    };
    expect(payload.fixedGames).toBe(8);
    expect(payload.heldOutGames).toBe(8);
    expect(payload.wins + payload.losses).toBe(16);
    expect(payload.shortHandedGames).toBeGreaterThan(0);
  });

  it('reproduces an embedded prepared game byte-identically', () => {
    const { catalog, catalogHash } = loadCollectionCatalog();
    const manifest = readJsonFile(DEFAULT_MANIFEST) as {
      collection?: { gameRules?: { contentHash?: string } };
      eraSimulationProfiles?: Array<{ eraId?: string; contentHash?: string }>;
    };
    const profileHash = manifest.eraSimulationProfiles?.find(
      (entry) => entry.eraId === '2020s',
    )?.contentHash;
    const rulesHash = manifest.collection?.gameRules?.contentHash;
    if (!profileHash || !rulesHash) throw new Error('missing packaged hashes');
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards
      .filter((_, index) => index % 199 === 0)
      .slice(0, 9)
      .map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    const prepared = prepareCollectionBasicGame({
      collectionId: 'collection-game-test',
      rootSeed: '0'.repeat(32),
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: { Ember: 70, Eruption: 23, Apex: 5, Titan: 1.7, Eclipse: 0.29, Immortal: 0.01 },
      profileVersion: 'm3-2020s-v1',
      profileHash,
      catalogHash,
      rulesHash,
    });
    const dir = mkdtempSync(join(tmpdir(), 'collection-game-'));
    const inputPath = join(dir, 'game.json');
    writeFileSync(
      inputPath,
      `${JSON.stringify({ schemaVersion: 1, command: 'collection game-reproduce', prepared })}\n`,
    );
    const report = collectionGameReproduce({ input: inputPath, manifest: null });
    expect(report.failures).toEqual([]);
    const payload = report.payload as {
      ok: boolean;
      gameId: string;
      rewardAmount: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.gameId).toBe(prepared.gameId);
    expect([100, 10]).toContain(payload.rewardAmount);
  });

  it('rejects a reproduce input with a mismatched catalog hash', () => {
    const { catalog } = loadCollectionCatalog();
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards
      .filter((_, index) => index % 199 === 0)
      .slice(0, 9)
      .map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    const prepared = prepareCollectionBasicGame({
      collectionId: 'collection-game-test',
      rootSeed: '0'.repeat(32),
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: { Ember: 70, Eruption: 23, Apex: 5, Titan: 1.7, Eclipse: 0.29, Immortal: 0.01 },
      profileVersion: 'm3-2020s-v1',
      profileHash: '0'.repeat(64),
      catalogHash: '0'.repeat(64),
      rulesHash: '0'.repeat(64),
    });
    const dir = mkdtempSync(join(tmpdir(), 'collection-game-'));
    const inputPath = join(dir, 'game.json');
    writeFileSync(
      inputPath,
      `${JSON.stringify({ schemaVersion: 1, command: 'collection game-reproduce', prepared })}\n`,
    );
    const report = collectionGameReproduce({ input: inputPath, manifest: null });
    expect(report.failures.length).toBeGreaterThan(0);
  });
});
