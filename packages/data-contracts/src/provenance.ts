import { z } from 'zod';
import { contentHashSchema, franchiseIdSchema, eraIdSchema, seasonKeySchema } from './ids.js';

/**
 * Field-level provenance, coverage summaries, and the franchise-era
 * availability matrix (spec/12). Provenance answers how a value was produced;
 * confidence answers how strongly the available evidence supports it. They are
 * separate fields, assigned by versioned rules — never hand-chosen to make a
 * famous player look correct.
 */

export const provenanceKindSchema = z.enum(['observed', 'derived', 'estimated']);
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof confidenceSchema>;

/** Why a source field is absent from a record (spec/12 source availability). */
export const sourceStatusSchema = z.enum(['available', 'unavailable', 'not-applicable']);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const historicalValueProvenanceSchema = z.object({
  /** How the value was produced. */
  kind: provenanceKindSchema,
  /** How strongly the available evidence supports it. */
  confidence: confidenceSchema,
  /** Field-method registry version (spec/12 derivation ladder). */
  methodVersion: z.string().min(1).max(64),
  /** Cached source snapshot version behind the value. */
  sourceVersion: z.string().min(1).max(64),
  /** Source fields consumed by the method. */
  sourceFields: z.array(z.string().min(1).max(64)),
  /** Games of the observed/derived sample, when applicable. */
  sampleGames: z.number().int().nonnegative().optional(),
  /** Minutes of the observed/derived sample, when applicable. */
  sampleMinutes: z.number().nonnegative().optional(),
  /** Presence of the field in the source: unavailable is not a zero. */
  sourceStatus: sourceStatusSchema.optional(),
  /** Diagnostic note code; never a human narrative. */
  notesCode: z.string().min(1).max(64).optional(),
});
export type HistoricalValueProvenance = z.infer<typeof historicalValueProvenanceSchema>;

/** Field-level provenance map keyed by packaged field name. */
export const provenanceMapSchema = z.record(
  z.string().min(1).max(64),
  historicalValueProvenanceSchema,
);
export type ProvenanceMap = z.infer<typeof provenanceMapSchema>;

/** Historical team identity attached to a peak player-season for display. */
export const historicalTeamIdentitySchema = z.object({
  /** Historical team ID of the selected season (e.g. Seattle's source ID). */
  teamId: z.string().min(1).max(64),
  /** Historical display name (e.g. "Seattle SuperSonics"). */
  displayName: z.string().min(1).max(64),
  /** Historical city (e.g. "Seattle"). */
  city: z.string().min(1).max(64),
  /** Historical abbreviation when known (e.g. "SEA"). */
  abbreviation: z.string().min(1).max(8).nullable(),
  /** The season the identity describes. */
  seasonKey: seasonKeySchema,
  /** Lineage rule version that mapped this identity to the modern slot. */
  lineageRuleVersion: z.string().min(1).max(64),
});
export type HistoricalTeamIdentity = z.infer<typeof historicalTeamIdentitySchema>;

/** Compact pool coverage label for headers and cards (spec/12 honesty rules). */
export const coverageSummarySchema = z.object({
  /** e.g. "advanced-supported", "complete-box-derived", "late-historical", "reconstructed". */
  coverageBand: z.enum([
    'advanced-supported',
    'complete-box-derived',
    'late-historical',
    'reconstructed',
  ]),
  /** Field families present as observations. */
  observedFamilies: z.array(z.string().min(1).max(64)),
  /** Field families that are derived rather than observed. */
  derivedFamilies: z.array(z.string().min(1).max(64)),
  /** Field families that are estimated rather than observed. */
  estimatedFamilies: z.array(z.string().min(1).max(64)),
  /** Genuinely missing historical categories (never zero-filled). */
  missingCategories: z.array(z.string().min(1).max(64)),
  /** Share of required fields with low confidence, 0-1. */
  lowConfidenceShare: z.number().min(0).max(1),
  /** Confidence policy version that classified this pool. */
  policyVersion: z.string().min(1).max(64),
});
export type CoverageSummary = z.infer<typeof coverageSummarySchema>;

/** Stable reasons a franchise-era combination is not playable. */
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

/** Discriminated franchise-era availability entry (spec/12 matrix). */
export const poolAvailableSchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  status: z.literal('available'),
  /** URL of the compact FranchiseEraPool asset. */
  url: z.string().min(1).max(512),
  /** SHA-256 content hash of the referenced asset. */
  contentHash: contentHashSchema,
  /** Packaged player count. */
  playerCount: z.number().int().positive(),
  coverageSummary: coverageSummarySchema,
});
export type PoolAvailable = z.infer<typeof poolAvailableSchema>;

export const poolUnavailableSchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  status: z.literal('unavailable'),
  /** Versioned reason; the browser never infers availability. */
  reason: unavailabilityReasonSchema,
  /** Machine-readable detail (e.g. missing source team-season count). */
  detail: z.string().min(1).max(256).optional(),
  /** First season the modern slot has NBA history, when known. */
  firstSupportedSeason: seasonKeySchema.optional(),
});
export type PoolUnavailable = z.infer<typeof poolUnavailableSchema>;

export const poolAvailabilitySchema = z.discriminatedUnion('status', [
  poolAvailableSchema,
  poolUnavailableSchema,
]);
export type PoolAvailability = z.infer<typeof poolAvailabilitySchema>;
