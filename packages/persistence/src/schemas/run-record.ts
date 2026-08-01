import { z } from 'zod';
import { challengeRunSchema, playerIdSchema, seedSchema } from '@hoop-rush/data-contracts';

/**
 * Stored-record schemas for IndexedDB (and any future adapter). Persistence
 * wraps the accepted domain ChallengeRun with storage metadata; it never
 * implements game rules or stores unaccepted state. Every read validates the
 * stored value at the runtime boundary, so corrupt records are surfaced
 * instead of silently entering application state.
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
  saveActiveRun(record: StoredRunRecord): Promise<void>;
  loadActiveRun(): Promise<StoredRunRecord | null>;
  clearActiveRun(): Promise<void>;
  /** Atomically moves the active run into the completed table and history index. */
  promoteActiveToCompleted(completed: StoredRunRecord, index: CompletedRunIndex): Promise<void>;
  listCompletedRuns(): Promise<CompletedRunIndex[]>;
  loadCompletedRun(runId: string): Promise<StoredRunRecord | null>;
  clearHistory(): Promise<void>;
}
