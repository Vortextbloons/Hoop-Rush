import { z } from 'zod';
import {
  bbrefIdSchema,
  franchiseIdSchema,
  playerExternalIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from './ids.js';
import {
  positionNormalizationVersionSchema,
  positionUnionSchema,
  sourcePositionSchema,
} from './positions.js';

/**
 * Player-season records and the packaged peak-season pools they feed.
 *
 * Eligibility and peak selection follow spec/02: team-stint games (not league
 * totals) establish the 40-game rule; each distinct player appears once per
 * franchise/decade pool as their best eligible season.
 */

/** Counting statistics for one player-season (league totals may exceed team stint). */
export const playerSeasonStatsSchema = z.object({
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  rebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fieldGoalsMade: z.number().int().nonnegative(),
  fieldGoalsAttempted: z.number().int().nonnegative(),
  threesMade: z.number().int().nonnegative(),
  threesAttempted: z.number().int().nonnegative(),
  freeThrowsMade: z.number().int().nonnegative(),
  freeThrowsAttempted: z.number().int().nonnegative(),
  /** Player efficiency rating, when published by the source. */
  per: z.number().nullable(),
  /** Box plus/minus, when published or derived. */
  boxPlusMinus: z.number().nullable(),
  /** Usage percentage 0-100, when published or derived. */
  usageRate: z.number().min(0).max(100).nullable(),
  /** True-shooting percentage 0-1, when published or derived. */
  tsPct: z.number().min(0).max(1).nullable(),
  /** Effective field-goal percentage 0-1, when published or derived. */
  efgPct: z.number().min(0).max(1).nullable(),
});
export type PlayerSeasonStats = z.infer<typeof playerSeasonStatsSchema>;

/**
 * One player-season-team row. Eligibility for a franchise/decade pool is
 * evaluated on the team stint, never on league-wide totals.
 */
export const teamStintSchema = z.object({
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  seasonKey: seasonKeySchema,
  /** Games played for this franchise in this season. */
  teamGames: z.number().int().nonnegative(),
  /** Minutes played for this franchise in this season. */
  teamMinutes: z.number().int().nonnegative(),
});
export type TeamStint = z.infer<typeof teamStintSchema>;

/** Confidence of a packaged field per spec/02 historical derivation rules. */
export const dataConfidenceSchema = z.enum([
  'observed',
  'derived-high',
  'derived-medium',
  'derived-low',
]);
export type DataConfidence = z.infer<typeof dataConfidenceSchema>;

/** Summary ratings shown in the draft UI. Never possession inputs (spec/11). */
export const summaryRatingsSchema = z.object({
  /** Balanced shorthand for comparison on a 0-100 scale. */
  overallRating: z.number().int().min(0).max(100),
  /** Expected offensive contribution on a 0-100 scale. */
  offenseRating: z.number().int().min(0).max(100),
  /** Expected defensive contribution on a 0-100 scale. */
  defenseRating: z.number().int().min(0).max(100),
});
export type SummaryRatings = z.infer<typeof summaryRatingsSchema>;

/**
 * Detailed possession-resolution attributes on a 0-100 scale. Keys are frozen
 * when the possession engine (M2) locks its consumption contract; until then
 * any named attribute in range is accepted at runtime boundaries.
 */
export const detailedRatingsSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  z.number().int().min(0).max(100),
);
export type DetailedRatings = z.infer<typeof detailedRatingsSchema>;

/** Tendency values (rates/percentages) preserved separately from ability. */
export const tendenciesSchema = z.record(z.string(), z.number());
export type Tendencies = z.infer<typeof tendenciesSchema>;

export const sourceMetadataSchema = z.object({
  dataVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  selectionScoreVersion: z.string().min(1).max(64),
});
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

/**
 * One packaged peak player-season: the representative version of a player
 * within a franchise/decade pool. Produced at build time, validated at load.
 */
export const peakPlayerSeasonSchema = z.object({
  schemaVersion: z.number().int().positive(),
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: z.string().min(1).max(24),
  /** Season key of the selected peak season. */
  seasonKey: seasonKeySchema,
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  /** External NBA ID used to resolve a headshot URL. */
  playerExternalId: playerExternalIdSchema,
  /** Optional secondary external IDs that resolve fallback assets (headshots). */
  altIds: z
    .object({
      /** Basketball-Reference player ID, substituted into the secondary headshot template. */
      bbref: bbrefIdSchema.nullable().optional(),
      /** When false, the NBA CDN only serves the generic silhouette for this player. */
      nbaHeadshotAvailable: z.boolean().optional(),
      /** Direct fallback image URL (e.g. a Wikipedia thumbnail), used as a final candidate. */
      photoUrl: z.string().url().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Career-wide playable positions (spec/02). */
  positions: z.object({
    sourceLabels: z.array(sourcePositionSchema).min(1),
    canonical: positionUnionSchema,
    normalizationVersion: positionNormalizationVersionSchema,
  }),
  heightInches: z.number().int().min(60).max(90).nullable(),
  weightLbs: z.number().int().min(120).max(400).nullable(),
  /** Team-stint eligibility facts for the selected season. */
  eligibility: z.object({
    minimumTeamGames: z.literal(40),
    teamGames: z.number().int().min(40),
    teamMinutes: z.number().int().nonnegative(),
  }),
  /** Deterministic peak-selection score and its version (spec/02). */
  selectionScore: z.number().min(0).max(999),
  selectionScoreVersion: z.string().min(1).max(64),
  /** The selected season's counting statistics (league totals for context). */
  stats: playerSeasonStatsSchema,
  summaryRatings: summaryRatingsSchema,
  detailedRatings: detailedRatingsSchema,
  tendencies: tendenciesSchema,
  /** Highest-confidence provenance across packaged fields. */
  dataConfidence: dataConfidenceSchema,
  source: sourceMetadataSchema,
});
export type PeakPlayerSeason = z.infer<typeof peakPlayerSeasonSchema>;

/** Compact, directly indexed franchise/decade pool (spec/02 fast-load artifact). */
export const franchiseEraPoolSchema = z.object({
  schemaVersion: z.number().int().positive(),
  dataVersion: z.string().min(1).max(64),
  franchiseId: franchiseIdSchema,
  eraId: z.string().min(1).max(24),
  eligibility: z.object({ minimumTeamGames: z.literal(40) }),
  players: z.array(peakPlayerSeasonSchema).min(1),
});
export type FranchiseEraPool = z.infer<typeof franchiseEraPoolSchema>;
