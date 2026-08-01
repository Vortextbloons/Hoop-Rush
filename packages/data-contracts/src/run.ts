import { z } from 'zod';
import { franchiseIdSchema, playerIdSchema, seedSchema } from './ids.js';
import { difficultyProfileSchema } from './difficulty.js';

/**
 * Accepted challenge-run state (spec/04 minimal run state). The domain shape of
 * an active or completed Sandbox run; persistence wraps it with storage
 * metadata. Only accepted domain state is ever persisted.
 */

export const runVersionBoundariesSchema = z.object({
  /** Persisted-save layout version. */
  saveSchemaVersion: z.number().int().positive(),
  /** Static data (pools, eras, lineage) version. */
  dataVersion: z.string().min(1).max(64),
  /** Rating derivation version. */
  ratingVersion: z.string().min(1).max(64),
  /** Position-normalization version. */
  positionNormalizationVersion: z.string().min(1).max(64),
  /** Possession engine version. */
  engineVersion: z.string().min(1).max(64),
  /** Opponent-bracket version (fixed content, empty until M3). */
  bracketVersion: z.string().min(1).max(64),
  /** Shared 82-game schedule version (fixed content, empty until M3). */
  scheduleVersion: z.string().min(1).max(64),
});
export type RunVersionBoundaries = z.infer<typeof runVersionBoundariesSchema>;

export const runModeSchema = z.enum(['sandbox', 'classic']);
export type RunMode = z.infer<typeof runModeSchema>;

export const classicVariantSchema = z.enum(['ratings', 'ball-knowledge']);
export type ClassicVariant = z.infer<typeof classicVariantSchema>;

export const runStatusSchema = z.enum(['active', 'eliminated', 'finished', 'abandoned']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const challengeRunSchema = z.object({
  runId: z.string().min(1).max(64),
  mode: runModeSchema,
  /** Immutable after creation; present only for classic mode. */
  variant: classicVariantSchema.optional(),
  /** Sandbox selection. */
  franchiseId: franchiseIdSchema,
  eraId: z.string().min(1).max(24),
  /** Exactly five distinct selected peak player-seasons. */
  playerIds: z.array(playerIdSchema).length(5),
  /** Run seed; per-game seeds derive from this value. */
  runSeed: seedSchema,
  versions: runVersionBoundariesSchema,
  difficulty: difficultyProfileSchema,
  status: runStatusSchema,
  /** Fixed schedule references; opponents appear in order of the shared schedule. */
  schedule: z.object({
    /** 30 fixed opponent franchise IDs (fixed bracket content). */
    opponents: z.array(franchiseIdSchema).length(30),
  }),
  /** Recorded game results in played order; empty until M2. */
  games: z.array(z.object({ gameNumber: z.number().int().min(1).max(82) })).default([]),
  /** Compact completed-run totals for history (filled when complete). */
  totals: z
    .object({
      wins: z.number().int().nonnegative(),
      losses: z.number().int().nonnegative(),
      gamesPlayed: z.number().int().nonnegative(),
    })
    .optional(),
});
export type ChallengeRun = z.infer<typeof challengeRunSchema>;
