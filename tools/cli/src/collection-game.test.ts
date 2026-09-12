import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLLECTION_OBJECTIVE_IDS } from '@hoop-rush/data-contracts';
import {
  collectionObjectiveDefinitionsFromRules,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGame,
  prepareCollectionBasicGameV2,
} from '@hoop-rush/engine';
import {
  collectionGameAudit,
  collectionGameReproduce,
  loadCollectionGameRules,
} from './commands/collection-game.ts';
import { collectionGameCalibrate } from './commands/collection-game-calibrate.ts';
import { loadCollectionCatalog } from './commands/collection.ts';
import { buildCollectionLaunchDifficultyProfiles } from './collection-game-constants.ts';
import { DEFAULT_MANIFEST, readJsonFile } from './commands/season-data.ts';

const LEGACY_WEIGHTS = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};

function packagedHashes(): {
  catalogHash: string;
  profileHash: string;
  profileVersion: string;
  rulesHash: string;
} {
  const manifest = readJsonFile(DEFAULT_MANIFEST) as {
    collection?: { gameRules?: { contentHash?: string } };
    eraSimulationProfiles?: Array<{ eraId?: string; contentHash?: string }>;
  };
  const profileRef = manifest.eraSimulationProfiles?.find((entry) => entry.eraId === '2020s');
  const rulesHash = manifest.collection?.gameRules?.contentHash;
  if (!profileRef?.contentHash || !rulesHash) throw new Error('missing packaged hashes');
  return {
    catalogHash: loadCollectionCatalog().catalogHash,
    profileHash: profileRef.contentHash,
    profileVersion: 'm3-2020s-v1',
    rulesHash,
  };
}

function ownedSpread(catalog: ReturnType<typeof loadCollectionCatalog>['catalog'], step: number) {
  return catalog.cards
    .filter((_, index) => index % step === 0)
    .slice(0, 9)
    .map((card) => card.cardId);
}

function buildV1Prepared() {
  const { catalog, catalogHash } = loadCollectionCatalog();
  const { profileHash, profileVersion, rulesHash } = packagedHashes();
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const owned = ownedSpread(catalog, 199);
  const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
  const prepared = prepareCollectionBasicGame({
    collectionId: 'collection-game-test',
    rootSeed: '0'.repeat(32),
    gameSequence: 0,
    ownedCardIds: new Set(owned),
    team,
    catalog,
    cpuWeights: LEGACY_WEIGHTS,
    profileVersion,
    profileHash,
    catalogHash,
    rulesHash,
  });
  return { prepared, catalog };
}

