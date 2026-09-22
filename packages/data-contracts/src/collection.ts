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
  COLLECTION_COMMAND_V1_VERSION,
  COLLECTION_COMMAND_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_REPLAY_V1_VERSION,
  COLLECTION_REPLAY_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_STATE_SCHEMA_VERSION,
  COLLECTION_TARGETING_VERSION,
  COLLECTION_VERSION,
} from './collection-versions.ts';
import {
  collectionCardIdSchema,
  collectionCurrencySchema,
  collectionFamilySchema,
  collectionPackIdSchema,
  collectionRaritySchema,
  collectionSetIdSchema,
} from './collection-primitives.ts';
import { collectionTargetSnapshotSchema } from './collection-targeting.ts';

export {
  collectionCardIdSchema,
  collectionCurrencySchema,
  collectionFamilySchema,
  collectionPackIdSchema,
  collectionRaritySchema,
  collectionSetIdSchema,
} from './collection-primitives.ts';
export type {
  CollectionCardId,
  CollectionCurrency,
  CollectionFamily,
  CollectionPackId,
  CollectionRarity,
  CollectionSetId,
} from './collection-primitives.ts';

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

export const collectionPullRecordV1Schema = z.object({
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
export type CollectionPullRecordV1 = z.infer<typeof collectionPullRecordV1Schema>;

export const collectionPullRecordV2Schema = collectionPullRecordV1Schema
  .extend({
    replayVersion: z.literal(COLLECTION_REPLAY_VERSION),
    targeting: collectionTargetSnapshotSchema.nullable(),
  })
  .strict();
export type CollectionPullRecordV2 = z.infer<typeof collectionPullRecordV2Schema>;

export const collectionPullRecordUnionSchema = z.union([
  collectionPullRecordV2Schema,
  collectionPullRecordV1Schema,
]);
export const collectionPullRecordSchema = collectionPullRecordUnionSchema;
export type CollectionPullRecord = z.infer<typeof collectionPullRecordUnionSchema>;
export type CollectionPullRecordUnion = CollectionPullRecord;

export const collectionLedgerReasonSchema = z.enum([
  'welcome-grant',
  'pack-purchase',
  'duplicate-conversion',
  'game-win-reward',
  'game-loss-reward',
  'game-objective-reward',
  'game-margin-reward',
  'game-first-clear-reward',
  'challenge-first-clear-reward',
  'challenge-repeat-win-reward',
  'set-completion-reward',
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

export const collectionStateV1Schema = z.object({
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
export type CollectionStateV1 = z.infer<typeof collectionStateV1Schema>;

export const collectionStateV2Schema = z
  .object({
    schemaVersion: z.literal(COLLECTION_STATE_SCHEMA_VERSION),
    collectionVersion: z.literal(COLLECTION_VERSION),
    catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    economyVersion: z.literal(COLLECTION_ECONOMY_VERSION),
    progressionVersion: z.literal(COLLECTION_PROGRESSION_VERSION),
    progressionHash: contentHashSchema.nullable(),
    collectionId: idSchema,
    rootSeed: seedSchema,
    revision: z.number().int().nonnegative(),
    digest: seasonCheckpointDigestSchema,
    claimedWelcome: z.boolean(),
    owned: z.array(collectionOwnedCardSchema),
    balances: collectionBalancesSchema,
    nextPullSequence: z.number().int().nonnegative(),
    activeTargetPlayerId: playerIdSchema.nullable(),
    claimedSetIds: z.array(collectionSetIdSchema),
  })
  .superRefine((state, ctx) => {
    const seen = new Set<string>();
    let previous = '';
    for (const setId of state.claimedSetIds) {
      if (seen.has(setId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate claimed set ${setId}` });
      }
      if (seen.size > 0 && setId <= previous) {
        ctx.addIssue({ code: 'custom', message: 'claimed set ids must be canonical sorted' });
      }
      seen.add(setId);
      previous = setId;
    }
  });
export type CollectionStateV2 = z.infer<typeof collectionStateV2Schema>;

export const collectionStateUnionSchema = z.union([
  collectionStateV2Schema,
  collectionStateV1Schema,
]);
export const collectionStateSchema = collectionStateV2Schema;
export type CollectionState = CollectionStateV2;
export type CollectionStateUnion = z.infer<typeof collectionStateUnionSchema>;

export const collectionCommandBaseV1Schema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_COMMAND_V1_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});
export type CollectionCommandBaseV1 = z.infer<typeof collectionCommandBaseV1Schema>;

export const collectionCommandBaseV2Schema = z.object({
  schemaVersion: z.literal(COLLECTION_STATE_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_COMMAND_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});
export type CollectionCommandBaseV2 = z.infer<typeof collectionCommandBaseV2Schema>;

export const collectionCommandBaseSchema = collectionCommandBaseV2Schema;

export const collectionClaimWelcomeCommandV1Schema = collectionCommandBaseV1Schema.extend({
  command: z.literal('claim-welcome'),
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionClaimWelcomeCommandV1 = z.infer<typeof collectionClaimWelcomeCommandV1Schema>;

export const collectionOpenPackCommandV1Schema = collectionCommandBaseV1Schema.extend({
  command: z.literal('open-pack'),
  packId: collectionPackIdSchema,
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionOpenPackCommandV1 = z.infer<typeof collectionOpenPackCommandV1Schema>;

export const collectionClaimWelcomeCommandSchema = collectionCommandBaseV2Schema.extend({
  command: z.literal('claim-welcome'),
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionClaimWelcomeCommand = z.infer<typeof collectionClaimWelcomeCommandSchema>;

export const collectionOpenPackCommandSchema = collectionCommandBaseV2Schema.extend({
  command: z.literal('open-pack'),
  packId: collectionPackIdSchema,
  acquiredAtIso: z.string().min(1).max(64),
});
export type CollectionOpenPackCommand = z.infer<typeof collectionOpenPackCommandSchema>;

export const collectionSetTargetPlayerCommandSchema = collectionCommandBaseV2Schema.extend({
  command: z.literal('set-target-player'),
  playerId: playerIdSchema.nullable(),
});
export type CollectionSetTargetPlayerCommand = z.infer<
  typeof collectionSetTargetPlayerCommandSchema
>;

export const collectionClaimSetRewardCommandSchema = collectionCommandBaseV2Schema.extend({
  command: z.literal('claim-set-reward'),
  setId: collectionSetIdSchema,
  claimedAtIso: z.string().min(1).max(64),
});
export type CollectionClaimSetRewardCommand = z.infer<typeof collectionClaimSetRewardCommandSchema>;

export const collectionCommandV1Schema = z.discriminatedUnion('command', [
  collectionClaimWelcomeCommandV1Schema,
  collectionOpenPackCommandV1Schema,
]);
export type CollectionCommandV1 = z.infer<typeof collectionCommandV1Schema>;

export const collectionCommandV2Schema = z.discriminatedUnion('command', [
  collectionClaimWelcomeCommandSchema,
  collectionOpenPackCommandSchema,
  collectionSetTargetPlayerCommandSchema,
  collectionClaimSetRewardCommandSchema,
]);
export type CollectionCommandV2 = z.infer<typeof collectionCommandV2Schema>;

export const collectionCommandSchema = z.union([
  collectionCommandV1Schema,
  collectionCommandV2Schema,
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
  z.object({ code: z.literal('unknown-target-player'), playerId: z.string() }),
  z.object({ code: z.literal('target-unchanged'), playerId: z.string().nullable() }),
  z.object({ code: z.literal('unknown-set'), setId: z.string() }),
  z.object({
    code: z.literal('set-incomplete'),
    setId: z.string(),
    ownedCount: z.number().int().nonnegative(),
    requiredCount: z.number().int().positive(),
    missingCardIds: z.array(collectionCardIdSchema),
  }),
  z.object({ code: z.literal('set-already-claimed'), setId: z.string() }),
  z.object({ code: z.literal('invalid-progression-rules'), detail: z.string() }),
  z.object({ code: z.literal('targeting-version-mismatch'), detail: z.string() }),
  z.object({ code: z.literal('set-reward-divergence'), detail: z.string() }),
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
    replayVersion: z.literal(COLLECTION_REPLAY_V1_VERSION),
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
