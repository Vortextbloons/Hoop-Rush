import { describe, expect, it } from 'vitest';
import { seedSchema } from '@hoop-rush/data-contracts';
import { havocMultiplayerByteDraw } from './seed-parity.ts';

describe('havoc multiplayer byte draws', () => {
  it('maps even bytes to p1 and odd bytes to p2 at the server offsets', () => {
    const evenFirst = seedSchema.parse('0a'.padEnd(32, '0'));
    const oddFirst = seedSchema.parse('0b'.padEnd(32, '0'));
    const evenSecond = seedSchema.parse(`000a${''.padEnd(28, '0')}`);
    const oddSecond = seedSchema.parse(`000b${''.padEnd(28, '0')}`);

    expect(havocMultiplayerByteDraw(evenFirst, 0)).toBe('p1');
    expect(havocMultiplayerByteDraw(oddFirst, 0)).toBe('p2');
    expect(havocMultiplayerByteDraw(evenSecond, 2)).toBe('p1');
    expect(havocMultiplayerByteDraw(oddSecond, 2)).toBe('p2');
  });
});
