import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { combineDocs } from './docs-combine.js';
import { EXIT_OK, EXIT_USAGE_OR_DATA_ERROR } from '../report.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hoop-rush-combine-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('combineDocs', () => {
  it('combines nested markdown files in sorted order', async () => {
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'b', 'zeta.md'), '# Zeta\n\ncontent z');
    await writeFile(join(dir, 'a', 'alpha.md'), '# Alpha\n\ncontent a');

    const report = combineDocs({ input: dir, output: join(dir, 'combined.md') });
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(EXIT_OK);

    const combined = readFileSync(join(dir, 'combined.md'), 'utf8');
    expect(combined).toContain('## a/alpha.md');
    expect(combined).toContain('## b/zeta.md');
    expect(combined.indexOf('alpha.md')).toBeLessThan(combined.indexOf('zeta.md'));
  });

  it('excludes the output file from its own output', async () => {
    await writeFile(join(dir, 'one.md'), '# One');
    const output = join(dir, 'combined.md');
    const report = combineDocs({ input: dir, output });
    expect(report.ok).toBe(true);
    const combined = readFileSync(output, 'utf8');
    expect(combined).not.toContain('## combined.md');
  });

  it('honors exception entries for files and directories', async () => {
    await mkdir(join(dir, 'private'));
    await writeFile(join(dir, 'private', 'secret.md'), '# Secret');
    await writeFile(join(dir, 'public.md'), '# Public');
    await writeFile(join(dir, 'keep.md'), '# Keep');
    await writeFile(
      join(dir, 'combine-exceptions.txt'),
      ['# comment', '', 'private/', 'keep.md'].join('\n'),
    );

    const report = combineDocs({ input: dir });
    expect(report.ok).toBe(true);
    const combined = readFileSync(join(dir, 'combined.md'), 'utf8');
    expect(combined).toContain('## public.md');
    expect(combined).not.toContain('secret.md');
    expect(combined).not.toContain('keep.md');
  });

  it('reports a missing docs directory as a usage error', () => {
    expect(() => combineDocs({ input: join(dir, 'missing') })).toThrow(/does not exist/);
  });

  it('fails when every file is excluded', async () => {
    await writeFile(join(dir, 'only.md'), '# Only');
    await writeFile(join(dir, 'ex.txt'), 'only.md');
    const report = combineDocs({ input: dir, exceptions: join(dir, 'ex.txt') });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
});
