import { z } from 'zod';
import {
  seasonDraftLegacyStateSchema,
  seasonDraftStateSchema,
  seasonLeagueGenerationResultSchema,
  type SeasonDraftLegacyState,
  type SeasonDraftState,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schema for the active Season Run draft (spec/2.0/03, spec/2.0/07,
 * M2.3.5). Exactly one record exists at a time, keyed by the literal 'season-draft'.
 * The record wraps the full revisioned draft snapshot — participants, offers,
 * picks, status, revision, current offer, and the entire command log (accepted
 * and rejected summaries) — plus the completed league generation result once a
 * generate-ai-league command was accepted.
 *
 * M2.3.5 (season-draft-v2): the stored record discriminates on
 * `saveSchemaVersion` — 1 wraps a legacy season-draft-v1 state (M2.1-M2.3
 * franchise-era rolls, recovery reads only) and 2 wraps a season-draft-v2
 * state. The repository saves and loads the union unchanged: no migration, no
 * silent delete, so unfinished v1 drafts surface an explicit recovery screen.
 * Persistence only stores whatever validated record it is given; revision
 * correctness is the domain's job. Every read validates the stored value at
 * the runtime boundary, so corrupt records are surfaced instead of silently
 * entering app state.
 */

/** Single active Season draft slot; at most one row may exist. */
export const SEASON_DRAFT_RECORD_ID = 'season-draft';

const storedSeasonDraftV1Schema = z.object({
  recordId: z.literal(SEASON_DRAFT_RECORD_ID),
  /** Legacy M2.1-M2.3 season-draft-v1 record (recovery reads only). */
  saveSchemaVersion: z.literal(1),
  /** Full revisioned season-draft-v1 snapshot including the command log. */
  draft: seasonDraftLegacyStateSchema,
  /** Completed generation result when generate-ai-league was accepted; else null. */
  generation: seasonLeagueGenerationResultSchema.nullable(),
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonDraftV1 = z.infer<typeof storedSeasonDraftV1Schema>;

const storedSeasonDraftV2Schema = z.object({
  recordId: z.literal(SEASON_DRAFT_RECORD_ID),
  /** Current save-schema family for Season Run drafts (season-draft-v2). */
  saveSchemaVersion: z.literal(2),
  /** Full revisioned season-draft-v2 snapshot including the command log. */
  draft: seasonDraftStateSchema,
  /** Completed generation result when generate-ai-league was accepted; else null. */
  generation: seasonLeagueGenerationResultSchema.nullable(),
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonDraftV2 = z.infer<typeof storedSeasonDraftV2Schema>;

/** Stored Season draft record: current v2 or legacy v1 (recovery reads). */
export const storedSeasonDraftSchema = z.discriminatedUnion('saveSchemaVersion', [
  storedSeasonDraftV2Schema,
  storedSeasonDraftV1Schema,
]);
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
   * Loads the active Season draft record, or null when none exists. The
   * stored union is returned unchanged (legacy v1 records load as legacy).
   */
  loadSeasonDraft(): Promise<StoredSeasonDraft | null>;
  /** Deletes the active Season draft record (no-op when absent). */
  clearSeasonDraft(): Promise<void>;
}

/**
 * Wraps a draft snapshot and optional generation result into a stored record.
 * The save schema version follows the state's own schemaVersion: v2 states
 * store as saveSchemaVersion 2; legacy v1 states store as 1.
 */
export function recordFromState(
  draft: SeasonDraftState | SeasonDraftLegacyState,
  generation: SeasonLeagueGenerationResult | null = null,
): StoredSeasonDraft {
  if (draft.schemaVersion === 1) {
    return {
      recordId: SEASON_DRAFT_RECORD_ID,
      saveSchemaVersion: 1,
      draft,
      generation,
    };
  }
  return {
    recordId: SEASON_DRAFT_RECORD_ID,
    saveSchemaVersion: 2,
    draft,
    generation,
  };
}
