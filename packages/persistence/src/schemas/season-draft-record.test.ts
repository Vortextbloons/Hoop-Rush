import { describe, expect, it } from 'vitest';
import { buildSeasonDraftState } from '@hoop-rush/test-fixtures';
import { recordFromState, storedSeasonDraftSchema } from './season-draft-record.js';

describe('storedSeasonDraftSchema', () => {
  it('accepts a valid record with a null generation', () => {
    const record = recordFromState(buildSeasonDraftState());
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(true);
  });

  it('accepts an adapter-stamped updatedAtIso', () => {
    const record = {
      ...recordFromState(buildSeasonDraftState()),
      updatedAtIso: '2026-08-04T12:00:00.000Z',
    };
    const parsed = storedSeasonDraftSchema.parse(record);
    expect(parsed.updatedAtIso).toBe('2026-08-04T12:00:00.000Z');
  });

  it('rejects a wrong recordId', () => {
    const record = { ...recordFromState(buildSeasonDraftState()), recordId: 'other-draft' };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a wrong saveSchemaVersion', () => {
    const record = { ...recordFromState(buildSeasonDraftState()), saveSchemaVersion: 2 };
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
