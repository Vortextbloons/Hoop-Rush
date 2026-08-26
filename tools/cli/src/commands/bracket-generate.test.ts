import { describe, expect, it } from 'vitest';
import { UsageError } from '../args.ts';
import { bracketGenerate } from './bracket-generate.ts';
describe('bracketGenerate', () => {
    it.each(['not-hex', 'ab'])('rejects a malformed seed (%s)', (seed) => {
        expect(() => bracketGenerate({ seed })).toThrow(UsageError);
    });
    it('accepts the committed 32-hex seed shape', () => {
        expect(() => bracketGenerate({ seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d' })).not.toThrow(UsageError);
    }, 60000);
    it('rejects benchmark samples too low for stable percentile separation', () => {
        expect(() => bracketGenerate({
            seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d',
            samples: '6',
        })).toThrow(/at least 32/);
    });
});
