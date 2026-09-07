import { z } from 'zod';
import {
  contentHashSchema,
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seasonKeySchema,
  seedSchema,
} from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  positionNormalizationVersionSchema,
  positionSchema,
  positionUnionSchema,
} from './positions.ts';
import {
  reconstructedThreePointProfileSchema,
  simulationAnchorsSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
} from './simulation.ts';
import { summaryRatingsSchema } from './player-season.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_COMMAND_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_REPLAY_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_VERSION,
} from './collection-versions.ts';

export const collectionCardIdSchema = z.string().regex(/^card-[0-9a-f]{32}$/);
export type CollectionCardId = z.infer<typeof collectionCardIdSchema>;

export const collectionRaritySchema = z.enum([
  'Ember',
  'Eruption',
  'Apex',
  'Titan',
  'Eclipse',
  'Immortal',
]);
export type CollectionRarity = z.infer<typeof collectionRaritySchema>;

export const collectionFamilySchema = z.enum(['Base', 'Sharpshooter', 'Lockdown', 'Floor General']);
export type CollectionFamily = z.infer<typeof collectionFamilySchema>;

export const collectionCurrencySchema = z.enum(['Coins', 'Exchange']);
export type CollectionCurrency = z.infer<typeof collectionCurrencySchema>;

export const collectionPackIdSchema = z.enum([
  'tip-off',
  'fast-break',
  'full-court',
  'main-event',
  'spotlight',
]);
export type CollectionPackId = z.infer<typeof collectionPackIdSchema>;

export const collectionSetIdSchema = z.enum([
  'sharpshooter-set',
  'lockdown-set',
  'floor-general-set',
]);
export type CollectionSetId = z.infer<typeof collectionSetIdSchema>;

const ratingDeltaSchema = z.number().int().min(-100).max(100);
const tendencyDeltaSchema = z.number().min(-100).max(100);

export const collectionRatingOverlaySchema = z
  .object({
    insideScoring: ratingDeltaSchema.optional(),
    closeShot: ratingDeltaSchema.optional(),
    midrange: ratingDeltaSchema.optional(),
    threePoint: ratingDeltaSchema.optional(),
    freeThrow: ratingDeltaSchema.optional(),
    ballHandling: ratingDeltaSchema.optional(),
    passing: ratingDeltaSchema.optional(),
    offensiveIq: ratingDeltaSchema.optional(),
    offensiveRebound: ratingDeltaSchema.optional(),
    defensiveRebound: ratingDeltaSchema.optional(),
    perimeterDefense: ratingDeltaSchema.optional(),
    interiorDefense: ratingDeltaSchema.optional(),
    steal: ratingDeltaSchema.optional(),
    block: ratingDeltaSchema.optional(),
    defensiveIq: ratingDeltaSchema.optional(),
    speed: ratingDeltaSchema.optional(),
    strength: ratingDeltaSchema.optional(),
    vertical: ratingDeltaSchema.optional(),
  })
  .strict();
export type CollectionRatingOverlay = z.infer<typeof collectionRatingOverlaySchema>;

export const collectionCardDefinitionSchema = z.object({
  cardId: collectionCardIdSchema,
  playerId: playerIdSchema,
  sourcePlayerVersionId: playerVersionIdSchema,
  family: collectionFamilySchema,
  rarity: collectionRaritySchema,
  seasonKey: seasonKeySchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  displayName: z.string().min(1).max(96),
  positions: positionUnionSchema,
  overlayVersion: z.literal(COLLECTION_OVERLAY_VERSION),
  sourceProvenance: z.string().min(1).max(128),
  ratingOverlay: collectionRatingOverlaySchema.optional(),
  tendencyOverlay: z.record(z.string(), tendencyDeltaSchema).optional(),
  eligibilityOverlay: z.array(positionSchema).min(1).max(5).optional(),
});
export type CollectionCardDefinition = z.infer<typeof collectionCardDefinitionSchema>;

export const collectionPackSlotSchema = z.object({
  kind: z.enum(['ordinary', 'guaranteed']),
  floorRarity: collectionRaritySchema.optional(),
});
export type CollectionPackSlot = z.infer<typeof collectionPackSlotSchema>;

