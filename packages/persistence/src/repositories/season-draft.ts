import { SEASON_DRAFT_SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import {
  SEASON_DRAFT_RECORD_ID,
  storedSeasonDraftSchema,
  type SeasonDraftRepository,
  type StoredSeasonDraft,
} from '../schemas/season-draft-record.ts';
import { HoopRushDatabase } from './dexie.ts';

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
