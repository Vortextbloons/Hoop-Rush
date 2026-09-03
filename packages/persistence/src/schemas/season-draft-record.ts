import { z } from 'zod';
import { seasonDraftStateSchema, seasonLeagueGenerationResultSchema, SEASON_DRAFT_SAVE_SCHEMA_VERSION, type SeasonDraftState, type SeasonLeagueGenerationResult, } from '@hoop-rush/data-contracts';
export const SEASON_DRAFT_RECORD_ID = 'season-draft';
export const storedSeasonDraftSchema = z.object({
    recordId: z.literal(SEASON_DRAFT_RECORD_ID),
    saveSchemaVersion: z.literal(SEASON_DRAFT_SAVE_SCHEMA_VERSION),
    draft: seasonDraftStateSchema,
    generation: seasonLeagueGenerationResultSchema.nullable(),
    updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonDraft = z.infer<typeof storedSeasonDraftSchema>;
export interface SeasonDraftRepository {
    saveSeasonDraft(record: StoredSeasonDraft): Promise<void>;
    loadSeasonDraft(): Promise<StoredSeasonDraft | null>;
    clearSeasonDraft(): Promise<void>;
}
export function recordFromState(draft: SeasonDraftState, generation: SeasonLeagueGenerationResult | null = null): StoredSeasonDraft {
    return {
        recordId: SEASON_DRAFT_RECORD_ID,
        saveSchemaVersion: SEASON_DRAFT_SAVE_SCHEMA_VERSION,
        draft,
        generation,
    };
}
