import { z } from 'zod';
import {
  challengeRunSchema,
  CHECKPOINT_SAVE_SCHEMA_VERSION,
  classicVariantSchema,
  gameResultSchema,
  playerIdSchema,
  runModeSchema,
  runOutcomeSchema,
  runPlayerSelectionSchema,
  RUN_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSION,
  seedSchema,
  type ChallengeRun,
  type GameResult,
  type RunAggregates,
} from '@hoop-rush/data-contracts';
import type { StoredClassicDraft } from './classic-draft-record.ts';

/**
 * Stored-record schemas for IndexedDB (and any future adapter). Persistence
 * wraps the accepted domain ChallengeRun with storage metadata; it never
 * implements game rules or stores unaccepted state. Every read validates the
 * stored value at the runtime boundary, so corrupt records surface instead of
 * silently entering app state.
 *
 * The active run is append-only: a checkpoint holds every run field except
 * the games array, and one game row per accepted game accumulates next to it.
 */

export const storedRunRecordSchema = z.object({
  /** 'active' for the single active run, otherwise the run id. */
  recordId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  run: challengeRunSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredRunRecord = z.infer<typeof storedRunRecordSchema>;

/**
 * Active-run checkpoint (save schema 3): every ChallengeRun field except the
 * games array, plus progress-carrying fields kept current by every append.
 */
const activeRunCheckpointBaseSchema = challengeRunSchema.omit({
  schemaVersion: true,
  games: true,
  outcome: true,
});
export const activeRunCheckpointSchema = activeRunCheckpointBaseSchema.extend({
  recordId: z.literal('active'),
  saveSchemaVersion: z.literal(CHECKPOINT_SAVE_SCHEMA_VERSION),
  /** Narrowed: an abandoned run is never stored as the active checkpoint. */
  status: z.enum(['active', 'finished']),
  /**
   * Number of accepted games; absent on legacy checkpoints (loaders count rows).
   */
  gamesPlayed: z.number().int().min(0).max(82).optional(),
  updatedAtIso: z.iso.datetime().optional(),
});
export type ActiveRunCheckpoint = z.infer<typeof activeRunCheckpointSchema>;

/** The run fields a checkpoint carries verbatim (see `activeRunCheckpointBaseSchema`). */
type CheckpointCarriedRunFields = z.infer<typeof activeRunCheckpointBaseSchema>;

/**
 * Field names carried between the full run and the checkpoint, derived from
 * the checkpoint base schema's own shape so the two directions cannot drift.
 */
const CHECKPOINT_CARRIED_FIELD_NAMES: readonly (keyof CheckpointCarriedRunFields)[] = Object.keys(
  activeRunCheckpointBaseSchema.shape,
) as readonly (keyof CheckpointCarriedRunFields)[];

/** Copies the shared run fields from a source run (or checkpoint) object. */
function carryCheckpointFields(source: CheckpointCarriedRunFields): CheckpointCarriedRunFields {
  const carried = {} as Record<keyof CheckpointCarriedRunFields, unknown>;
  for (const fieldName of CHECKPOINT_CARRIED_FIELD_NAMES) {
    carried[fieldName] = source[fieldName];
  }
  return carried as CheckpointCarriedRunFields;
}

/** One accepted game in the active run, keyed by (runId, gameNumber). */
export const activeGameRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameNumber: z.number().int().min(1).max(82),
  result: gameResultSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type ActiveGameRow = z.infer<typeof activeGameRowSchema>;

/** Checkpoint mutation carried by one accepted game append. */
export interface ActiveGameAppend {
  runId: string;
  gameNumber: number;
  result: GameResult;
  aggregates: RunAggregates;
  status: 'active' | 'finished';
  firstLossGameNumber: number | null;
}

/**
 * Reduces a fresh full run record (empty games array) to a checkpoint. The
 * record is already a validated `StoredRunRecord`; only the append-only
 * preconditions are checked here.
 */
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

/**
 * Assembles a ChallengeRun from an already-validated checkpoint and its game
 * rows. Read-time schema validation happens once at the adapter boundary.
 */
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

/** Compact completed-run index row for history lists (spec/08 history). */
export const completedRunIndexSchema = z.object({
  recordId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  mode: runModeSchema,
  /** Immutable; present only for classic runs. */
  variant: classicVariantSchema.optional(),
  /** Null for free-form sandbox lineups drawn from any franchise/era pool. */
  franchiseId: z.string().min(1).max(64).nullable(),
  eraId: z.string().min(1).max(24),
  /** Five player ids in slot order; names resolve through the manifest/pool. */
  playerIds: z.array(playerIdSchema).length(5),
  /** Per-player pool provenance in slot order; absent on legacy runs. */
  selections: z.array(runPlayerSelectionSchema).length(5).optional(),
  runSeed: seedSchema,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().positive(),
  outcome: runOutcomeSchema,
  completedAtIso: z.iso.datetime(),
});
export type CompletedRunIndex = z.infer<typeof completedRunIndexSchema>;

/**
 * Storage boundary. The Dexie implementation lives in the repositories
 * folder; consumers depend on this interface, never on IndexedDB. All
 * methods validate every record they read.
 */
export interface ChallengeRepository {
  /**
   * Creates or replaces the active run from a fresh run (games: []); any
   * existing active game rows are deleted. The per-game path uses
   * appendActiveGame instead.
   */
  saveActiveRun(record: StoredRunRecord): Promise<void>;
  /**
   * Appends one accepted game: writes the game row and the updated checkpoint
   * (aggregates, status, first loss) in one atomic transaction.
   */
  appendActiveGame(input: ActiveGameAppend): Promise<void>;
  /** Reconstructs the full active run from checkpoint plus game rows, or null. */
  loadActiveRun(): Promise<StoredRunRecord | null>;
  /**
   * Loads only the active run checkpoint (status, first loss, aggregates)
   * without the game rows. Cheap for pages that render run progress.
   */
  loadActiveRunCheckpoint(): Promise<ActiveRunCheckpoint | null>;
  clearActiveRun(): Promise<void>;
  /** Atomically moves the active run into the completed table and history index. */
  promoteActiveToCompleted(completed: StoredRunRecord, index: CompletedRunIndex): Promise<void>;
  listCompletedRuns(): Promise<CompletedRunIndex[]>;
  loadCompletedRun(runId: string): Promise<StoredRunRecord | null>;
  clearHistory(): Promise<void>;
  /** Creates or replaces the single active classic draft record. */
  saveClassicDraft(record: StoredClassicDraft): Promise<void>;
  /** Loads the active classic draft record, or null when none exists. */
  loadClassicDraft(): Promise<StoredClassicDraft | null>;
  /** Deletes the active classic draft record (no-op when absent). */
  clearClassicDraft(): Promise<void>;
  /**
   * Atomically promotes a ready classic draft into the active run: replaces
   * the active checkpoint and clears game rows, then deletes the draft row —
   * but only when the stored draft's draftId matches. A newer draft must never
   * be deleted by an older run start.
   */
  promoteClassicDraftToRun(record: StoredRunRecord, draftId: string): Promise<void>;
}
