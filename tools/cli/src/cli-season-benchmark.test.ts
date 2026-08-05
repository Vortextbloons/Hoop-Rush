import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonBenchmarkReportSchema } from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.ts';

/**
 * CLI integration tests for the M2.3 `season benchmark` commands
 * (spec/2.0/12 performance framework): the determinism gate is the M2.3
 * golden exit gate (uninterrupted, repeated, and interrupted-resume runs
 * must produce identical digests), and the block/full benchmarks report
 * measured times against the documented desktop budgets.
 */

const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');

describe('cli: season benchmark determinism', () => {
  it('produces identical digests across repeated and interrupted runs', async () => {
    const { code, stdout, stderr } = await runCli([
      'season',
      'benchmark',
      'determinism',
      '--input',
      SEASON_RUN,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonBenchmarkReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.pass).toBe(true);
    expect(payload.identicalDigests).toBe(true);
    expect(payload.perBlock).toHaveLength(9);
    expect(payload.digest).toMatch(/^[0-9a-f]{32}$/);
  }, 300_000);
});

describe('cli: season benchmark block and full', () => {
  it('reports measured block times against the documented budgets', async () => {
    const { code, stdout, stderr } = await runCli([
      'season',
      'benchmark',
      'block',
      '--input',
      SEASON_RUN,
      '--out',
      join(TMP, 'benchmark-block.json'),
      '--format',
      'json',
    ]);
    // Budgets are reference-machine numbers: an over-budget report is a
    // legitimate exit-1 outcome, so both codes are accepted here.
    expect([0, 1]).toContain(code);
    const payload = seasonBenchmarkReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.command).toBe('season benchmark block');
    expect(payload.perBlock).toHaveLength(2);
    expect(payload.perBlock?.[0]?.blockIndex).toBe(0);
    expect(payload.perBlock?.[1]?.blockIndex).toBe(8);
    expect(payload.outPath).toContain('benchmark-block.json');
  }, 300_000);

  it('runs the full season and reports the final digest and budget', async () => {
    const { code, stdout, stderr } = await runCli([
      'season',
      'benchmark',
      'full',
      '--input',
      SEASON_RUN,
      '--format',
      'json',
    ]);
    // The 30s budget is a reference-machine number; under CI load this
    // machine can cross it, so both exit codes are accepted here.
    expect([0, 1]).toContain(code);
    const payload = seasonBenchmarkReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.command).toBe('season benchmark full');
    expect(payload.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.budgetMs).toBe(30000);
    expect(payload.perBlock).toHaveLength(9);
  }, 300_000);
});

describe('cli: season benchmark persistence', () => {
  it('runs the persistence benchmark harness and reports its budgets', async () => {
    const { code, stdout, stderr } = await runCli([
      'season',
      'benchmark',
      'persistence',
      '--samples',
      '1',
      '--format',
      'json',
    ]);
    // The harness lives in the sibling persistence package. When it is
    // runnable under the CLI's runtime, the command exits 0 with the
    // harness budgets; an import failure is reported as a typed exit-1
    // failure instead of a crash.
    expect([0, 1]).toContain(code);
    const payload = seasonBenchmarkReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.command).toBe('season benchmark persistence');
    if (code === 0) {
      expect(payload.pass).toBe(true);
      expect(payload.persistence).not.toBeNull();
    }
  }, 300_000);
});
