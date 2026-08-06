import { z } from 'zod';
import {
  bbrefIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerExternalIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from './ids.ts';
import {
  positionNormalizationVersionSchema,
  positionSchema,
  positionUnionSchema,
  sourcePositionSchema,
} from './positions.ts';
import {
  simulationRatingsSchema,
  simulationTendenciesSchema,
  simulationAnchorsSchema,
  reconstructedThreePointProfileSchema,
} from './simulation.ts';
import {
  historicalTeamIdentitySchema,
  provenanceMapSchema,
  coverageSummarySchema,
} from './provenance.ts';
import { ratingProfileSchema } from './ratings-model.ts';

/**
 * Player-season records and the packaged peak-season pools they feed
 * (spec/02 and spec/12).
 *
 * Eligibility and peak selection follow spec/02: team-stint games (not league
 * totals) establish the 40-game rule; each distinct player appears once per
 * franchise/decade pool as their best eligible season.
 *
 * Historical observation rules (spec/12): a field that is genuinely absent
 * from the available source evidence is `null` — never a converted zero.
 * Pre-1979 three-point observations are `not-applicable` (a league rule, not
 * a player judgment), and every packaged value carries field-level
 * provenance.
 */

/**
 * Counting statistics for one player-season. Fields that predate their
 * league-wide availability (steals/blocks before 1973-74, turnovers before
 * 1977-78, rebound splits before 1973-74, threes before 1979-80) are
 * nullable: `null` means unavailable evidence, never a zero observation.
 */
export const playerSeasonStatsSchema = z.object({
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  rebounds: z.number().int().nonnegative(),
  /** Null when the source did not publish offensive rebounds. */
  offensiveRebounds: z.number().int().nonnegative().nullable(),
  /** Null when the source did not publish defensive rebounds. */
  defensiveRebounds: z.number().int().nonnegative().nullable(),
  assists: z.number().int().nonnegative(),
  /** Null when the source did not publish steals. */
  steals: z.number().int().nonnegative().nullable(),
  /** Null when the source did not publish blocks. */
  blocks: z.number().int().nonnegative().nullable(),
  /** Null when the source did not publish turnovers. */
  turnovers: z.number().int().nonnegative().nullable(),
  fieldGoalsMade: z.number().int().nonnegative(),
  fieldGoalsAttempted: z.number().int().nonnegative(),
  /** Null before 1979-80; the shot did not exist as a league rule. */
  threesMade: z.number().int().nonnegative().nullable(),
  /** Null before 1979-80; the shot did not exist as a league rule. */
  threesAttempted: z.number().int().nonnegative().nullable(),
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

export const sourceMetadataSchema = z.object({
  dataVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  selectionScoreVersion: z.string().min(1).max(64),
  /** Cached source snapshot version (spec/12 provenance). */
  sourceVersion: z.string().min(1).max(64),
  /** Field-method registry version (spec/12 derivation ladder). */
  derivationMethodVersion: z.string().min(1).max(64),
  /** Lineage rule version that resolved this player's team ownership. */
  lineageRuleVersion: z.string().min(1).max(64),
});
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

/** Optional secondary external IDs that resolve fallback assets (headshots). */
export const playersIndexAltIdsSchema = z
  .object({
    bbref: bbrefIdSchema.nullable().optional(),
    /** When false, the NBA CDN only serves the generic silhouette for this player. */
    nbaHeadshotAvailable: z.boolean().optional(),
    /** Direct fallback image URL (e.g. a Wikipedia thumbnail), used as a final candidate. */
    photoUrl: z.url().nullable().optional(),
  })
  .nullable();
export type PlayersIndexAltIds = z.infer<typeof playersIndexAltIdsSchema>;

/**
 * Peak player-season record (spec/02). One versioned row per franchise-era
 * pool: eligibility, peak selection, packaged ratings, tendencies, anchors,
 * provenance, and summary UI ratings. Validation is strict so packaging
 * failures surface at build time, never in the browser.
 */
export const peakPlayerSeasonSchema = z.object({
  schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  /** Season key of the selected peak season. */
  seasonKey: seasonKeySchema,
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  /** External NBA ID used to resolve a headshot URL. */
  playerExternalId: playerExternalIdSchema,
  /** Optional secondary external IDs that resolve fallback assets (headshots). */
  altIds: playersIndexAltIdsSchema.optional(),
  /** Career-wide playable positions (spec/02). */
  positions: z.object({
    /** Reviewed authoritative primary position (PG/SG/SF/PF/C). */
    primary: positionSchema,
    /** Reviewed secondary positions (usually empty; e.g. Wembanyama: primary C, secondary ['SF']). */
    secondary: z.array(positionSchema).max(4),
    /** Career-wide playable union: primary + secondary + every career source label (detailed). */
    playable: positionUnionSchema,
    /** Original source labels exactly as ingested, including unknown labels, for auditing. */
    sourceLabels: z.array(sourcePositionSchema).min(1),
    normalizationVersion: positionNormalizationVersionSchema,
  }),
  heightInches: z.number().int().min(60).max(96).nullable(),
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
  /** Historical team that owned this season (e.g. Seattle SuperSonics). */
  historicalTeamIdentity: historicalTeamIdentitySchema,
  summaryRatings: summaryRatingsSchema,
  /** Ratings v3 explanation and calibration profile. Optional only for legacy frozen assets. */
  ratingProfile: ratingProfileSchema.optional(),
  /** Strict engine ratings contract; packaging fails on missing keys. */
  detailedRatings: simulationRatingsSchema,
  /** Strict engine tendencies contract; packaging fails on missing keys. */
  tendencies: simulationTendenciesSchema,
  /** Packaged simulation anchors; the engine adapter no longer recomputes them. */
  anchors: simulationAnchorsSchema,
  /** Conservative reconstructed three-point profile (pre-1979/missing records only). */
  reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
  /** Field-level provenance for every packaged value (spec/12). */
  provenance: provenanceMapSchema,
  source: sourceMetadataSchema,
});
export type PeakPlayerSeason = z.infer<typeof peakPlayerSeasonSchema>;

/** Compact, directly indexed franchise/decade pool (spec/02 fast-load artifact). */
export const franchiseEraPoolSchema = z.object({
  schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  dataVersion: z.string().min(1).max(64),
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  eligibility: z.object({ minimumTeamGames: z.literal(40) }),
  /** Compact coverage label for the whole pool (spec/12). */
  coverageSummary: coverageSummarySchema,
  players: z.array(peakPlayerSeasonSchema).min(1),
});
export type FranchiseEraPool = z.infer<typeof franchiseEraPoolSchema>;

/**
 * Lightweight draft row: one peak player-season with summary ratings
 * flattened for fast filtering and sorting without loading full pool
 * artifacts or the heavier roster details (spec/02). Identity, context,
 * positions, and image identifiers only; season statistics and
 * height/weight live in the separate roster-details asset.
 */
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
  /** Career-wide detailed playable union, for filtering by slot group. */
  positionsPlayable: positionUnionSchema,
  overall: z.number().int().min(0).max(100),
  offense: z.number().int().min(0).max(100),
  defense: z.number().int().min(0).max(100),
  selectionScore: z.number().min(0).max(999),
  /** Version of the canonical OVR model used for this compact row. */
  ratingModelVersion: z.string().min(1).max(64).optional(),
});
export type PlayersIndexEntry = z.infer<typeof playersIndexEntrySchema>;

/**
 * Draft index (global players index): every packaged peak player-season as a
 * compact identity/ratings row. Loaded by the draft, classic, and result
 * screens; the Roster screen additionally loads the roster-details asset.
 */
export const playersIndexSchema = z.object({
  schemaVersion: z.union([z.literal(4), z.literal(5)]),
  dataVersion: z.string().min(1).max(64),
  players: z.array(playersIndexEntrySchema).min(1),
});
export type PlayersIndex = z.infer<typeof playersIndexSchema>;

/**
 * Heavy roster-browser details: the season statistics and physical profile
 * behind a draft row, kept out of the draft index so sandbox and classic
 * never parse them. Loaded lazily by the Roster screen only. The identity
 * fields mirror the draft row: the same playerId can peak in several
 * franchise/era contexts, so the composite key (playerId + franchiseId +
 * eraId + seasonKey) is the join key.
 */
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

/** Roster-details asset: one entry per draft row, addressable by playerId. */
export const rosterDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  dataVersion: z.string().min(1).max(64),
  players: z.array(rosterDetailsEntrySchema).min(1),
});
export type RosterDetails = z.infer<typeof rosterDetailsSchema>;
