import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_GAME_FIRST_CLEAR_COINS,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_TEAM_VERSION,
  collectionCatalogSchema,
  collectionGameRulesSchema,
  collectionIndexSchema,
  collectionScaleRewardCoins,
} from '@hoop-rush/data-contracts';
import { resolveCollectionCard } from '@hoop-rush/engine';
import {
  COLLECTION_OBJECTIVE_LAUNCH_THRESHOLDS,
  buildCollectionDifficultyProfiles,
} from '@hoop-rush/test-fixtures';
import { COLLECTION_SPECIALS } from './collection-specials.ts';
import { launchPackDefinitions, rarityForOverall } from './gen-collection-catalog.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '../../../apps/web/static/data');
const CATALOG_PATH = resolve(DATA_DIR, 'collection/catalog.json');
const INDEX_PATH = resolve(DATA_DIR, 'collection/index.json');
const RULES_PATH = resolve(DATA_DIR, 'collection/game-rules.json');
const MANIFEST_PATH = resolve(DATA_DIR, 'manifest.json');

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('collection launch content', () => {
  it('assigns base rarity from source overall bands', () => {
    expect(rarityForOverall(60)).toBe('Ember');
    expect(rarityForOverall(71)).toBe('Ember');
    expect(rarityForOverall(72)).toBe('Eruption');
    expect(rarityForOverall(84)).toBe('Eruption');
    expect(rarityForOverall(85)).toBe('Apex');
    expect(rarityForOverall(89)).toBe('Apex');
    expect(rarityForOverall(90)).toBe('Titan');
    expect(rarityForOverall(94)).toBe('Titan');
    expect(rarityForOverall(95)).toBe('Eclipse');
    expect(rarityForOverall(98)).toBe('Eclipse');
    expect(rarityForOverall(99)).toBe('Immortal');
    expect(rarityForOverall(100)).toBe('Immortal');
  });

  it('freezes twelve authored specials', () => {
    expect(COLLECTION_SPECIALS).toHaveLength(12);
    const byFamily = new Map<string, number>();
    for (const special of COLLECTION_SPECIALS) {
      byFamily.set(special.family, (byFamily.get(special.family) ?? 0) + 1);
    }
    expect(byFamily.get('Sharpshooter')).toBe(4);
    expect(byFamily.get('Lockdown')).toBe(4);
    expect(byFamily.get('Floor General')).toBe(4);
  });

  it('defines five launch packs with frozen prices', () => {
    const packs = launchPackDefinitions();
    expect(packs.map((pack) => pack.packId)).toEqual([
      'tip-off',
      'fast-break',
      'full-court',
      'main-event',
      'spotlight',
    ]);
    expect(packs.map((pack) => pack.slots.length)).toEqual([1, 3, 5, 10, 1]);
    expect(packs.map((pack) => pack.priceAmount)).toEqual([100, 300, 500, 1000, 2000]);
  });

  it('resolves generated specials through engine inputs', () => {
    const catalog = collectionCatalogSchema.parse(
      JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown,
    );
    expect(catalog.catalogVersion).toBe(COLLECTION_CATALOG_VERSION);
    const baseCards = catalog.cards.filter((card) => card.family === 'Base');
    expect(baseCards.length).toBeGreaterThan(0);
    expect(catalog.cards).toHaveLength(baseCards.length + 12);
    const index = collectionIndexSchema.parse(
      JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as unknown,
    );
    expect(index.cards).toHaveLength(catalog.cards.length);
    for (const authored of COLLECTION_SPECIALS) {
      const card = catalog.cards.find(
        (entry) =>
          entry.family === authored.family &&
          entry.sourcePlayerVersionId === authored.sourcePlayerVersionId,
      );
      expect(card).toBeDefined();
      if (card === undefined) continue;
      expect(card.rarity).toBe(authored.rarity);
      expect(card.ratingOverlay).toEqual(authored.ratingOverlay);
      const resolved = resolveCollectionCard(card, card);
      for (const [key, delta] of Object.entries(authored.ratingOverlay)) {
        const ratingKey = key as keyof typeof card.detailedRatings;
        const want = Math.min(100, Math.max(0, card.detailedRatings[ratingKey] + delta));
        expect(resolved.ratings[ratingKey]).toBe(want);
      }
      expect(resolved.playerId).toBe(card.playerId);
      expect(card.positions).toEqual(
        catalog.cards.find(
          (entry) => entry.cardId !== card.cardId && entry.playerId === card.playerId,
        )?.positions ?? card.positions,
      );
    }
  });
});