export const collectionPackDefinitionSchema = z.object({
  packId: collectionPackIdSchema,
  packRulesVersion: z.literal(COLLECTION_PACK_RULES_VERSION),
  priceCurrency: collectionCurrencySchema,
  priceAmount: z.number().int().nonnegative(),
  slots: z.array(collectionPackSlotSchema).min(1).max(10),
  eligibleScope: z.enum(['full-catalog', 'specials-only']),
  rarityWeights: z.record(collectionRaritySchema, z.number().nonnegative()),
  duplicateExchange: z.record(collectionRaritySchema, z.number().int().nonnegative()),
});
export type CollectionPackDefinition = z.infer<typeof collectionPackDefinitionSchema>;

export const collectionOwnedCardSchema = z.object({
  cardId: collectionCardIdSchema,
  acquiredPullSequence: z.number().int().nonnegative(),
  acquiredSlotIndex: z.number().int().nonnegative(),
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionOwnedCard = z.infer<typeof collectionOwnedCardSchema>;

export const collectionPullSlotResultSchema = z.object({
  slotIndex: z.number().int().nonnegative(),
  cardId: collectionCardIdSchema,
  rarity: collectionRaritySchema,
  kept: z.boolean(),
  conversionAmount: z.number().int().nonnegative(),
});
export type CollectionPullSlotResult = z.infer<typeof collectionPullSlotResultSchema>;

export const collectionPullRecordSchema = z.object({
  pullSequence: z.number().int().nonnegative(),
  kind: z.enum(['welcome', 'pack']),
  packId: collectionPackIdSchema.optional(),
  packRulesVersion: z.literal(COLLECTION_PACK_RULES_VERSION),
  economyVersion: z.literal(COLLECTION_ECONOMY_VERSION),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  catalogHash: contentHashSchema,
  commandId: commandIdSchema,
  seedPath: z.array(z.string().min(1).max(128)).min(1),
  slots: z.array(collectionPullSlotResultSchema).min(1).max(10),
});
export type CollectionPullRecord = z.infer<typeof collectionPullRecordSchema>;

export const collectionLedgerReasonSchema = z.enum([
  'welcome-grant',
  'pack-purchase',
  'duplicate-conversion',
]);
export type CollectionLedgerReason = z.infer<typeof collectionLedgerReasonSchema>;

export const collectionLedgerEntrySchema = z.object({
  transactionId: z.string().regex(/^txn-[0-9a-f]{32}$/),
  commandId: commandIdSchema,
  pullSequence: z.number().int().nonnegative().nullable(),
  currency: collectionCurrencySchema,
  amount: z.number().int(),
  reason: collectionLedgerReasonSchema,
});
export type CollectionLedgerEntry = z.infer<typeof collectionLedgerEntrySchema>;

export const collectionBalancesSchema = z.object({
  Coins: z.number().int().nonnegative(),
  Exchange: z.number().int().nonnegative(),
});
export type CollectionBalances = z.infer<typeof collectionBalancesSchema>;

export const collectionStateSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  collectionVersion: z.literal(COLLECTION_VERSION),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  economyVersion: z.literal(COLLECTION_ECONOMY_VERSION),
  collectionId: idSchema,
  rootSeed: seedSchema,
  revision: z.number().int().nonnegative(),
  digest: seasonCheckpointDigestSchema,
  claimedWelcome: z.boolean(),
  owned: z.array(collectionOwnedCardSchema),
  balances: collectionBalancesSchema,
  nextPullSequence: z.number().int().nonnegative(),
});
export type CollectionState = z.infer<typeof collectionStateSchema>;

export const collectionCommandBaseSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_COMMAND_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});
export type CollectionCommandBase = z.infer<typeof collectionCommandBaseSchema>;

