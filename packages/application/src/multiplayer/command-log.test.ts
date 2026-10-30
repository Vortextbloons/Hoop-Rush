import { describe, expect, it } from 'bun:test';
import { mergeCommandLog } from './command-log.ts';

describe('mergeCommandLog', () => {
  it('keeps the local log when the transport returns no new commands', () => {
    const local = [{ ordinal: 0 }, { ordinal: 1 }];
    expect(
      mergeCommandLog({ local, fetched: [], expectedCount: 2, ordinalOf: (row) => row.ordinal }),
    ).toEqual({ commands: local, complete: true });
  });

  it('appends fetched commands and checks the expected count', () => {
    expect(
      mergeCommandLog({
        local: [{ ordinal: 0 }],
        fetched: [{ ordinal: 1 }],
        expectedCount: 2,
        ordinalOf: (row) => row.ordinal,
      }),
    ).toEqual({ commands: [{ ordinal: 0 }, { ordinal: 1 }], complete: true });
    expect(
      mergeCommandLog({
        local: [{ ordinal: 0 }],
        fetched: [{ ordinal: 1 }],
        expectedCount: 3,
        ordinalOf: (row) => row.ordinal,
      }).complete,
    ).toBe(false);
  });

  it('rejects a log with gaps when ordinals are required', () => {
    expect(
      mergeCommandLog({
        local: [],
        fetched: [{ ordinal: 0 }, { ordinal: 2 }],
        expectedCount: 2,
        ordinalOf: (row) => row.ordinal,
      }).complete,
    ).toBe(false);
  });

  it('uses the count alone when a mode has no ordinal contract', () => {
    expect(
      mergeCommandLog({ local: [], fetched: [{ commandId: 'a' }], expectedCount: 1 }).complete,
    ).toBe(true);
  });
});
