import {
  SEASON_DRAFT_SAVE_SCHEMA_VERSION,
  SEASON_DRAFT_VERSION,
} from '@hoop-rush/data-contracts';
import {
  SEASON_DRAFT_RECORD_ID,
  storedSeasonDraftSchema,
  type SeasonDraftRepository,
  type StoredSeasonDraft,
} from '../schemas/season-draft-record.ts';
import { HoopRushDatabase } from './dexie.ts';

function isIncompatibleDraftVersion(draft: unknown): boolean {
  if (draft === null || typeof draft !== 'object') return false;
  const row = draft as { draftVersion?: unknown; catalogVersion?: unknown };
  if (row.draftVersion === undefined && row.catalogVersion === undefined) return false;
  return row.draftVersion !== SEASON_DRAFT_VERSION || row.catalogVersion !== SEASON_DRAFT_VERSION;
}

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
      (
        record as {
          saveSchemaVersion?: unknown;
        }
      ).saveSchemaVersion !== SEASON_DRAFT_SAVE_SCHEMA_VERSION
    ) {
      await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
      return null;
    }
    const parsed = storedSeasonDraftSchema.safeParse(record);
    if (parsed.success) return parsed.data;
    if (isIncompatibleDraftVersion(record.draft)) {
      await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
      return null;
    }
    return storedSeasonDraftSchema.parse(record);
  }
  async clearSeasonDraft(): Promise<void> {
    await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
  }
}
