import { z } from 'zod';
import { playerIdSchema } from './ids.js';

/**
 * Recorded game and challenge results (spec/03 outputs). These facts are the
 * source for box scores, aggregates, and explanations; the UI never re-derives
 * them from simulation internals.
 */

export const shotZoneSchema = z.enum([
  'rim',
  'shortMid',
  'longMid',
  'cornerThree',
  'aboveBreakThree',
]);
export type ShotZone = z.infer<typeof shotZoneSchema>;

export const madeAttemptedSchema = z.object({
  made: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
});

export const playerBoxScoreSchema = z.object({
  playerId: playerIdSchema,
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
export type PlayerBoxScore = z.infer<typeof playerBoxScoreSchema>;

export const teamBoxScoreSchema = z.object({
  /** Franchise ID, or the literal "user" for the player's lineup. */
  teamId: z.string().min(1).max(64),
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
export type TeamBoxScore = z.infer<typeof teamBoxScoreSchema>;

export const shotZoneSummarySchema = z.object({
  zone: shotZoneSchema,
  attempts: z.number().int().nonnegative(),
  makes: z.number().int().nonnegative(),
});
export type ShotZoneSummary = z.infer<typeof shotZoneSummarySchema>;

/**
 * A recorded explanation fact, backed by simulation accounting (spec/01
 * feedback rules). Kinds expand as the engine emits them; unknown kinds are
 * rejected at runtime boundaries.
 */
export const explanationFactSchema = z.object({
  kind: z.enum([
    'turnoverMargin',
    'shotEfficiency',
    'offensiveRebounds',
    'freeThrows',
    'usage',
    'overtime',
  ]),
  /** Human-readable statement derived from recorded facts. */
  label: z.string().min(1).max(160),
  /** Numeric evidence backing the statement. */
  value: z.number(),
  playerId: playerIdSchema.optional(),
});
export type ExplanationFact = z.infer<typeof explanationFactSchema>;

export const gameResultSchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  /** Derived per-game seed (spec/01). */
  seed: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  home: z.object({
    teamId: z.string().min(1).max(64),
    box: teamBoxScoreSchema,
    players: z.array(playerBoxScoreSchema).length(5),
  }),
  away: z.object({
    teamId: z.string().min(1).max(64),
    box: teamBoxScoreSchema,
    players: z.array(playerBoxScoreSchema).length(5),
  }),
  winner: z.enum(['home', 'away']),
  overtimePeriods: z.number().int().nonnegative(),
  shotZones: z.array(shotZoneSummarySchema).length(5),
  facts: z.array(explanationFactSchema),
});
export type GameResult = z.infer<typeof gameResultSchema>;
