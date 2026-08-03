import { z } from 'zod';
import { playerIdSchema } from './ids.js';

/**
 * Recorded game results (spec/03 outputs). These facts are the single source
 * for box scores, period scores, shot-zone summaries, and explanations; the
 * UI and CLI never re-derive them from simulation internals.
 */

/** Frozen ordered list of shot zones (spec/03). */
export const SHOT_ZONES = ['rim', 'shortMid', 'longMid', 'cornerThree', 'aboveBreakThree'] as const;

export const shotZoneSchema = z.enum(SHOT_ZONES);
export type ShotZone = z.infer<typeof shotZoneSchema>;

export const madeAttemptedSchema = z.object({
  made: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
});
export type MadeAttempted = z.infer<typeof madeAttemptedSchema>;

export const shotZoneSummarySchema = z.object({
  zone: shotZoneSchema,
  attempts: z.number().int().nonnegative(),
  makes: z.number().int().nonnegative(),
});
export type ShotZoneSummary = z.infer<typeof shotZoneSummarySchema>;

/**
 * Opportunity-level diagnostics behind a player's box score (spec/03 outputs).
 * These are recorded events, not derived estimates: usage is the standard
 * possession estimate FGA + 0.44*FTA + TOV, shotZones are per-player field-goal
 * splits, rebound chances count every miss while on the floor, and
 * assistOpportunities are made baskets on passes the player created.
 */
export const playerDiagnosticsSchema = z.object({
  /** Possession estimate used by a player: FGA + 0.44*FTA + TOV. */
  usage: z.number().nonnegative(),
  /** Per-player field-goal attempts/makes by zone (free throws excluded). */
  shotZones: z.array(shotZoneSummarySchema).length(5),
  /** Made field goals on passed possessions created by this player. */
  assistOpportunities: z.number().int().nonnegative(),
  /** Missed shots while this player's team was on offense. */
  offensiveReboundChances: z.number().int().nonnegative(),
  /** Missed shots while this player's team was on defense. */
  defensiveReboundChances: z.number().int().nonnegative(),
  /** Field-goal attempts where this player was the primary defender. */
  contestedShots: z.number().int().nonnegative(),
});
export type PlayerDiagnostics = z.infer<typeof playerDiagnosticsSchema>;

export const teamDiagnosticsSchema = z.object({
  /** Made field goals on passed possessions. */
  assistedFieldGoals: z.number().int().nonnegative(),
  /** Made field goals on unassisted possessions. */
  unassistedFieldGoals: z.number().int().nonnegative(),
  /** Missed field goals plus missed free throws (rebound opportunities). */
  reboundOpportunities: z.number().int().nonnegative(),
  /** Field-goal attempts defended by this team. */
  contestedShots: z.number().int().nonnegative(),
});
export type TeamDiagnostics = z.infer<typeof teamDiagnosticsSchema>;

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
  /** Opportunity-level diagnostics (m3 engine); absent in legacy records. */
  diagnostics: playerDiagnosticsSchema.optional(),
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
  /** Opportunity-level diagnostics (m3 engine); absent in legacy records. */
  diagnostics: teamDiagnosticsSchema.optional(),
});
export type TeamBoxScore = z.infer<typeof teamBoxScoreSchema>;

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
