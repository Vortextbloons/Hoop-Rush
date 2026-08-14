import { z } from 'zod';
import { playerIdSchema } from './ids.ts';

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

export const playerDiagnosticsSchema = z.object({
  usage: z.number().nonnegative(),

  shotZones: z.array(shotZoneSummarySchema).length(5),

  assistOpportunities: z.number().int().nonnegative(),

  offensiveReboundChances: z.number().int().nonnegative(),

  defensiveReboundChances: z.number().int().nonnegative(),

  contestedShots: z.number().int().nonnegative(),
});
export type PlayerDiagnostics = z.infer<typeof playerDiagnosticsSchema>;

export const teamDiagnosticsSchema = z.object({
  assistedFieldGoals: z.number().int().nonnegative(),

  unassistedFieldGoals: z.number().int().nonnegative(),

  reboundOpportunities: z.number().int().nonnegative(),

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

  diagnostics: playerDiagnosticsSchema.optional(),
});
export type PlayerBoxScore = z.infer<typeof playerBoxScoreSchema>;

export const teamBoxScoreSchema = z.object({
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

  diagnostics: teamDiagnosticsSchema.optional(),
});
export type TeamBoxScore = z.infer<typeof teamBoxScoreSchema>;

export const periodScoresSchema = z.object({
  home: z.array(z.number().int().nonnegative()).min(4).max(12),
  away: z.array(z.number().int().nonnegative()).min(4).max(12),
});
export type PeriodScores = z.infer<typeof periodScoresSchema>;

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

  magnitude: z.number(),

  evidence: z.record(z.string(), z.number()),

  playerIds: z.array(playerIdSchema).max(5).default([]),
});
export type ExplanationFact = z.infer<typeof explanationFactSchema>;

export const teamResultSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  box: teamBoxScoreSchema,
  players: z.array(playerBoxScoreSchema).length(5),

  shotZones: z.array(shotZoneSummarySchema).length(5),
});
export type TeamResult = z.infer<typeof teamResultSchema>;

export const gameResultSchema = z.object({
  schemaVersion: z.literal(1),
  gameNumber: z.number().int().min(1).max(82),

  seed: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  home: teamResultSchema,
  away: teamResultSchema,

  periodScores: periodScoresSchema,
  winner: z.enum(['home', 'away']),
  overtimePeriods: z.number().int().nonnegative(),
  facts: z.array(explanationFactSchema),
});
export type GameResult = z.infer<typeof gameResultSchema>;
