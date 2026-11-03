import { z } from 'zod';
import {
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
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
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_SPECIALS_VERSION,
  COLLECTION_VERSION,
} from './collection-versions.ts';
import {
  collectionCardIdSchema,
  collectionCardAvailabilitySchema,
  collectionFamilySchema,
  collectionRaritySchema,
} from './collection-primitives.ts';

export {
  collectionCardIdSchema,
  collectionCardAvailabilitySchema,
  collectionFamilySchema,
  collectionRaritySchema,
} from './collection-primitives.ts';
export type {
  CollectionCardId,
  CollectionCardAvailability,
  CollectionFamily,
  CollectionRarity,
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

export const collectionCardDefinitionSchema = z.object({
  cardId: collectionCardIdSchema,
  playerId: playerIdSchema,
  sourcePlayerVersionId: playerVersionIdSchema,
  family: collectionFamilySchema,
  availability: collectionCardAvailabilitySchema.optional(),
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

export const collectionCatalogSchema = z
  .object({
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    collectionVersion: z.literal(COLLECTION_VERSION),
    overlayVersion: z.literal(COLLECTION_OVERLAY_VERSION),
    specialsVersion: z.literal(COLLECTION_SPECIALS_VERSION).optional(),
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    positionNormalizationVersion: positionNormalizationVersionSchema,
    playerVersionIdVersion: z.string().min(1).max(64),
    sourceCatalogVersion: z.string().min(1).max(64),
    sourceCatalogHash: contentHashSchema,
    cards: z.array(collectionCatalogCardSchema).min(1),
  })
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    for (const card of catalog.cards) {
      if (seen.has(card.cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate card ${card.cardId}` });
      }
      seen.add(card.cardId);
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
  availability: collectionCardAvailabilitySchema.optional(),
  positions: positionUnionSchema,
  overall: z.number().int().min(0).max(100),
});

export const collectionIndexSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  catalogHash: contentHashSchema,
  cards: z.array(collectionIndexEntrySchema).min(1),
});
