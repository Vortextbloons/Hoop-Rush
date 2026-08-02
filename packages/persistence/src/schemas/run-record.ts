import { z } from 'zod';
import {
  challengeRunSchema,
  difficultyProfileSchema,
  franchiseIdSchema,
  gameResultSchema,
  lineupSchema,
  opponentBracketCoreSchema,
  playerIdSchema,
  runAggregatesSchema,
  runModeSchema,
  runVersionBoundariesSchema,
  seedSchema,
  simulationPlayerSchema,
  type ChallengeRun,
  type GameResult,
  type RunAggregates,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schemas for IndexedDB (and any future adapter). Persistence
 * wraps the accepted domain ChallengeRun with storage metadata; it never
 * implements game rules or stores unaccepted state. Every read validates the
 * stored value at the runtime boundary, so corrupt records are surfaced
 * instead of silently entering application state.
 *
 * The active run is append-only: a checkpoint holds every run field except
 * the games array, and one game row per accepted game accumulates next to it.
 * The completed table keeps the full run record unchanged.
 */

export const storedRunRecordSchema = z.object({
  /** 'active' for the single active run, otherwise the run id. */
  recordId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(2),
  run: challengeRunSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.string().datetime().optional(),
});
export type StoredRunRecord = z.infer<typeof storedRunRecordSchema>;

/**
 * Active-run checkpoint (save schema 3): every ChallengeRun field except the
 * games array, plus the progress-carrying fields kept current by every
 * append. The games array is reconstructed on load from active game rows.
 */
export const activeRunCheckpointSchema = z.object({
  recordId: z.literal('active'),
  saveSchemaVersion: z.literal(3),
  runId: z.string().min(1).max(64),
  mode: runModeSchema,
  franchiseId: franchiseIdSchema,
  eraId: z.string().min(1).max(24),
  /** Display name for the user's lineup (resolved from lineage at creation). */
  homeDisplayName: z.string().min(1).max(96),
  playerIds: z.array(playerIdSchema).length(5),
  lineup: lineupSchema,
  players: z.array(simulationPlayerSchema).length(5),
  runSeed: seedSchema,
  versions: runVersionBoundariesSchema,
  eraProfileVersion: z.string().min(1).max(64),
  difficulty: difficultyProfileSchema,
  bracket: opponentBracketCoreSchema,
  status: z.enum(['active', 'finished']),
  /** First loss game number (1-82), or null while the run is undefeated. */
  firstLossGameNumber: z.number().int().min(1).max(82).nullable(),
  aggregates: runAggregatesSchema,
  updatedAtIso: z.string().datetime().optional(),
});
export type ActiveRunCheckpoint = z.infer<typeof activeRunCheckpointSchema>;

/** One accepted game in the active run, keyed by (runId, gameNumber). */
export const activeGameRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameNumber: z.number().int().min(1).max(82),
  result: gameResultSchema,
  updatedAtIso: z.string().datetime().optional(),
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

/** Reduces a fresh full run record (empty games array) to a checkpoint. */
export function checkpointFromRun(record: StoredRunRecord): ActiveRunCheckpoint {
  const validated = storedRunRecordSchema.parse(record);
  if (validated.run.games.length !== 0) {
    throw new Error('saveActiveRun: active run must start with no accepted games');
  }
  if (validated.run.status !== 'active' && validated.run.status !== 'finished') {
    throw new Error(`cannot store an active run in status ${validated.run.status}`);
  }
  return {
    recordId: 'active',
    saveSchemaVersion: 3,
    runId: validated.run.runId,
    mode: validated.run.mode,
    franchiseId: validated.run.franchiseId,
    eraId: validated.run.eraId,
    homeDisplayName: validated.run.homeDisplayName,
    playerIds: validated.run.playerIds,
    lineup: validated.run.lineup,
    players: validated.run.players,
    runSeed: validated.run.runSeed,
    versions: validated.run.versions,
    eraProfileVersion: validated.run.eraProfileVersion,
    difficulty: validated.run.difficulty,
    bracket: validated.run.bracket,
    status: validated.run.status,
    firstLossGameNumber: validated.run.firstLossGameNumber,
    aggregates: validated.run.aggregates,
    updatedAtIso: validated.updatedAtIso,
  };
}

/** Assembles a ChallengeRun from a validated checkpoint and its game rows. */
export function runFromCheckpoint(
  checkpoint: ActiveRunCheckpoint,
  results: GameResult[],
): ChallengeRun {
  const validated = activeRunCheckpointSchema.parse(checkpoint);
  return {
    schemaVersion: 1,
    runId: validated.runId,
    mode: validated.mode,
    franchiseId: validated.franchiseId,
    eraId: validated.eraId,
    homeDisplayName: validated.homeDisplayName,
    playerIds: validated.playerIds,
    lineup: validated.lineup,
    players: validated.players,
    runSeed: validated.runSeed,
    versions: validated.versions,
    eraProfileVersion: validated.eraProfileVersion,
    difficulty: validated.difficulty,
    bracket: validated.bracket,
    status: validated.status,
    firstLossGameNumber: validated.firstLossGameNumber,
    games: results,
    aggregates: validated.aggregates,
  };
}

/** Compact completed-run index row for history lists (spec/08 history). */
export const completedRunIndexSchema = z.object({
  recordId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  mode: z.enum(['sandbox', 'classic']),
  franchiseId: z.string().min(1).max(64),
  eraId: z.string().min(1).max(24),
  /** Five player ids in slot order; names resolve through the manifest/pool. */
  playerIds: z.array(playerIdSchema).length(5),
  runSeed: seedSchema,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().positive(),
  outcome: z.enum(['perfect', 'eliminated']),
  completedAtIso: z.string().datetime(),
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
  clearActiveRun(): Promise<void>;
  /** Atomically moves the active run into the completed table and history index. */
  promoteActiveToCompleted(completed: StoredRunRecord, index: CompletedRunIndex): Promise<void>;
  listCompletedRuns(): Promise<CompletedRunIndex[]>;
  loadCompletedRun(runId: string): Promise<StoredRunRecord | null>;
  clearHistory(): Promise<void>;
}
