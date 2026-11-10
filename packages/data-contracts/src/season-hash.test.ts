import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { canonicalJson, immutableCanonicalSchema, seasonDigestHex } from './season-hash.ts';

const schema = immutableCanonicalSchema(
  z.object({
    profile: z.object({ name: z.string(), weights: z.array(z.number()) }),
    players: z.array(z.object({ name: z.string(), rating: z.number().optional() })),
  }),
);

function fixture() {
  return schema.parse({
    profile: { name: 'Era "A"\n🏀', weights: [0, 0.25, 1] },
    players: [{ name: 'First', rating: 80 }, { name: 'Second' }],
  });
}

describe('immutable canonical JSON', () => {
  it('preserves canonical bytes and digests when frozen descendants are reused in game inputs', () => {
    const locked = fixture();
    const input = {
      seed: 'first',
      home: { ...locked, side: 'home' },
      away: { ...locked, side: 'away' },
      profile: locked.profile,
    };
    const expected = canonicalJson(structuredClone(input));
    expect(canonicalJson(input)).toBe(expected);
    expect(seasonDigestHex(canonicalJson(input))).toBe(seasonDigestHex(expected));
    expect(canonicalJson({ ...input, seed: 'second' })).toBe(
      canonicalJson({ ...structuredClone(input), seed: 'second' }),
    );
  });

  it('retains escaping, omitted fields, array order and sorted object keys', () => {
    const locked = fixture();
    expect(canonicalJson({ team: locked, profile: locked.profile })).toBe(
      '{"profile":{"name":"Era \\"A\\"\\n🏀","weights":[0,0.25,1]},"team":{"players":[{"name":"First","rating":80},{"name":"Second"}],"profile":{"name":"Era \\"A\\"\\n🏀","weights":[0,0.25,1]}}}',
    );
  });

  it('prevents nested mutations and does not reuse frozen bytes for mutable clones', () => {
    const locked = fixture();
    const player = locked.players[0];
    if (player === undefined) throw new Error('missing player');
    expect(() => locked.profile.weights.push(2)).toThrow();
    expect(() => {
      player.rating = 1;
    }).toThrow();
    const copy = structuredClone(locked);
    const copiedPlayer = copy.players[0];
    if (copiedPlayer === undefined) throw new Error('missing copied player');
    const before = canonicalJson(copy);
    copy.profile.weights.push(2);
    copiedPlayer.rating = 1;
    expect(canonicalJson(copy)).not.toBe(before);
    expect(canonicalJson(locked)).toBe(before);
  });

  it('does not treat shallow freezing as proof of immutable descendants', () => {
    const input = Object.freeze({ nested: { rating: 80 } });
    expect(canonicalJson(input)).toBe('{"nested":{"rating":80}}');
    input.nested.rating = 1;
    expect(canonicalJson(input)).toBe('{"nested":{"rating":1}}');
  });

  it('revalidates externally supplied frozen copies', () => {
    const locked = fixture();
    expect(schema.parse(locked)).toBe(locked);
    expect(schema.safeParse(Object.freeze({ ...locked, players: [{ name: 1 }] })).success).toBe(
      false,
    );
  });
});
