import { z } from 'zod';
import { franchiseIdSchema, eraIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { difficultyProfileSchema } from './difficulty.ts';
import { lineupSchema } from './lineup.ts';
import { simulationPlayerSchema } from './simulation.ts';
import {
  gameResultSchema,
  playerBoxScoreSchema,
  teamBoxScoreSchema,
  type GameResult,
} from './result.ts';
import { opponentBracketCoreSchema } from './bracket.ts';
import { leagueRecordSchema } from './league.ts';
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
export const runModeSchema = z.enum(['sandbox', 'classic']);
export const runStatusSchema = z.enum(['active', 'finished', 'abandoned']);
export const runOutcomeSchema = z.enum(['perfect', 'eliminated']);
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
  league: leagueRecordSchema.optional(),
  status: runStatusSchema,
  outcome: runOutcomeSchema.optional(),
  firstLossGameNumber: z.number().int().min(1).max(82).nullable(),
  games: z.array(gameResultSchema),
  aggregates: runAggregatesSchema,
});
export type ChallengeRun = z.infer<typeof challengeRunSchema>;

/**
 * Canonical saved-run values.
 *
 * `@hoop-rush/persistence` owns the record envelopes, but these two values are
 * application-facing contracts: a use case hands a completed run and its index
 * to a repository port. Defining them here lets the application describe that
 * commit without importing the storage package.
 */
export const storedRunRecordSchema = z.object({
  recordId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  run: challengeRunSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredRunRecord = z.infer<typeof storedRunRecordSchema>;

export const completedRunIndexSchema = z.object({
  recordId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  mode: runModeSchema,
  variant: classicVariantSchema.optional(),
  franchiseId: z.string().min(1).max(64).nullable(),
  eraId: z.string().min(1).max(24),
  playerIds: z.array(playerIdSchema).length(5),
  selections: z.array(runPlayerSelectionSchema).length(5).optional(),
  runSeed: seedSchema,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().positive(),
  outcome: runOutcomeSchema,
  completedAtIso: z.iso.datetime(),
});
export type CompletedRunIndex = z.infer<typeof completedRunIndexSchema>;

/** Values a save commit must observe when promoting an active run. */
export interface PromoteActiveToCompletedExpectation {
  expectedGamesPlayed: number;
  expectedRunDigest: string;
}

/** One accepted game appended to an active run. */
export interface ActiveGameAppend {
  runId: string;
  gameNumber: number;
  result: GameResult;
  aggregates: RunAggregates;
  status: 'active' | 'finished';
  firstLossGameNumber: number | null;
}
