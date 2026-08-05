import { describe, expect, it } from 'vitest';
import { runCli } from './cli-test-helpers.ts';

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
});
