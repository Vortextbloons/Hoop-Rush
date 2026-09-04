import { z } from 'zod';
import {
  challengeRunSchema,
  CHECKPOINT_SAVE_SCHEMA_VERSION,
  classicVariantSchema,
  gameResultSchema,
  playerIdSchema,
  runModeSchema,
  runStatusSchema,
  runOutcomeSchema,
  runPlayerSelectionSchema,
  RUN_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSION,
  seedSchema,
  type ChallengeRun,
  type GameResult,
  type RunAggregates,
} from '@hoop-rush/data-contracts';
export const storedRunRecordSchema = z.object({
  recordId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  run: challengeRunSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredRunRecord = z.infer<typeof storedRunRecordSchema>;
const activeRunCheckpointBaseSchema = challengeRunSchema.omit({
  schemaVersion: true,
  games: true,
  outcome: true,
});
export const activeRunCheckpointSchema = activeRunCheckpointBaseSchema.extend({
  recordId: z.literal('active'),
  saveSchemaVersion: z.literal(CHECKPOINT_SAVE_SCHEMA_VERSION),
  status: runStatusSchema.extract(['active', 'finished']),
  gamesPlayed: z.number().int().min(0).max(82).optional(),
  updatedAtIso: z.iso.datetime().optional(),
});
export type ActiveRunCheckpoint = z.infer<typeof activeRunCheckpointSchema>;
type CheckpointCarriedRunFields = z.infer<typeof activeRunCheckpointBaseSchema>;
const CHECKPOINT_CARRIED_FIELD_NAMES: readonly (keyof CheckpointCarriedRunFields)[] = Object.keys(
  activeRunCheckpointBaseSchema.shape,
) as readonly (keyof CheckpointCarriedRunFields)[];
function carryCheckpointFields(source: CheckpointCarriedRunFields): CheckpointCarriedRunFields {
  const carried = {} as Record<keyof CheckpointCarriedRunFields, unknown>;
  for (const fieldName of CHECKPOINT_CARRIED_FIELD_NAMES) {
    carried[fieldName] = source[fieldName];
  }
  return carried as CheckpointCarriedRunFields;
}
export const activeGameRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameNumber: z.number().int().min(1).max(82),
  result: gameResultSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type ActiveGameRow = z.infer<typeof activeGameRowSchema>;
export interface ActiveGameAppend {
  runId: string;
  gameNumber: number;
  result: GameResult;
  aggregates: RunAggregates;
  status: 'active' | 'finished';
  firstLossGameNumber: number | null;
}
export function checkpointFromRun(record: StoredRunRecord): ActiveRunCheckpoint {
  if (record.run.games.length !== 0) {
    throw new Error('saveActiveRun: active run must start with no accepted games');
  }
  const run = record.run;
  if (run.status !== 'active' && run.status !== 'finished') {
    throw new Error(`cannot store an active run in status ${run.status}`);
  }
  return {
    recordId: 'active',
    saveSchemaVersion: CHECKPOINT_SAVE_SCHEMA_VERSION,
    ...carryCheckpointFields(run),
    status: run.status,
    gamesPlayed: run.games.length,
    updatedAtIso: record.updatedAtIso,
  };
}
export function runFromCheckpoint(
  checkpoint: ActiveRunCheckpoint,
  results: GameResult[],
): ChallengeRun {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    ...carryCheckpointFields(checkpoint),
    games: results,
  };
}
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
