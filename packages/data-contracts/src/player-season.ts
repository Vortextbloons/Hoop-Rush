import { z } from 'zod';
import { bbrefIdSchema, eraIdSchema, franchiseIdSchema, playerExternalIdSchema, playerIdSchema, seasonKeySchema, } from './ids.ts';
import { positionNormalizationVersionSchema, positionSchema, positionUnionSchema, sourcePositionSchema, } from './positions.ts';
import { simulationRatingsSchema, simulationTendenciesSchema, simulationAnchorsSchema, reconstructedThreePointProfileSchema, } from './simulation.ts';
import { historicalTeamIdentitySchema, provenanceMapSchema, coverageSummarySchema, } from './provenance.ts';
import { ratingProfileSchema } from './ratings-model.ts';
export const playerSeasonStatsSchema = z.object({
    gamesPlayed: z.number().int().nonnegative(),
    minutes: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    rebounds: z.number().int().nonnegative(),
    offensiveRebounds: z.number().int().nonnegative().nullable(),
    defensiveRebounds: z.number().int().nonnegative().nullable(),
    assists: z.number().int().nonnegative(),
    steals: z.number().int().nonnegative().nullable(),
    blocks: z.number().int().nonnegative().nullable(),
    turnovers: z.number().int().nonnegative().nullable(),
    fieldGoalsMade: z.number().int().nonnegative(),
    fieldGoalsAttempted: z.number().int().nonnegative(),
    threesMade: z.number().int().nonnegative().nullable(),
    threesAttempted: z.number().int().nonnegative().nullable(),
    freeThrowsMade: z.number().int().nonnegative(),
    freeThrowsAttempted: z.number().int().nonnegative(),
    per: z.number().nullable(),
    boxPlusMinus: z.number().nullable(),
    usageRate: z.number().min(0).max(100).nullable(),
    tsPct: z.number().min(0).max(1).nullable(),
    efgPct: z.number().min(0).max(1).nullable(),
});
export type PlayerSeasonStats = z.infer<typeof playerSeasonStatsSchema>;
export const summaryRatingsSchema = z.object({
    overallRating: z.number().int().min(0).max(100),
    offenseRating: z.number().int().min(0).max(100),
    defenseRating: z.number().int().min(0).max(100),
});
export type SummaryRatings = z.infer<typeof summaryRatingsSchema>;
export const sourceMetadataSchema = z.object({
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    selectionScoreVersion: z.string().min(1).max(64),
    sourceVersion: z.string().min(1).max(64),
    derivationMethodVersion: z.string().min(1).max(64),
    lineageRuleVersion: z.string().min(1).max(64),
});
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export const playersIndexAltIdsSchema = z
    .object({
    bbref: bbrefIdSchema.nullable().optional(),
    nbaHeadshotAvailable: z.boolean().optional(),
    photoUrl: z.url().nullable().optional(),
})
    .nullable();
export type PlayersIndexAltIds = z.infer<typeof playersIndexAltIdsSchema>;
export const peakPlayerSeasonSchema = z.object({
    schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    playerId: playerIdSchema,
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    seasonKey: seasonKeySchema,
    firstName: z.string().min(1).max(64),
    lastName: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    playerExternalId: playerExternalIdSchema,
    altIds: playersIndexAltIdsSchema.optional(),
    positions: z.object({
        primary: positionSchema,
        secondary: z.array(positionSchema).max(4),
        playable: positionUnionSchema,
        sourceLabels: z.array(sourcePositionSchema).min(1),
        normalizationVersion: positionNormalizationVersionSchema,
    }),
    heightInches: z.number().int().min(60).max(96).nullable(),
    weightLbs: z.number().int().min(120).max(400).nullable(),
    eligibility: z.object({
        minimumTeamGames: z.literal(40),
        teamGames: z.number().int().min(40),
        teamMinutes: z.number().int().nonnegative(),
    }),
    selectionScore: z.number().min(0).max(999),
    selectionScoreVersion: z.string().min(1).max(64),
    stats: playerSeasonStatsSchema,
    historicalTeamIdentity: historicalTeamIdentitySchema,
    summaryRatings: summaryRatingsSchema,
    ratingProfile: ratingProfileSchema.optional(),
    detailedRatings: simulationRatingsSchema,
    tendencies: simulationTendenciesSchema,
    anchors: simulationAnchorsSchema,
    reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
    provenance: provenanceMapSchema,
    source: sourceMetadataSchema,
});
export type PeakPlayerSeason = z.infer<typeof peakPlayerSeasonSchema>;
export const franchiseEraPoolSchema = z.object({
    schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    dataVersion: z.string().min(1).max(64),
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    eligibility: z.object({ minimumTeamGames: z.literal(40) }),
    coverageSummary: coverageSummarySchema,
    players: z.array(peakPlayerSeasonSchema).min(1),
});
export type FranchiseEraPool = z.infer<typeof franchiseEraPoolSchema>;
export const playersIndexEntrySchema = z.object({
    playerId: playerIdSchema,
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    seasonKey: seasonKeySchema,
    firstName: z.string().min(1).max(64),
    lastName: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    playerExternalId: playerExternalIdSchema,
    altIds: playersIndexAltIdsSchema.optional(),
    positionsPlayable: positionUnionSchema,
    overall: z.number().int().min(0).max(100),
    offense: z.number().int().min(0).max(100),
    defense: z.number().int().min(0).max(100),
    selectionScore: z.number().min(0).max(999),
    ratingModelVersion: z.string().min(1).max(64).optional(),
});
export type PlayersIndexEntry = z.infer<typeof playersIndexEntrySchema>;
export const playersIndexSchema = z.object({
    schemaVersion: z.union([z.literal(4), z.literal(5)]),
    dataVersion: z.string().min(1).max(64),
    players: z.array(playersIndexEntrySchema).min(1),
});
export type PlayersIndex = z.infer<typeof playersIndexSchema>;
export const rosterDetailsEntrySchema = z.object({
    playerId: playerIdSchema,
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    seasonKey: seasonKeySchema,
    heightInches: z.number().int().min(60).max(96).nullable(),
    weightLbs: z.number().int().min(120).max(400).nullable(),
    stats: playerSeasonStatsSchema,
});
export type RosterDetailsEntry = z.infer<typeof rosterDetailsEntrySchema>;
export const rosterDetailsSchema = z.object({
    schemaVersion: z.literal(1),
    dataVersion: z.string().min(1).max(64),
    players: z.array(rosterDetailsEntrySchema).min(1),
});
export type RosterDetails = z.infer<typeof rosterDetailsSchema>;
