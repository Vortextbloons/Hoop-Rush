import { z } from 'zod';
import {
  seasonDraftStateSchema,
  seasonLeagueGenerationResultSchema,
  SEASON_DRAFT_SAVE_SCHEMA_VERSION,
  type SeasonDraftState,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schema for the active Season Run draft (spec/2.0/03, spec/2.0/07,
 * M2.3.5, M2.4). Exactly one record exists at a time, keyed by the literal
 * 'season-draft'. The record wraps the full revisioned draft snapshot plus the
 * completed league generation result (schema 2 with roster-generation-v2
 * aiPools) once a generate-ai-league command was accepted.
 *
 * Save schema v3 (M2.4 roster-generation-v2): the single current stored schema.
 * The v1/v2 development families are never read or migrated: the repository
 * auto-clears a stored row whose `saveSchemaVersion` is not 3 at load.
 *
 * Persistence only stores whatever validated record it is given; revision
 * correctness is the domain's job. Every read validates the stored value at
 * the runtime boundary, so corrupt records surface instead of silently
 * entering app state.
 */

/** Single active Season draft slot; at most one row may exist. */
export const SEASON_DRAFT_RECORD_ID = 'season-draft';

/** The single stored Season draft record (save schema v3). */
export const storedSeasonDraftSchema = z.object({
  recordId: z.literal(SEASON_DRAFT_RECORD_ID),
  /** Current save-schema family for Season Run drafts (M2.4). */
  saveSchemaVersion: z.literal(SEASON_DRAFT_SAVE_SCHEMA_VERSION),
  /** Full revisioned season-draft-v2 snapshot including the command log. */
  draft: seasonDraftStateSchema,
  /** Completed generation result when generate-ai-league was accepted; else null. */
  generation: seasonLeagueGenerationResultSchema.nullable(),
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonDraft = z.infer<typeof storedSeasonDraftSchema>;

/**
 * Storage boundary. The Dexie implementation lives in the repositories
 * folder; consumers depend on this interface, never on IndexedDB. All
 * methods validate every record they read.
 */
export interface SeasonDraftRepository {
  /** Creates or replaces the single active Season draft record, atomically. */
  saveSeasonDraft(record: StoredSeasonDraft): Promise<void>;
  /**
   * Loads the active Season draft record, or null when none exists. A stored
   * row outside the current save-schema family (v1/v2 development) is
   * auto-cleared and reported as null.
   */
  loadSeasonDraft(): Promise<StoredSeasonDraft | null>;
  /** Deletes the active Season draft record (no-op when absent). */
  clearSeasonDraft(): Promise<void>;
}

/** Wraps a draft snapshot and optional generation result into the single v3 stored record. */
export function recordFromState(
  draft: SeasonDraftState,
  generation: SeasonLeagueGenerationResult | null = null,
): StoredSeasonDraft {
  return {
    recordId: SEASON_DRAFT_RECORD_ID,
    saveSchemaVersion: SEASON_DRAFT_SAVE_SCHEMA_VERSION,
    draft,
    generation,
  };
}
