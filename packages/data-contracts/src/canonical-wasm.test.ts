import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  canonicalJson,
  canonicalJsonData,
  canonicalJsonDataDigest,
  seasonDigestHex,
  type JsonData,
} from './season-hash.ts';
import { CANONICAL_WASM_BYTES, CANONICAL_WASM_SOURCE_HASH } from './wasm/canonical-wasm.gen.ts';

describe('Rust canonical game data', () => {
  it('ships a valid module matching its Rust source', () => {
    const source = readFileSync(new URL('./wasm/canonical.rs', import.meta.url), 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    expect(createHash('sha256').update(source).digest('hex')).toBe(CANONICAL_WASM_SOURCE_HASH);
    expect(WebAssembly.validate(CANONICAL_WASM_BYTES)).toBe(true);
  });

  it('preserves canonical bytes and UTF-16 digests across JSON values and prefixes', () => {
    const values: JsonData[] = [
      null,
      true,
      false,
      0,
      -0,
      1e-30,
      1e25,
      Number.MAX_SAFE_INTEGER,
      NaN,
      Infinity,
      '',
      'quotes " slash \\ controls \n\r\t\u0000 🏀 \ud800 \udfff',
      [],
      {},
      { omitted: undefined, present: null },
      { '2': 2, '10': 10, 'a"': 1, 'a\\': 2, '\ue000': 3, '🏀': 4, '\ud800': 5, '\u0000': 6 },
      [{ z: [1, 2.5, -4], a: { nested: true } }, null],
    ];
    for (let i = 0; i < 200; i++) {
      values.push({
        z: Array.from({ length: i % 17 }, (_, j) => ({
          score: (i * j) / 7,
          'a"b': `Player ${String(i)} 🏀 ${String(j)}`,
        })),
        '10': i,
        '2': i + 1,
        a: { '🏀': i % 2 === 0, '\ue000': [i, null, `\ud800${String(i)}`] },
      });
    }
    for (const value of values) {
      const expected = canonicalJson(value);
      expect(canonicalJsonData(value)).toBe(expected);
      for (const prefix of ['', 'havoc-battle-input-v1:', 'multiplayer\u0000🏀\ud800:']) {
        expect(canonicalJsonDataDigest(prefix, value)).toBe(seasonDigestHex(prefix + expected));
      }
    }
  });

  it('keeps output and digests stable across memory growth and alternating calls', () => {
    const large = {
      roster: Array.from({ length: 3000 }, (_, i) => ({ z: i, a: `Player ${String(i)} 🏀` })),
    };
    const expected = canonicalJson(large);
    expect(canonicalJsonData(large)).toBe(expected);
    expect(canonicalJsonDataDigest('large:', large)).toBe(seasonDigestHex(`large:${expected}`));
    expect(canonicalJsonData({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    expect(canonicalJsonDataDigest('', null)).toBe(seasonDigestHex('null'));
    expect(canonicalJsonData(large)).toBe(expected);
  });
});
