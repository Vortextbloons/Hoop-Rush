import { z } from 'zod';
import { contentHashSchema, franchiseIdSchema, eraIdSchema, seasonKeySchema } from './ids.ts';
export const provenanceKindSchema = z.enum(['observed', 'derived', 'estimated', 'reconstructed']);
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;
export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof confidenceSchema>;
export const sourceStatusSchema = z.enum(['available', 'unavailable', 'not-applicable']);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export const historicalValueProvenanceSchema = z.object({
    kind: provenanceKindSchema,
    confidence: confidenceSchema,
    methodVersion: z.string().min(1).max(64),
    sourceVersion: z.string().min(1).max(64),
    sourceFields: z.array(z.string().min(1).max(64)),
    sampleGames: z.number().int().nonnegative().optional(),
    sampleMinutes: z.number().nonnegative().optional(),
    sourceStatus: sourceStatusSchema.optional(),
    notesCode: z.string().min(1).max(64).optional(),
});
export type HistoricalValueProvenance = z.infer<typeof historicalValueProvenanceSchema>;
export const provenanceMapSchema = z.record(z.string().min(1).max(64), historicalValueProvenanceSchema);
export type ProvenanceMap = z.infer<typeof provenanceMapSchema>;
export const historicalTeamIdentitySchema = z.object({
    teamId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(64),
    city: z.string().min(1).max(64),
    abbreviation: z.string().min(1).max(8).nullable(),
    seasonKey: seasonKeySchema,
    lineageRuleVersion: z.string().min(1).max(64),
});
export type HistoricalTeamIdentity = z.infer<typeof historicalTeamIdentitySchema>;
export const coverageSummarySchema = z.object({
    coverageBand: z.enum([
        'advanced-supported',
        'complete-box-derived',
        'late-historical',
        'reconstructed',
    ]),
    observedFamilies: z.array(z.string().min(1).max(64)),
    derivedFamilies: z.array(z.string().min(1).max(64)),
    estimatedFamilies: z.array(z.string().min(1).max(64)),
    reconstructedFamilies: z.array(z.string().min(1).max(64)).optional(),
    missingCategories: z.array(z.string().min(1).max(64)),
    lowConfidenceShare: z.number().min(0).max(1),
    policyVersion: z.string().min(1).max(64),
});
export type CoverageSummary = z.infer<typeof coverageSummarySchema>;
export const unavailabilityReasonSchema = z.enum([
    'no-franchise-history',
    'source-incomplete',
    'identity-failed',
    'insufficient-players',
    'position-coverage-failed',
    'confidence-failed',
    'calibration-failed',
]);
export type UnavailabilityReason = z.infer<typeof unavailabilityReasonSchema>;
export const poolAvailableSchema = z.object({
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    status: z.literal('available'),
    url: z.string().min(1).max(512),
    contentHash: contentHashSchema,
    playerCount: z.number().int().positive(),
    coverageSummary: coverageSummarySchema,
});
export type PoolAvailable = z.infer<typeof poolAvailableSchema>;
export const poolUnavailableSchema = z.object({
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    status: z.literal('unavailable'),
    reason: unavailabilityReasonSchema,
    detail: z.string().min(1).max(256).optional(),
    firstSupportedSeason: seasonKeySchema.optional(),
});
export type PoolUnavailable = z.infer<typeof poolUnavailableSchema>;
export const poolAvailabilitySchema = z.discriminatedUnion('status', [
    poolAvailableSchema,
    poolUnavailableSchema,
]);
export type PoolAvailability = z.infer<typeof poolAvailabilitySchema>;
