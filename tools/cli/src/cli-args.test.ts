import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, TMP } from './cli-test-helpers.js';

describe('cli: argument validation and exit codes', () => {
  it('prints help and exits 0 with no arguments', async () => {
    const { code, stdout } = await runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain('hoop-rush — developer CLI');
  });

  it('rejects an unknown command with exit 2', async () => {
    const { code, stderr } = await runCli(['frobnicate']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command');
  });

  it('rejects unknown options with exit 2', async () => {
    const { code, stderr } = await runCli(['sim', 'game', '--input', 'equal', '--nope', '1']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown option');
  });

  it('requires a seed for sim game with exit 2', async () => {
    const { code, stderr } = await runCli(['sim', 'game', '--input', 'equal']);
    expect(code).toBe(2);
    expect(stderr).toContain('--seed');
  });

  it('rejects a non-hex seed with exit 2', async () => {
    const { code, stderr } = await runCli([
      'sim',
      'game',
      '--input',
      'equal',
      '--seed',
      'not-hex!',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('hex');
  });

  it('rejects an unknown fixture with exit 2', async () => {
    const { code, stderr } = await runCli([
      'sim',
      'game',
      '--input',
      'does-not-exist',
      '--seed',
      'a'.repeat(32),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('fixture not found');
  });

  it('rejects a missing replay input with exit 2', async () => {
    const { code, stderr } = await runCli([
      'replay',
      '--input',
      join(TMP, 'missing.json'),
      '--expected',
      join(TMP, 'missing2.json'),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('file not found');
  });
});
