import { describe, expect, it } from 'vitest';
import { buildSeasonDraftState } from '@hoop-rush/test-fixtures';
import {
  recordFromState,
  storedSeasonDraftSchema,
  type StoredSeasonDraftV1,
} from './season-draft-record.ts';

describe('storedSeasonDraftSchema', () => {
  it('accepts a valid v2 record with a null generation', () => {
    const record = recordFromState(buildSeasonDraftState());
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(true);
    if (record.saveSchemaVersion !== 2) throw new Error('expected a v2 record');
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

  it('round-trips a legacy v1 record through the union (recovery reads)', () => {
    const legacy: StoredSeasonDraftV1 = {
      recordId: 'season-draft',
      saveSchemaVersion: 1,
      draft: {
        schemaVersion: 1,
        draftVersion: 'season-draft-v1',
        runId: 'run-1',
        rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
        league: buildSeasonDraftState().league,
        catalogVersion: 'season-draft-v1',
        participants: [{ participantId: 'p1', franchiseId: 'lakers' }],
        firstPickParticipantId: 'p1',
        round: 3,
        currentTurnParticipantId: 'p1',
        status: 'drafting',
        revision: 5,
        currentReveal: {
          participantId: 'p1',
          round: 3,
          pickOrdinal: 3,
          attempts: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
        },
        rolls: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
        claims: [],
        picks: [
          {
            participantId: 'p1',
            round: 1,
            pickOrdinal: 1,
            playerVersionId: `pv-${'0'.repeat(32)}`,
            franchiseId: 'lakers',
            eraId: '1990s',
            rollAttempts: 1,
          },
        ],
        commandLog: [],
      },
      generation: null,
    };
    const parsed = storedSeasonDraftSchema.parse(legacy);
    expect(parsed.saveSchemaVersion).toBe(1);
    expect(parsed.draft.draftVersion).toBe('season-draft-v1');
    // recordFromState picks the save schema from the state's schemaVersion.
    const wrapped = recordFromState(legacy.draft);
    expect(wrapped.saveSchemaVersion).toBe(1);
    expect(storedSeasonDraftSchema.safeParse(wrapped).success).toBe(true);
  });

  it('rejects a wrong recordId', () => {
    const record = { ...recordFromState(buildSeasonDraftState()), recordId: 'other-draft' };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a wrong saveSchemaVersion', () => {
    const record = { ...recordFromState(buildSeasonDraftState()), saveSchemaVersion: 3 };
    expect(storedSeasonDraftSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a v2-state draft stored as legacy and vice versa', () => {
    const v2 = recordFromState(buildSeasonDraftState());
    expect(storedSeasonDraftSchema.safeParse({ ...v2, saveSchemaVersion: 1 }).success).toBe(false);
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
