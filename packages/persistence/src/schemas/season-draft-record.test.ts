import { describe, expect, it } from 'vitest';
import { buildSeasonDraftState } from '@hoop-rush/test-fixtures';
import { recordFromState, storedSeasonDraftSchema } from './season-draft-record.ts';
describe('storedSeasonDraftSchema', () => {
  it('accepts a valid v3 record with a null generation', () => {
    const record = recordFromState(buildSeasonDraftState());
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(true);
    expect(record.saveSchemaVersion).toBe(3);
    expect(record.draft.schemaVersion).toBe(2);
    expect(record.draft.draftVersion).toBe('season-draft-v2');
  });
  it('accepts an adapter-stamped updatedAtIso', () => {
    const record = {
      ...recordFromState(buildSeasonDraftState()),
      updatedAtIso: '2026-08-04T12:00:00.000Z',
    };
    const parsed = storedSeasonDraftSchema.parse(record);
    expect(parsed.updatedAtIso).toBe('2026-08-04T12:00:00.000Z');
  });
  it('rejects the v1 and v2 development save schemas outright (never read)', () => {
    const record = recordFromState(buildSeasonDraftState());
    expect(storedSeasonDraftSchema.safeParse({ ...record, saveSchemaVersion: 1 }).success).toBe(
      false,
    );
    expect(storedSeasonDraftSchema.safeParse({ ...record, saveSchemaVersion: 2 }).success).toBe(
      false,
    );
    expect(
      storedSeasonDraftSchema.safeParse({
        recordId: 'season-draft',
        saveSchemaVersion: 3,
        draft: { schemaVersion: 1, draftVersion: 'season-draft-v2' },
        generation: null,
      }).success,
    ).toBe(false);
  });
  it('rejects a wrong recordId', () => {
    const record = { ...recordFromState(buildSeasonDraftState()), recordId: 'other-draft' };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });
  it('rejects an unparsable draft snapshot', () => {
    const record = {
      ...recordFromState(buildSeasonDraftState()),
      draft: { corrupted: true },
    };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });
  it('rejects a corrupt generation payload', () => {
    const record = {
      ...recordFromState(buildSeasonDraftState()),
      generation: { corrupted: true },
    };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });
  it('rejects a malformed adapter timestamp', () => {
    const record = {
      ...recordFromState(buildSeasonDraftState()),
      updatedAtIso: 'not-a-datetime',
    };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });
});