describe('collection launch game rules', () => {
  const bytes = readFileSync(RULES_PATH);
  const parsed = collectionGameRulesSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);

  it('packs the v2 rules artifact byte-stably and hash-pins it in the manifest', () => {
    expect(parsed.rulesVersion).toBe(COLLECTION_GAME_RULES_VERSION);
    expect(parsed.gameVersion).toBe(COLLECTION_GAME_VERSION);
    expect(parsed.teamVersion).toBe(COLLECTION_TEAM_VERSION);
    expect(parsed.rewardVersion).toBe(COLLECTION_REWARD_VERSION);
    expect(parsed.replayVersion).toBe(COLLECTION_GAME_REPLAY_VERSION);
    expect(parsed.difficultyVersion).toBe(COLLECTION_DIFFICULTY_VERSION);
    expect(parsed.objectiveVersion).toBe(COLLECTION_OBJECTIVE_VERSION);
    expect(`${JSON.stringify(parsed)}\n`).toBe(bytes.toString('utf8'));
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      collection?: { gameRules?: { url?: string; contentHash?: string } };
    };
    expect(manifest.collection?.gameRules?.contentHash).toBe(sha256(bytes));
  });

  it('mirrors the candidate difficulty profiles, thresholds, and reward table', () => {
    expect(JSON.stringify(parsed.difficulties)).toBe(
      JSON.stringify(buildCollectionDifficultyProfiles()),
    );
    const thresholds = Object.fromEntries(
      parsed.objectives.map((objective) => [objective.objectiveId, objective.threshold]),
    );
    expect(thresholds).toEqual(COLLECTION_OBJECTIVE_LAUNCH_THRESHOLDS);
    expect(parsed.objectives.map((objective) => objective.objectiveVersion)).toEqual(
      parsed.objectives.map(() => COLLECTION_OBJECTIVE_VERSION),
    );
    expect(parsed.rewardTable).toEqual({
      winCoins: COLLECTION_GAME_REWARD_WIN_COINS,
      lossCoins: COLLECTION_GAME_REWARD_LOSS_COINS,
      objectiveCoins: COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
      marginCoinPerPoint: COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
      marginCapPoints: COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
      firstClearCoins: { ...COLLECTION_GAME_FIRST_CLEAR_COINS },
    });
    const maxima = parsed.difficulties.map(
      (profile) =>
        collectionScaleRewardCoins(COLLECTION_GAME_REWARD_WIN_COINS, profile.rewardMultiplierBp) +
        collectionScaleRewardCoins(
          COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
          profile.rewardMultiplierBp,
        ) +
        collectionScaleRewardCoins(
          COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT * COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
          profile.rewardMultiplierBp,
        ),
    );
    expect(maxima).toEqual([150, 203, 263]);
  });

  it('rejects tampered weights, bands, ordering, and versions', () => {
    const weightTamper = JSON.parse(JSON.stringify(parsed)) as {
      difficulties: Array<{ rarityWeightsBp: Array<{ rarity: string; weightBp: number }> }>;
    };
    const firstWeights = weightTamper.difficulties[0];
    if (firstWeights !== undefined) {
      firstWeights.rarityWeightsBp[0] = { rarity: 'Ember', weightBp: 1 };
    }
    expect(collectionGameRulesSchema.safeParse(weightTamper).success).toBe(false);

    const orderTamper = JSON.parse(JSON.stringify(parsed)) as {
      difficulties: unknown[];
    };
    orderTamper.difficulties.reverse();
    expect(collectionGameRulesSchema.safeParse(orderTamper).success).toBe(false);

    const bandTamper = JSON.parse(JSON.stringify(parsed)) as {
      difficulties: Array<{ rarityBand: { floor: string; ceiling: string } }>;
    };
    const second = bandTamper.difficulties[1];
    if (second !== undefined) second.rarityBand.ceiling = 'Eruption';
    expect(collectionGameRulesSchema.safeParse(bandTamper).success).toBe(false);

    const versionTamper = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
    versionTamper.gameVersion = 'collection-game-v1';
    expect(collectionGameRulesSchema.safeParse(versionTamper).success).toBe(false);

    const rewardTamper = JSON.parse(JSON.stringify(parsed)) as {
      rewardTable: { winCoins: number };
    };
    rewardTamper.rewardTable.winCoins = 200;
    expect(collectionGameRulesSchema.safeParse(rewardTamper).success).toBe(false);
  });
});
