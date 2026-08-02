import { z } from 'zod';
import { franchiseIdSchema, playerIdSchema, seedSchema } from './ids.js';
import { difficultyProfileSchema } from './difficulty.js';
import { lineupSchema } from './lineup.js';
import { simulationPlayerSchema } from './simulation.js';
import { madeAttemptedSchema, gameResultSchema } from './result.js';
import { opponentBracketCoreSchema } from './bracket.js';
import { RUN_SCHEMA_VERSION, SAVE_SCHEMA_VERSION } from './versions.js';

/**
 * Accepted challenge-run state (spec/04 minimal run state). The domain shape
 * of an active or completed Sandbox run; persistence wraps it with storage
 * metadata. Only accepted domain state is ever persisted, and every result
 * is verified by the challenge command before it joins the run.
 */

export const runVersionBoundariesSchema = z.object({
  /** Persisted-save layout version (3 = checkpoint + game rows). */
  saveSchemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  /** Static data (pools, eras, lineage) version. */
  dataVersion: z.string().min(1).max(64),
  /** Rating derivation version. */
  ratingVersion: z.string().min(1).max(64),
  /** Position-normalization version. */
  positionNormalizationVersion: z.string().min(1).max(64),
  /** Possession engine version. */
  engineVersion: z.string().min(1).max(64),
  /** Opponent-bracket version (fixed content). */
  bracketVersion: z.string().min(1).max(64),
  /** Shared 82-game schedule version (fixed content). */
  scheduleVersion: z.string().min(1).max(64),
  /** Per-game seed derivation version. */
  seedDerivationVersion: z.string().min(1).max(64),
});
export type RunVersionBoundaries = z.infer<typeof runVersionBoundariesSchema>;

export const runModeSchema = z.enum(['sandbox', 'classic']);
export type RunMode = z.infer<typeof runModeSchema>;

export const classicVariantSchema = z.enum(['ratings', 'ball-knowledge']);
export type ClassicVariant = z.infer<typeof classicVariantSchema>;

export const runStatusSchema = z.enum(['active', 'finished', 'abandoned']);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** Final outcome of a finished run: all 82 wins or at least one loss. */
export const runOutcomeSchema = z.enum(['perfect', 'eliminated']);
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

/** Exact season totals for one user player, accumulated from accepted results. */
export const playerSeasonAggregateSchema = z.object({
  playerId: playerIdSchema,
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  fieldGoals: madeAttemptedSchema,
  threes: madeAttemptedSchema,
  freeThrows: madeAttemptedSchema,
  rebounds: z.object({
    total: z.number().int().nonnegative(),
    offensive: z.number().int().nonnegative(),
    defensive: z.number().int().nonnegative(),
  }),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
});
export type PlayerSeasonAggregate = z.infer<typeof playerSeasonAggregateSchema>;

/** Exact season totals for the user's team, accumulated from accepted results. */
export const teamAggregateSchema = z.object({
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  fieldGoals: madeAttemptedSchema,
  threes: madeAttemptedSchema,
  freeThrows: madeAttemptedSchema,
  rebounds: z.object({
    total: z.number().int().nonnegative(),
    offensive: z.number().int().nonnegative(),
    defensive: z.number().int().nonnegative(),
    team: z.number().int().nonnegative(),
  }),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  possessions: z.number().int().nonnegative(),
});
export type TeamAggregate = z.infer<typeof teamAggregateSchema>;

export const runAggregatesSchema = z.object({
  team: teamAggregateSchema,
  players: z.array(playerSeasonAggregateSchema).length(5),
});
export type RunAggregates = z.infer<typeof runAggregatesSchema>;

/**
 * Provenance of one lineup slot: which franchise/era pool the selected
 * peak player-season was drawn from. Present on runs whose lineup mixes
 * players from any franchise/era pool (free-form sandbox).
 */

export const challengeRunSchema = z.object({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  runId: z.string().min(1).max(64),
  mode: runModeSchema,
  /** Immutable after creation; present only for classic mode. */
  variant: classicVariantSchema.optional(),
  /**
   * The selected modern franchise slot. Required: every sandbox run drafts
   * exactly five players from this one franchise's selected-decade pool.
   */
  franchiseId: franchiseIdSchema,
  /**
   * The selected decade. It is both the pool era and the simulation
   * environment era: every accepted game result must report the matching
   * era profile version.
   */
  eraId: z.string().min(1).max(24),
  /** Display name for the user's lineup (resolved from lineage at creation). */
  homeDisplayName: z.string().min(1).max(96),
  /** Exactly five distinct selected peak player-seasons, in slot order. */
  playerIds: z.array(playerIdSchema).length(5),
  /** Legal G,G,F,F,C assignment validated at creation. */
  lineup: lineupSchema,
  /** Five immutable SimulationPlayer snapshots matching the lineup. */
  players: z.array(simulationPlayerSchema).length(5),
  /** Run seed; per-game seeds derive from this value. */
  runSeed: seedSchema,
  versions: runVersionBoundariesSchema,
  /** Era simulation profile version every accepted result must report. */
  eraProfileVersion: z.string().min(1).max(64),
  difficulty: difficultyProfileSchema,
  /** Complete frozen bracket content (30 opponents + 82-game schedule). */
  bracket: opponentBracketCoreSchema,
  status: runStatusSchema,
  /** Final outcome; present once the run is finished. */
  outcome: runOutcomeSchema.optional(),
  /** First loss game number (1-82), or null while the run is undefeated. */
  firstLossGameNumber: z.number().int().min(1).max(82).nullable(),
  /** Accepted game results in schedule order. */
  games: z.array(gameResultSchema),
  /** Exact season totals accumulated from accepted results. */
  aggregates: runAggregatesSchema,
});
export type ChallengeRun = z.infer<typeof challengeRunSchema>;
