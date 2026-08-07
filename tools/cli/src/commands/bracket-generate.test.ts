import { describe, expect, it } from 'vitest';
import { UsageError } from '../args.ts';
import { bracketGenerate } from './bracket-generate.ts';

/**
 * `bracket generate` tests (spec/09): the usage boundary of the dev tool.
 * Actual regeneration reads the packaged NBA snapshot and writes the frozen
 * artifact, so only the deterministic validation entry is unit-tested here.
 */

describe('bracketGenerate', () => {
  it('rejects a non-hex seed', () => {
    expect(() => bracketGenerate({ seed: 'not-hex' })).toThrow(UsageError);
  });

  it('rejects a too-short hex seed', () => {
    expect(() => bracketGenerate({ seed: 'ab' })).toThrow(UsageError);
  });

  it('accepts the committed 32-hex seed shape', () => {
    expect(() => bracketGenerate({ seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d' })).not.toThrow(
      UsageError,
    );
  });
});
