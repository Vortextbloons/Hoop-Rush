import { describe, expect, it } from 'vitest';
import { UsageError } from '../args.ts';
import { bracketGenerate } from './bracket-generate.ts';

/**
 * `bracket generate` tests (spec/09): the usage boundary of the dev tool.
 * Actual regeneration reads the packaged NBA snapshot and writes the frozen
 * artifact, so only the deterministic validation entry is unit-tested here.
 */

describe('bracketGenerate', () => {
  it.each(['not-hex', 'ab'])('rejects a malformed seed (%s)', (seed) => {
    expect(() => bracketGenerate({ seed })).toThrow(UsageError);
  });

  // Full regeneration (30 franchises x 32 proposals, 32 benchmark games
  // each) takes ~13s isolated and can double under the shared parallel
  // runner, so it needs a per-test budget beyond the 30s project default.
  it('accepts the committed 32-hex seed shape', () => {
    expect(() => bracketGenerate({ seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d' })).not.toThrow(
      UsageError,
    );
  }, 60_000);

  it('rejects benchmark samples too low for stable percentile separation', () => {
    expect(() =>
      bracketGenerate({
        seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d',
        samples: '6',
      }),
    ).toThrow(/at least 32/);
  });
});
