import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonCandidateCheckpointSchema } from '@hoop-rush/data-contracts';
import {
  seasonBlockAuditReportSchema,
  seasonBlockSimulateReportSchema,
  seasonFullSimulateReportSchema,
} from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.ts';

/**
 * CLI integration tests for the M2.3 `season block simulate`, `season block
 * audit`, and `season full simulate` commands (spec/2.0/02, spec/2.0/07).
 * Every test runs the real engine pipeline over the committed v4 run
 * fixture, the packaged catalog and schedule, and the packaged era profile.
 */

const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
const BLOCK_ZERO_DIGEST = '7b4c5c77947ab5e33ef0a7750cd1c387';

describe('cli: season block simulate', () => {
  it('simulates block 0 over the committed fixture with a clean audit', async () => {
    const { code, stdout, stderr } = await runCli([
      'season',
      'block',
      'simulate',
      '--input',
      SEASON_RUN,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonBlockSimulateReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.pass).toBe(true);
    expect(payload.blockIndex).toBe(0);
    expect(payload.summaryCount).toBe(150);
    expect(payload.retainedDetailCount).toBe(10);
    expect(payload.completedRounds).toBe(10);
    expect(payload.digest).toBe(BLOCK_ZERO_DIGEST);
    expect(payload.auditFailures).toEqual([]);
  });

  it('accepts an explicit --block and rejects an out-of-range block', async () => {
    const ok = await runCli([
      'season',
      'block',
      'simulate',
      '--input',
      SEASON_RUN,
      '--block',
      '0',
      '--format',
      'json',
    ]);
    expect(ok.code).toBe(0);
    const bad = await runCli([
      'season',
      'block',
      'simulate',
      '--input',
      SEASON_RUN,
      '--block',
      '9',
      '--format',
      'json',
    ]);
    expect(bad.code).not.toBe(0);
  });

  it('audits a saved candidate checkpoint with digest verification', async () => {
    // Produce the checkpoint through the authoritative command path and
    // persist it to the scratch directory, then audit the file.
    const { code, stdout, stderr } = await runCli([
      'season',
      'block',
      'simulate',
      '--input',
      SEASON_RUN,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const simulate = seasonBlockSimulateReportSchema.parse(jsonPayload(stdout, stderr));
    expect(simulate.pass).toBe(true);

    // Rebuild the full candidate JSON from a direct engine call so the
    // audit input is byte-complete.
    const checkpointPath = join(TMP, 'block0-checkpoint.json');
    const candidate = await produceBlockZeroCheckpoint();
    writeFileSync(checkpointPath, `${JSON.stringify(candidate, null, 2)}\n`);

    const audit = await runCli([
      'season',
      'block',
      'audit',
      '--input',
      checkpointPath,
      '--run',
      SEASON_RUN,
      '--format',
      'json',
    ]);
    expect(audit.code).toBe(0);
    const payload = seasonBlockAuditReportSchema.parse(jsonPayload(audit.stdout, audit.stderr));
    expect(payload.pass).toBe(true);
    expect(payload.digest).toBe(payload.recomputedDigest);
    expect(payload.digest).toBe(BLOCK_ZERO_DIGEST);
    expect(payload.auditFailures).toEqual([]);
  });
});

describe('cli: season full simulate', () => {
  it('runs all nine blocks and reproduces the same digests twice', async () => {
    const runOnce = async (): Promise<unknown> => {
      const { code, stdout, stderr } = await runCli([
        'season',
        'full',
        'simulate',
        '--input',
        SEASON_RUN,
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      return seasonFullSimulateReportSchema.parse(jsonPayload(stdout, stderr));
    };
    const first = (await runOnce()) as ReturnType<typeof seasonFullSimulateReportSchema.parse>;
    expect(first.pass).toBe(true);
    expect(first.blockDigests).toHaveLength(9);
    expect(first.summaries).toBe(1230);
    // Block-at-a-time digest equality: the standalone block 0 run above
    // produced the same digest as the full-season block 0.
    expect(first.blockDigests[0]?.digest).toBe(BLOCK_ZERO_DIGEST);
    expect(first.blockDigests[8]?.digest).toBe(first.finalDigest);
    const second = (await runOnce()) as ReturnType<typeof seasonFullSimulateReportSchema.parse>;
    // Digests are deterministic; timings are not.
    const digestsOf = (report: typeof first): string[] =>
      report.blockDigests.map((entry) => entry.digest);
    expect(digestsOf(second)).toEqual(digestsOf(first));
  }, 300_000);
});

/** Produces the block-0 candidate checkpoint through the engine pipeline. */
async function produceBlockZeroCheckpoint(): Promise<
  ReturnType<typeof seasonCandidateCheckpointSchema.parse>
> {
  const { seasonRunSchema } = await import('@hoop-rush/data-contracts');
  const { createSeasonBlockRunner, rollForwardTo, runBlockThroughHandler } =
    await import('../src/commands/season-block.ts');
  const state = createSeasonBlockRunner({ runPath: SEASON_RUN });
  rollForwardTo(state, 0);
  const checkpoint = runBlockThroughHandler(state, 0);
  const parsed = seasonRunSchema.safeParse(JSON.parse(readFileSync(SEASON_RUN, 'utf8')));
  expect(parsed.success).toBe(true);
  return seasonCandidateCheckpointSchema.parse(checkpoint);
}
