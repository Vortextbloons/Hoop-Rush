import { z } from 'zod';
import {
  bbrefIdSchema,
  franchiseIdSchema,
  playerExternalIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from './ids.js';
import { playerSeasonStatsSchema } from './player-season.js';
import { positionUnionSchema } from './positions.js';

/**
 * The global players index artifact produced at build time (file
 * apps/web/static/data/players-index.json). It is the single entry point for
 * free-form sandbox lineups: every distinct eligible peak player-season
 * across all franchise/era pools, one entry per player.
 */

export const playersIndexEntrySchema = z.object({
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
  positionsCanonical: positionUnionSchema,
  /**
   * Overall on the 0-100 scale the draft displays: the detailed per-skill
   * overall when the packaged pool carries it, else the summary shorthand.
   */
  overall: z.number().int().min(0).max(100),
  /** Balanced summary offense shorthand on a 0-100 scale. */
  offense: z.number().int().min(0).max(100),
  /** Balanced summary defense shorthand on a 0-100 scale. */
  defense: z.number().int().min(0).max(100),
  /** Deterministic peak-selection score (spec/02). */
  selectionScore: z.number().min(0).max(999),
  /** Physical measurements, when published. */
  heightInches: z.number().int().min(60).max(96).nullable(),
  weightLbs: z.number().int().min(120).max(400).nullable(),
  /** The selected season's counting statistics and advanced metrics. */
  stats: playerSeasonStatsSchema,
});
export type PlayersIndexEntry = z.infer<typeof playersIndexEntrySchema>;

/** Versioned global index of every eligible peak player-season. */
export const playersIndexSchema = z.object({
  schemaVersion: z.literal(2),
  dataVersion: z.string().min(1).max(64),
  players: z.array(playersIndexEntrySchema),
});
export type PlayersIndex = z.infer<typeof playersIndexSchema>;
