import { expect, test } from 'bun:test';
import {
  canonicalJson,
  capRushGameSummarySchema,
  seasonDigestHex,
  seasonDigestState,
} from '@hoop-rush/data-contracts';

test('continued digest hashing preserves exact bytes across UTF-16 boundaries', () => {
  const material = 'cap-rush\u0000{"name":"Basketball 🏀","score":100}';
  const expected = seasonDigestHex(material);
  for (let split = 0; split <= material.length; split += 1) {
    expect(
      seasonDigestHex(material.slice(split), seasonDigestState(material.slice(0, split))),
    ).toBe(expected);
  }
});

test('canonical serialization preserves sorted keys and JSON escaping across repeated records', () => {
  const value = {
    z: [
      { 'quoted"key': 'line\nbreak', count: -0, missing: undefined },
      { count: 1e21, 'quoted"key': '\\', nested: { count: null } },
    ],
    a: { count: Infinity, enabled: false },
  };
  expect(canonicalJson(value)).toBe(
    '{"a":{"count":null,"enabled":false},"z":[{"count":0,"quoted\\\"key":"line\\nbreak"},{"count":1e+21,"nested":{"count":null},"quoted\\\"key":"\\\\"}]}',
  );
  expect(canonicalJson({ count: 2 })).toBe('{"count":2}');
});

test('cached game facts remain immutable and copied game facts are revalidated', () => {
  const summary = capRushGameSummarySchema.parse({
    gameNumber: 1,
    opponentId: 'celtics',
    humanHome: true,
    humanPoints: 100,
    opponentPoints: 90,
    won: true,
    overtimePeriods: 0,
    inputDigest: 'a'.repeat(32),
    resultDigest: 'b'.repeat(32),
  });
  const serialized = canonicalJson(summary);
  expect(() => {
    summary.humanPoints = 0;
  }).toThrow();
  expect(canonicalJson({ game: summary })).toBe(`{"game":${serialized}}`);
  expect(capRushGameSummarySchema.parse(JSON.parse(serialized))).toEqual(summary);
  expect(
    capRushGameSummarySchema.safeParse(Object.freeze({ ...summary, gameNumber: 0 })).success,
  ).toBe(false);
});
