import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../args.ts';
import { REPO_ROOT, withTmpDir } from '../cli-test-helpers.ts';
import { bracketGenerate } from './bracket-generate.ts';
describe('bracketGenerate', () => {
  it.each(['not-hex', 'ab'])('rejects a malformed seed (%s)', (seed) => {
    expect(() => bracketGenerate({ seed })).toThrow(UsageError);
  });
  it('accepts the committed 32-hex seed shape', async () => {
    await withTmpDir((tmp) => {
      copyFileSync(
        join(REPO_ROOT, 'apps/web/static/data/opponents/lakers-1990s-opening.json'),
        join(tmp, 'lakers-1990s-opening.json'),
      );
      expect(() =>
        bracketGenerate({
          seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d',
          opponentsDir: tmp,
          manifestPath: join(tmp, 'manifest.json'),
        }),
      ).not.toThrow(UsageError);
    });
  }, 300000);
  it('rejects benchmark samples too low for stable percentile separation', () => {
    expect(() =>
      bracketGenerate({
        seed: '8f2c1d4e6a9b7c3d8f2c1d4e6a9b7c3d',
        samples: '6',
      }),
    ).toThrow(/at least 32/);
  });
});
