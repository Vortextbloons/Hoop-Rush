import { z } from 'zod';
import { franchiseIdSchema, eraIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { difficultyProfileSchema } from './difficulty.ts';
import { lineupSchema } from './lineup.ts';
import { simulationPlayerSchema } from './simulation.ts';
import { gameResultSchema, playerBoxScoreSchema, teamBoxScoreSchema } from './result.ts';
import { opponentBracketCoreSchema } from './bracket.ts';
import { RUN_SCHEMA_VERSION, SAVE_SCHEMA_VERSION } from './versions.ts';
import { classicCompletedDraftSchema, classicVariantSchema } from './classic.ts';
export const runVersionBoundariesSchema = z.object({
  saveSchemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  dataVersion: z.string().min(1).max(64),
  ratingVersion: z.string().min(1).max(64),
  positionNormalizationVersion: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  seedDerivationVersion: z.string().min(1).max(64),
});
export type RunVersionBoundaries = z.infer<typeof runVersionBoundariesSchema>;
export const runModeSchema = z.enum(['sandbox', 'classic']);
export type RunMode = z.infer<typeof runModeSchema>;
export const runStatusSchema = z.enum(['active', 'finished', 'abandoned']);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const runOutcomeSchema = z.enum(['perfect', 'eliminated']);
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
export const playerSeasonAggregateSchema = playerBoxScoreSchema
  .omit({ diagnostics: true })
  .extend({ gamesPlayed: z.number().int().nonnegative() });
export type PlayerSeasonAggregate = z.infer<typeof playerSeasonAggregateSchema>;
export const teamAggregateSchema = teamBoxScoreSchema
  .omit({ teamId: true, diagnostics: true })
  .extend({
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    gamesPlayed: z.number().int().nonnegative(),
  });
export type TeamAggregate = z.infer<typeof teamAggregateSchema>;
export const runAggregatesSchema = z.object({
  team: teamAggregateSchema,
  players: z.array(playerSeasonAggregateSchema).length(5),
});
export type RunAggregates = z.infer<typeof runAggregatesSchema>;
export const runPlayerSelectionSchema = z.object({
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
});
export type RunPlayerSelection = z.infer<typeof runPlayerSelectionSchema>;
export const challengeRunSchema = z.object({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  runId: z.string().min(1).max(64),
  mode: runModeSchema,
  variant: classicVariantSchema.optional(),
  classicDraft: classicCompletedDraftSchema.optional(),
  franchiseId: franchiseIdSchema.nullable(),
  eraId: eraIdSchema,
  homeDisplayName: z.string().min(1).max(96),
  playerIds: z.array(playerIdSchema).length(5),
  selections: z.array(runPlayerSelectionSchema).length(5).optional(),
  lineup: lineupSchema,
  players: z.array(simulationPlayerSchema).length(5),
  runSeed: seedSchema,
  versions: runVersionBoundariesSchema,
  eraProfileVersion: z.string().min(1).max(64),
  difficulty: difficultyProfileSchema,
  bracket: opponentBracketCoreSchema,
  status: runStatusSchema,
  outcome: runOutcomeSchema.optional(),
  firstLossGameNumber: z.number().int().min(1).max(82).nullable(),
  games: z.array(gameResultSchema),
  aggregates: runAggregatesSchema,
});
export type ChallengeRun = z.infer<typeof challengeRunSchema>;
