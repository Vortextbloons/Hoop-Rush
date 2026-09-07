import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  collectionCardIdSchema,
  collectionCatalogSchema,
  collectionIndexSchema,
  seasonDigestHex,
  type CollectionCatalog,
  type CollectionPackDefinition,
  type CollectionRarity,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_REPLAY_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_VERSION,
} from '@hoop-rush/data-contracts';
import { readJson } from './io.ts';
import { COLLECTION_SPECIALS } from './collection-specials.ts';

function atomicWriteFileSync(target: string, content: string): void {
  const tmp = `${target}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  writeFileSync(tmp, content);
  renameSync(tmp, target);
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const COLLECTION_DIR = resolve(STATIC_DATA, 'collection');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');
const IS_ENTRY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function rarityForOverall(overall: number): CollectionRarity {
  if (overall < 72) return 'Ember';
  if (overall < 85) return 'Eruption';
  if (overall < 90) return 'Apex';
  if (overall < 95) return 'Titan';
  if (overall < 99) return 'Eclipse';
  return 'Immortal';
}

const ORDINARY_WEIGHTS: Record<CollectionRarity, number> = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};

const DUPLICATE_EXCHANGE: Record<CollectionRarity, number> = {
  Ember: 5,
  Eruption: 15,
  Apex: 50,
  Titan: 150,
  Eclipse: 500,
  Immortal: 1500,
};

export function launchPackDefinitions(): CollectionPackDefinition[] {
  const ordinary = { kind: 'ordinary' as const };
  return [
    {
      packId: 'tip-off',
      packRulesVersion: COLLECTION_PACK_RULES_VERSION,
      priceCurrency: 'Coins',
      priceAmount: 100,
      slots: [ordinary],
      eligibleScope: 'full-catalog',
      rarityWeights: { ...ORDINARY_WEIGHTS },
      duplicateExchange: { ...DUPLICATE_EXCHANGE },
    },
    {
      packId: 'fast-break',
      packRulesVersion: COLLECTION_PACK_RULES_VERSION,
      priceCurrency: 'Coins',
      priceAmount: 300,
      slots: [ordinary, ordinary, ordinary],
      eligibleScope: 'full-catalog',
      rarityWeights: { ...ORDINARY_WEIGHTS },
      duplicateExchange: { ...DUPLICATE_EXCHANGE },
    },
    {
      packId: 'full-court',
      packRulesVersion: COLLECTION_PACK_RULES_VERSION,
      priceCurrency: 'Coins',
      priceAmount: 500,
      slots: [
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        { kind: 'guaranteed', floorRarity: 'Eruption' },
      ],
      eligibleScope: 'full-catalog',
      rarityWeights: { ...ORDINARY_WEIGHTS },
      duplicateExchange: { ...DUPLICATE_EXCHANGE },
    },
    {
      packId: 'main-event',
      packRulesVersion: COLLECTION_PACK_RULES_VERSION,
      priceCurrency: 'Coins',
      priceAmount: 1000,
      slots: [
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        ordinary,
        { kind: 'guaranteed', floorRarity: 'Apex' },
      ],
      eligibleScope: 'full-catalog',
      rarityWeights: { ...ORDINARY_WEIGHTS },
      duplicateExchange: { ...DUPLICATE_EXCHANGE },
    },
    {
      packId: 'spotlight',
      packRulesVersion: COLLECTION_PACK_RULES_VERSION,
      priceCurrency: 'Exchange',
      priceAmount: 2000,
      slots: [{ kind: 'guaranteed', floorRarity: 'Apex' }],
      eligibleScope: 'specials-only',
      rarityWeights: { ...ORDINARY_WEIGHTS },
      duplicateExchange: { ...DUPLICATE_EXCHANGE },
    },
  ];
}

function baseCardId(sourcePlayerVersionId: string): string {
  return collectionCardIdSchema.parse(
    `card-${seasonDigestHex(`${COLLECTION_OVERLAY_VERSION}\u0000base\u0000${sourcePlayerVersionId}`)}`,
  );
}

function specialCardId(sourcePlayerVersionId: string, family: string): string {
  return collectionCardIdSchema.parse(
    `card-${seasonDigestHex(`${COLLECTION_OVERLAY_VERSION}\u0000special\u0000${sourcePlayerVersionId}\u0000${family}`)}`,
  );
}

function main(): void {
  const manifest = readJson(MANIFEST_PATH) as {
    dataVersion: string;
    season?: {
      draftCatalog?: { url?: string; contentHash?: string };
    };
  };
  const draftRef = manifest.season?.draftCatalog;
  if (draftRef?.url === undefined || draftRef.contentHash === undefined) {
    throw new Error('manifest is missing season.draftCatalog; run the season pipeline first');
  }
  const draftPath = resolve(dirname(MANIFEST_PATH), draftRef.url);
  const draftRaw = readJson(draftPath) as { candidates?: SeasonDraftCandidate[] };
  if (sha256Hex(readFileSync(draftPath, 'utf8')) !== draftRef.contentHash) {
    throw new Error('draft catalog hash does not match the manifest pin');
  }
  const candidates = draftRaw.candidates ?? [];
  if (candidates.length === 0) throw new Error('draft catalog has no candidates');
  const byVersion = new Map(candidates.map((candidate) => [candidate.playerVersionId, candidate]));
  const cards: CollectionCatalog['cards'] = [];
  const seenCardIds = new Set<string>();
  for (const candidate of candidates) {
    const cardId = baseCardId(candidate.playerVersionId);
    if (seenCardIds.has(cardId)) throw new Error(`duplicate card id ${cardId}`);
    seenCardIds.add(cardId);
    cards.push({
      cardId,
      playerId: candidate.playerId,
      sourcePlayerVersionId: candidate.playerVersionId,
      family: 'Base',
      rarity: rarityForOverall(candidate.summaryRatings.overallRating),
      seasonKey: candidate.seasonKey,
      franchiseId: candidate.franchiseId,
      eraId: candidate.eraId,
      displayName: candidate.displayName,
      positions: candidate.positions.playable,
      overlayVersion: COLLECTION_OVERLAY_VERSION,
      sourceProvenance: `${candidate.franchiseId}/${candidate.eraId} ${candidate.seasonKey}`,
      detailedRatings: candidate.detailedRatings,
      tendencies: candidate.tendencies,
      anchors: candidate.anchors,
      reconstructedThreePoint: candidate.reconstructedThreePoint,
      heightInches: candidate.heightInches,
      weightLbs: candidate.weightLbs,
      playerExternalId: candidate.playerExternalId,
      summarySource: candidate.summaryRatings,
    });
  }
  const sourceOverallByVersion = new Map(
    candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  for (const special of COLLECTION_SPECIALS) {
    const source = sourceOverallByVersion.get(special.sourcePlayerVersionId);
    if (source === undefined) {
      throw new Error(
        `special ${special.family}/${special.rarity} references missing source ${special.sourcePlayerVersionId}`,
      );
    }
    if (byVersion.get(special.sourcePlayerVersionId)?.playerId !== source.playerId) {
      throw new Error(`inconsistent identity for ${special.sourcePlayerVersionId}`);
    }
    const cardId = specialCardId(special.sourcePlayerVersionId, special.family);
    if (seenCardIds.has(cardId)) throw new Error(`duplicate card id ${cardId}`);
    seenCardIds.add(cardId);
    cards.push({
      cardId,
      playerId: source.playerId,
      sourcePlayerVersionId: source.playerVersionId,
      family: special.family,
      rarity: special.rarity,
      seasonKey: source.seasonKey,
      franchiseId: source.franchiseId,
      eraId: source.eraId,
      displayName: `${special.rarity} ${special.family} ${source.displayName}`,
      positions: source.positions.playable,
      overlayVersion: COLLECTION_OVERLAY_VERSION,
      sourceProvenance: `${source.franchiseId}/${source.eraId} ${source.seasonKey}`,
      ratingOverlay: special.ratingOverlay,
      detailedRatings: source.detailedRatings,
      tendencies: source.tendencies,
      anchors: source.anchors,
      reconstructedThreePoint: source.reconstructedThreePoint,
      heightInches: source.heightInches,
      weightLbs: source.weightLbs,
      playerExternalId: source.playerExternalId,
      summarySource: source.summaryRatings,
    });
  }
  cards.sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
  const byCardId = new Map(cards.map((card) => [card.cardId, card]));
  const setOf = (
    family: 'Sharpshooter' | 'Lockdown' | 'Floor General',
    setId: string,
    title: string,
  ) => ({
    setId: setId as 'sharpshooter-set',
    title,
    memberCardIds: cards
      .filter((card) => card.family === family)
      .map((card) => card.cardId)
      .sort(),
  });
  const sets = [
    setOf('Sharpshooter', 'sharpshooter-set', 'Sharpshooters'),
    setOf('Lockdown', 'lockdown-set', 'Lockdown'),
    setOf('Floor General', 'floor-general-set', 'Floor Generals'),
  ] as CollectionCatalog['sets'];
  for (const set of sets) {
    if (set.memberCardIds.length !== 4) {
      throw new Error(`set ${set.setId} has ${String(set.memberCardIds.length)} members, want 4`);
    }
    for (const member of set.memberCardIds) {
      if (!byCardId.has(member)) throw new Error(`set ${set.setId} references unknown ${member}`);
    }
  }
  const catalog = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    collectionVersion: COLLECTION_VERSION,
    overlayVersion: COLLECTION_OVERLAY_VERSION,
    dataVersion: manifest.dataVersion,
    ratingsVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: 'player-version-id-v1',
    sourceCatalogVersion: 'season-draft-catalog-v4',
    sourceCatalogHash: draftRef.contentHash,
    cards,
    sets,
    packs: launchPackDefinitions(),
    replayVersion: COLLECTION_REPLAY_VERSION,
  };
  const parsed = collectionCatalogSchema.safeParse(catalog);
  if (!parsed.success) {
    throw new Error(
      `derived collection catalog fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  const catalogContent = `${JSON.stringify(parsed.data)}\n`;
  mkdirSync(COLLECTION_DIR, { recursive: true });
  atomicWriteFileSync(resolve(COLLECTION_DIR, 'catalog.json'), catalogContent);
  const catalogHash = sha256Hex(catalogContent);
  const index = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash,
    cards: parsed.data.cards.map((card) => ({
      cardId: card.cardId,
      playerId: card.playerId,
      playerExternalId: card.playerExternalId,
      displayName: card.displayName,
      seasonKey: card.seasonKey,
      franchiseId: card.franchiseId,
      eraId: card.eraId,
      rarity: card.rarity,
      family: card.family,
      positions: card.positions,
      overall: card.summarySource?.overallRating ?? 60,
    })),
  };
  const parsedIndex = collectionIndexSchema.safeParse(index);
  if (!parsedIndex.success) {
    throw new Error(
      `derived collection index fails the schema: ${parsedIndex.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  const indexContent = `${JSON.stringify(parsedIndex.data)}\n`;
  atomicWriteFileSync(resolve(COLLECTION_DIR, 'index.json'), indexContent);
  const fullManifest = readJson(MANIFEST_PATH) as {
    collection?: { catalog?: unknown; index?: unknown };
  };
  fullManifest.collection = {
    catalog: { url: 'collection/catalog.json', contentHash: catalogHash },
    index: { url: 'collection/index.json', contentHash: sha256Hex(indexContent) },
  };
  atomicWriteFileSync(MANIFEST_PATH, `${JSON.stringify(fullManifest, null, 2)}\n`);
  console.log(
    `wrote collection catalog (${String(parsed.data.cards.length)} cards, ${String(sets.length)} sets) hash ${catalogHash}`,
  );
}

if (IS_ENTRY) {
  main();
}
