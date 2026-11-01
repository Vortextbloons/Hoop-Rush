import { z } from 'zod';
import {
  challengeRunSchema,
  CHECKPOINT_SAVE_SCHEMA_VERSION,
  completedRunIndexSchema,
  gameResultSchema,
  runStatusSchema,
  storedRunRecordSchema,
  RUN_SCHEMA_VERSION,
  type CompletedRunIndex,
  type GameResult,
  type StoredRunRecord,
  type ActiveGameAppend,
  type ChallengeRun,
  type PromoteActiveToCompletedExpectation,
} from '@hoop-rush/data-contracts';

// `storedRunRecordSchema` and `completedRunIndexSchema` are canonical in
// `@hoop-rush/data-contracts`, because application ports describe save commits
// with them. Re-exported here so existing persistence imports keep working.
export { completedRunIndexSchema, storedRunRecordSchema };
export type {
  ActiveGameAppend,
  CompletedRunIndex,
  PromoteActiveToCompletedExpectation,
  StoredRunRecord,
};

const activeRunCheckpointBaseSchema = challengeRunSchema.omit({
  schemaVersion: true,
  games: true,
  outcome: true,
});
export const activeRunCheckpointSchema = activeRunCheckpointBaseSchema.extend({
  recordId: z.literal('active'),
  saveSchemaVersion: z.literal(CHECKPOINT_SAVE_SCHEMA_VERSION),
  status: runStatusSchema.extract(['active', 'finished']),
  gamesPlayed: z.number().int().min(0).max(82),
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
