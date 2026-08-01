import { z } from 'zod';
import { challengeRunSchema } from '@hoop-rush/data-contracts';

/**
 * Stored-record schema for IndexedDB (and any future adapter). Persistence
 * wraps the accepted domain ChallengeRun with storage metadata; it never
 * implements game rules or stores unaccepted state.
 */

export const storedRunRecordSchema = z.object({
  recordId: z.string().min(1).max(64),
  saveSchemaVersion: z.number().int().positive(),
  run: challengeRunSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.string().datetime().optional(),
});
export type StoredRunRecord = z.infer<typeof storedRunRecordSchema>;

/**
 * Storage boundary. The Dexie implementation arrives with the save/reload
 * milestone; consumers depend on this interface, not on IndexedDB.
 */
export interface RunRepository {
  saveActiveRun(record: StoredRunRecord): Promise<void>;
  loadActiveRun(): Promise<StoredRunRecord | null>;
  clearActiveRun(): Promise<void>;
}