function buildV2Prepared(difficultyId: 'street' | 'pro' | 'legend' = 'street') {
  const { catalog, catalogHash } = loadCollectionCatalog();
  const { profileHash, profileVersion, rulesHash } = packagedHashes();
  const { rules } = loadCollectionGameRules(DEFAULT_MANIFEST);
  const difficulty = rules.difficulties.find((entry) => entry.difficultyId === difficultyId);
  if (difficulty === undefined) throw new Error(`missing difficulty ${difficultyId}`);
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const owned = ownedSpread(catalog, 199);
  const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
  const prepared = prepareCollectionBasicGameV2({
    collectionId: 'collection-game-test',
    rootSeed: '0'.repeat(32),
    gameSequence: 0,
    ownedCardIds: new Set(owned),
    team,
    catalog,
    difficulty,
    objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
    selectedObjectiveId: null,
    clearedDifficultyIds: [],
    profileVersion,
    profileHash,
    catalogHash,
    rulesHash,
  });
  return { prepared, catalog, rules };
}

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
      v1Reproductions: number;
      v2Reproductions: number;
      selectionInvariantGames: number;
      deterministicIds: number;
      adjustmentChecks: number;
      rewardChecks: number;
      difficulties: Array<{
        difficultyId: string;
        games: number;
        cpuSequences: number;
        meanRosterScoreMillionths: number;
        meanSpecialCount: number;
      }>;
      objectives: Array<{
        objectiveId: string;
        offered: number;
        selected: number;
        evaluated: number;
        successes: number;
        minActualValue: number | null;
        maxActualValue: number | null;
      }>;
    };
    expect(payload.fixedGames).toBe(8);
    expect(payload.heldOutGames).toBe(8);
    expect(payload.wins + payload.losses).toBe(16);
    expect(payload.shortHandedGames).toBeGreaterThan(0);
    expect(payload.v1Reproductions).toBe(16);
    expect(payload.v2Reproductions).toBeGreaterThan(0);
    expect(payload.selectionInvariantGames).toBeGreaterThan(0);
    expect(payload.deterministicIds).toBe(payload.v2Reproductions);
    expect(payload.adjustmentChecks).toBe(payload.v2Reproductions);
    expect(payload.rewardChecks).toBe(payload.v2Reproductions);
    expect(payload.difficulties.map((entry) => entry.difficultyId)).toEqual([
      'street',
      'pro',
      'legend',
    ]);
    for (const difficulty of payload.difficulties) {
      expect(difficulty.games).toBeGreaterThan(0);
      expect(difficulty.cpuSequences).toBeGreaterThanOrEqual(difficulty.games);
    }
    const ordered = [...payload.difficulties].sort(
      (left, right) => left.meanRosterScoreMillionths - right.meanRosterScoreMillionths,
    );
    expect(ordered.map((entry) => entry.difficultyId)).toEqual(['street', 'pro', 'legend']);
    expect(payload.objectives.map((entry) => entry.objectiveId)).toEqual([
      ...COLLECTION_OBJECTIVE_IDS,
    ]);
    for (const objective of payload.objectives) {
      expect(objective.offered).toBeGreaterThan(0);
      expect(objective.selected).toBeGreaterThan(0);
      expect(objective.evaluated).toBeGreaterThan(0);
      expect(objective.minActualValue).not.toBeNull();
      expect(objective.maxActualValue).not.toBeNull();
    }
  });

  it('reproduces an embedded v1 prepared game byte-identically', () => {
    const { prepared } = buildV1Prepared();
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
      gameVersion: string;
      rewardAmount: number;
      rewardTotal: number;
      rewardTransactionId: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.gameId).toBe(prepared.gameId);
    expect(payload.gameVersion).toBe('collection-game-v1');
    expect([100, 10]).toContain(payload.rewardAmount);
    expect(payload.rewardTotal).toBe(payload.rewardAmount);
    expect(payload.rewardTransactionId).toMatch(/^txn-[0-9a-f]{32}$/);
  });

  it('reproduces a v2 prepared game with objective and reward facts', () => {
    const { prepared } = buildV2Prepared('street');
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
      gameVersion: string;
      difficultyId: string | null;
      objectiveSuccess: boolean | null;
      rewardAmount: number;
      rewardTotal: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.gameId).toBe(prepared.gameId);
    expect(payload.gameVersion).toBe('collection-game-v2');
    expect(payload.difficultyId).toBe('street');
    expect(payload.objectiveSuccess).toBeNull();
    expect(payload.rewardAmount).toBeGreaterThan(0);
    expect(payload.rewardTotal).toBeGreaterThanOrEqual(payload.rewardAmount);
  });

  it('rejects a tampered v2 prepared input digest', () => {
    const { prepared } = buildV2Prepared('pro');
    const tampered = { ...prepared, inputDigest: 'f'.repeat(32) };
    const dir = mkdtempSync(join(tmpdir(), 'collection-game-'));
    const inputPath = join(dir, 'game.json');
    writeFileSync(
      inputPath,
      `${JSON.stringify({ schemaVersion: 1, command: 'collection game-reproduce', prepared: tampered })}\n`,
    );
    const report = collectionGameReproduce({ input: inputPath, manifest: null });
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.exitCode).toBe(2);
  });

  it('rejects a reproduce input with a mismatched catalog hash', () => {
    const { prepared, catalog } = buildV1Prepared();
    void catalog;
    const tampered = { ...prepared, catalogHash: '0'.repeat(64) };
    const dir = mkdtempSync(join(tmpdir(), 'collection-game-'));
    const inputPath = join(dir, 'game.json');
    writeFileSync(
      inputPath,
      `${JSON.stringify({ schemaVersion: 1, command: 'collection game-reproduce', prepared: tampered })}\n`,
    );
    const report = collectionGameReproduce({ input: inputPath, manifest: null });
    expect(report.failures.length).toBeGreaterThan(0);
  });

  it('keeps the launch difficulty mirror in sync with the engine fixtures', () => {
    const profiles = buildCollectionLaunchDifficultyProfiles();
    expect(profiles.map((profile) => profile.difficultyId)).toEqual(['street', 'pro', 'legend']);
    expect(profiles.map((profile) => profile.ratingShift)).toEqual([-2, 0, 2]);
    expect(profiles.map((profile) => profile.rewardMultiplierBp)).toEqual([10_000, 13_500, 17_500]);
    expect(profiles.map((profile) => profile.candidateTeams)).toEqual([1, 4, 8]);
  });

  it('projects the calibration scaffold deterministically across worker counts', async () => {
    const one = await collectionGameCalibrate({
      workers: '1',
      calibrationSeeds: '2',
      validationSeeds: '1',
    });
    const four = await collectionGameCalibrate({
      workers: '4',
      calibrationSeeds: '2',
      validationSeeds: '1',
    });
    expect(one.failures).toEqual([]);
    expect(four.failures).toEqual([]);
    const onePayload = one.payload as {
      status: string;
      projection: unknown;
      gates: Record<string, boolean>;
      blockers: string[];
      targetsWritten: boolean;
      durationMs: number;
    };
    const fourPayload = four.payload as {
      status: string;
      projection: unknown;
      gates: Record<string, boolean>;
      blockers: string[];
      targetsWritten: boolean;
      durationMs: number;
    };
    expect(onePayload.status).toBe('scaffold');
    expect(onePayload.targetsWritten).toBe(false);
    expect(onePayload.blockers.length).toBeGreaterThan(0);
    expect(JSON.stringify(onePayload.projection)).toBe(JSON.stringify(fourPayload.projection));
    expect(onePayload.gates).toEqual(fourPayload.gates);
    expect(Object.values(onePayload.gates).every(Boolean)).toBe(true);
  });

  it('fails calibration validation when no frozen targets artifact exists', async () => {
    const report = await collectionGameCalibrate({
      validate: join(tmpdir(), 'missing-targets.json'),
    });
    expect(report.ok).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
  });
});
