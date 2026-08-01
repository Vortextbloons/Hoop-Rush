import { z } from 'zod';
import { playerIdSchema } from './ids.js';

/**
 * Recorded game results (spec/03 outputs). These facts are the single source
 * for box scores, period scores, shot-zone summaries, and explanations; the
 * UI and CLI never re-derive them from simulation internals.
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
export type MadeAttempted = z.infer<typeof madeAttemptedSchema>;

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

export const periodScoresSchema = z.object({
  home: z.array(z.number().int().nonnegative()).min(4).max(12),
  away: z.array(z.number().int().nonnegative()).min(4).max(12),
});
export type PeriodScores = z.infer<typeof periodScoresSchema>;

/**
 * Structured explanation evidence, backed by simulation accounting (spec/01
 * feedback rules). The engine emits numbers only; Svelte owns the wording.
 * `teamId` is the side the fact describes, `magnitude` a signed effect size,
 * and `evidence` the supporting recorded numbers.
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
  teamId: z.string().min(1).max(64),
  /** Signed effect size of the fact for that team. */
  magnitude: z.number(),
  /** Supporting numbers keyed by name (e.g. { margin: 6, turnovers: 18 }). */
  evidence: z.record(z.string(), z.number()),
  /** Players central to the fact, when one is relevant. */
  playerIds: z.array(playerIdSchema).max(5).default([]),
});
export type ExplanationFact = z.infer<typeof explanationFactSchema>;

export const teamResultSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  box: teamBoxScoreSchema,
  players: z.array(playerBoxScoreSchema).length(5),
  /** Team-specific field-goal attempt summary by zone. */
  shotZones: z.array(shotZoneSummarySchema).length(5),
});
export type TeamResult = z.infer<typeof teamResultSchema>;

export const gameResultSchema = z.object({
  schemaVersion: z.literal(1),
  gameNumber: z.number().int().min(1).max(82),
  /** Derived per-game seed (spec/01). */
  seed: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  home: teamResultSchema,
  away: teamResultSchema,
  /** Period scores; length 4 plus one entry per overtime period. */
  periodScores: periodScoresSchema,
  winner: z.enum(['home', 'away']),
  overtimePeriods: z.number().int().nonnegative(),
  facts: z.array(explanationFactSchema),
});
export type GameResult = z.infer<typeof gameResultSchema>;
