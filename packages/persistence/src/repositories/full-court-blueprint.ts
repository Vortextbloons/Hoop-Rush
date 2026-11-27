import {
  FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
  fullCourtBlueprintNameKey,
  normalizeFullCourtBlueprint,
  type FullCourtBlueprint,
} from '@hoop-rush/data-contracts';
import {
  fullCourtBlueprintRecordSchema,
  type StoredFullCourtBlueprint,
} from '../schemas/full-court-blueprint-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import { assertSaveSchemaVersion, parseRecord } from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court blueprint save: ${message}`);
}

export class DexieFullCourtBlueprintRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  private parseRecord(row: unknown): StoredFullCourtBlueprint {
    assertSaveSchemaVersion(row, FULL_COURT_BLUEPRINT_SCHEMA_VERSION, invalidSave);
    const parsed = parseRecord(fullCourtBlueprintRecordSchema, row, 'blueprint', invalidSave);
    if (parsed.key !== fullCourtBlueprintNameKey(parsed.blueprint.name)) {
      throw invalidSave('blueprint key mismatch');
    }
    return parsed;
  }

  async list(): Promise<FullCourtBlueprint[]> {
    const rows = await this.db.fullCourtBlueprints.orderBy('key').toArray();
    return rows.map((row) => this.parseRecord(row).blueprint);
  }

  async create(blueprint: FullCourtBlueprint): Promise<void> {
    const validated = normalizeFullCourtBlueprint(blueprint);
    const record = fullCourtBlueprintRecordSchema.parse({
      saveSchemaVersion: FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
      key: fullCourtBlueprintNameKey(validated.name),
      blueprint: validated,
    });
    try {
      await this.db.fullCourtBlueprints.add(record);
    } catch (error) {
      if (error instanceof Error && error.name === 'ConstraintError') {
        throw new Error(`A saved strategy named "${validated.name}" already exists.`);
      }
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    const key = fullCourtBlueprintNameKey(name);
    if (key.length === 0) return;
    await this.db.fullCourtBlueprints.delete(key);
  }
}

export function createFullCourtBlueprintRepository(
  db: HoopRushDatabase,
): DexieFullCourtBlueprintRepository {
  return new DexieFullCourtBlueprintRepository(db);
}
