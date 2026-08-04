import { z } from 'zod';
import {
  seasonDraftStateSchema,
  seasonLeagueGenerationResultSchema,
  type SeasonDraftState,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schema for the active Season Run draft (spec/2.0/03, spec/2.0/07,
 * M2.1). Exactly one record exists at a time, keyed by the literal 'season-draft'.
 * The record wraps the full revisioned draft snapshot — participants, rolls,
 * claims, picks, status, revision, current reveal, and the entire command log
 * (accepted and rejected summaries) — plus the completed league generation
 * result once a generate-ai-league command was accepted. Persistence only
 * stores whatever validated record it is given; revision correctness is the
 * domain's job. Every read validates the stored value at the runtime boundary,
 * so corrupt records are surfaced instead of silently entering app state.
 */

/** Single active Season draft slot; at most one row may exist. */
export const SEASON_DRAFT_RECORD_ID = 'season-draft';

export const storedSeasonDraftSchema = z.object({
  recordId: z.literal(SEASON_DRAFT_RECORD_ID),
  /** New save-schema family for Season Run drafts (independent of run/classic). */
  saveSchemaVersion: z.literal(1),
  /** Full revisioned draft snapshot including the command log. */
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
  /** Loads the active Season draft record, or null when none exists. */
  loadSeasonDraft(): Promise<StoredSeasonDraft | null>;
  /** Deletes the active Season draft record (no-op when absent). */
  clearSeasonDraft(): Promise<void>;
}

/** Wraps a draft snapshot and optional generation result into a stored record. */
export function recordFromState(
  draft: SeasonDraftState,
  generation: SeasonLeagueGenerationResult | null = null,
): StoredSeasonDraft {
  return {
    recordId: SEASON_DRAFT_RECORD_ID,
    saveSchemaVersion: 1,
    draft,
    generation,
  };
}