export const collectionClaimWelcomeCommandSchema = collectionCommandBaseSchema.extend({
  command: z.literal('claim-welcome'),
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionClaimWelcomeCommand = z.infer<typeof collectionClaimWelcomeCommandSchema>;

export const collectionOpenPackCommandSchema = collectionCommandBaseSchema.extend({
  command: z.literal('open-pack'),
  packId: collectionPackIdSchema,
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionOpenPackCommand = z.infer<typeof collectionOpenPackCommandSchema>;

export const collectionCommandSchema = z.discriminatedUnion('command', [
  collectionClaimWelcomeCommandSchema,
  collectionOpenPackCommandSchema,
]);
export type CollectionCommand = z.infer<typeof collectionCommandSchema>;

export const collectionRejectionSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('collection-mismatch'), expectedCollectionId: z.string() }),
  z.object({ code: z.literal('duplicate-command'), commandId: z.string() }),
  z.object({
    code: z.literal('stale-state'),
    expectedRevision: z.number().int().nonnegative(),
    expectedDigest: seasonCheckpointDigestSchema,
    currentRevision: z.number().int().nonnegative(),
    currentDigest: seasonCheckpointDigestSchema,
  }),
  z.object({ code: z.literal('conflicting-command-reuse'), commandId: z.string() }),
  z.object({ code: z.literal('already-claimed') }),
  z.object({ code: z.literal('insufficient-funds'), currency: collectionCurrencySchema }),
  z.object({ code: z.literal('missing-content'), detail: z.string() }),
  z.object({ code: z.literal('incompatible-content'), detail: z.string() }),
  z.object({ code: z.literal('invalid-definition'), detail: z.string() }),
  z.object({ code: z.literal('no-feasible-starter'), detail: z.string() }),
  z.object({ code: z.literal('arithmetic-overflow'), detail: z.string() }),
]);
export type CollectionRejection = z.infer<typeof collectionRejectionSchema>;

export const collectionSetDefinitionSchema = z.object({
  setId: collectionSetIdSchema,
  title: z.string().min(1).max(96),
  memberCardIds: z.array(collectionCardIdSchema).min(1),
});
export type CollectionSetDefinition = z.infer<typeof collectionSetDefinitionSchema>;

export const collectionTeamFoundationSchema = z.object({
  cardIds: z.array(collectionCardIdSchema).max(12),
});
export type CollectionTeamFoundation = z.infer<typeof collectionTeamFoundationSchema>;

export const collectionCatalogCardSchema = collectionCardDefinitionSchema.extend({
  summarySource: summaryRatingsSchema.optional(),
  detailedRatings: simulationRatingsSchema,
  tendencies: simulationTendenciesSchema,
  anchors: simulationAnchorsSchema.optional(),
  reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
  heightInches: z.number().int().min(60).max(96).nullable(),
  weightLbs: z.number().int().min(120).max(400).nullable(),
  playerExternalId: z.string().min(1).max(64),
});
export type CollectionCatalogCard = z.infer<typeof collectionCatalogCardSchema>;

export const collectionCatalogSchema = z
  .object({
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    collectionVersion: z.literal(COLLECTION_VERSION),
    overlayVersion: z.literal(COLLECTION_OVERLAY_VERSION),
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    positionNormalizationVersion: positionNormalizationVersionSchema,
    playerVersionIdVersion: z.string().min(1).max(64),
    sourceCatalogVersion: z.string().min(1).max(64),
    sourceCatalogHash: contentHashSchema,
    cards: z.array(collectionCatalogCardSchema).min(1),
    sets: z.array(collectionSetDefinitionSchema).min(1),
    packs: z.array(collectionPackDefinitionSchema).min(1),
    replayVersion: z.literal(COLLECTION_REPLAY_VERSION),
  })
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    for (const card of catalog.cards) {
      if (seen.has(card.cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate card ${card.cardId}` });
      }
      seen.add(card.cardId);
    }
    for (const set of catalog.sets) {
      const members = new Set(set.memberCardIds);
      if (members.size !== set.memberCardIds.length) {
        ctx.addIssue({ code: 'custom', message: `set ${set.setId} has duplicate members` });
      }
      for (const member of set.memberCardIds) {
        if (!seen.has(member)) {
          ctx.addIssue({
            code: 'custom',
            message: `set ${set.setId} references unknown card ${member}`,
          });
        }
      }
    }
  });
export type CollectionCatalog = z.infer<typeof collectionCatalogSchema>;

export const collectionIndexEntrySchema = z.object({
  cardId: collectionCardIdSchema,
  playerId: playerIdSchema,
  playerExternalId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  seasonKey: seasonKeySchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  rarity: collectionRaritySchema,
  family: collectionFamilySchema,
  positions: positionUnionSchema,
  overall: z.number().int().min(0).max(100),
});
export type CollectionIndexEntry = z.infer<typeof collectionIndexEntrySchema>;

export const collectionIndexSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  catalogHash: contentHashSchema,
  cards: z.array(collectionIndexEntrySchema).min(1),
});
export type CollectionIndex = z.infer<typeof collectionIndexSchema>;
