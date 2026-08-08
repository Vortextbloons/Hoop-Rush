import { SEASON_DRAFT_SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import {
  SEASON_DRAFT_RECORD_ID,
  storedSeasonDraftSchema,
  type SeasonDraftRepository,
  type StoredSeasonDraft,
} from '../schemas/season-draft-record.ts';
import { HoopRushDatabase } from './dexie.ts';

/**
 * Concrete IndexedDB Season draft repository (spec/2.0/03, spec/2.0/07,
 * M2.3.5, M2.4). Exactly one active Season draft row exists at a time in the
 * dedicated `seasonDrafts` table, isolated from the Challenge and Classic
 * tables. Save stores the full revisioned snapshot plus the complete command
 * log in one atomic put; load validates every read so corrupt rows throw.
 * A stored row outside the current save-schema family (v1/v2 development) is
 * auto-cleared at load and reported as null. The repository never implements
 * draft rules: revision correctness is the domain's job.
 */

export class DexieSeasonDraftRepository implements SeasonDraftRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase = new HoopRushDatabase()) {
    this.db = db;
  }

  async saveSeasonDraft(record: StoredSeasonDraft): Promise<void> {
    const validated = storedSeasonDraftSchema.parse(record);
    await this.db.transaction('rw', this.db.seasonDrafts, async () => {
      await this.db.seasonDrafts.put({
        ...validated,
        updatedAtIso: new Date().toISOString(),
      });
    });
  }

  async loadSeasonDraft(): Promise<StoredSeasonDraft | null> {
    const record = await this.db.seasonDrafts.get(SEASON_DRAFT_RECORD_ID);
    if (record === undefined) return null;
    // A stored row outside the current save-schema family (v1/v2 development)
    // is auto-cleared and never read; the raw-row view keeps the runtime check
    // meaningful even though the typed row is the v3 schema.
    if (
      (record as { saveSchemaVersion?: unknown }).saveSchemaVersion !==
      SEASON_DRAFT_SAVE_SCHEMA_VERSION
    ) {
      await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
      return null;
    }
    return storedSeasonDraftSchema.parse(record);
  }

  async clearSeasonDraft(): Promise<void> {
    await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
  }
}
