import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
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
 * BLOCK_ZERO_DIGEST is re-pinned whenever a committed schedule or fixture
 * input changes, so it remains an end-to-end reproducibility sentinel.
 */

const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
// Re-pinned for the M2.5 schema-7 fixture (injuries, health, and the
// objective/Influence-carrying checkpoint digest), the projection-milestone
// v3 fixture (talent-ordered AI rotations change the rotation-set digest),
// and the minute-policy-v1 fixture (optimizer minute plans change the
// rotation-set digest again).
const BLOCK_ZERO_DIGEST = 'c416d71fd0eb36131f57c4b1b44fb48f';

describe('cli: season block simulate', () => {
  // The default block-0 boot is shared by the simulate and audit tests.
  let blockZero: Awaited<ReturnType<typeof runCli>>;

  beforeAll(async () => {
    blockZero = await runCli([
      'season',
      'block',
      'simulate',
      '--input',
      SEASON_RUN,
      '--format',
      'json',
    ]);
  }, 60_000);

  it('simulates block 0 over the committed fixture with a clean audit', () => {
    const { code, stdout, stderr } = blockZero;
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
    const { code, stdout, stderr } = blockZero;
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
  it('runs all nine blocks and reports deterministic per-block digests', async () => {
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
    const report = seasonFullSimulateReportSchema.parse(jsonPayload(stdout, stderr));
    expect(report.pass).toBe(true);
    expect(report.blockDigests).toHaveLength(9);
    expect(report.summaries).toBe(1230);
    // Block-at-a-time digest equality: the standalone block 0 run above
    // produced the same digest as the full-season block 0. Repeat-run
    // digest identity is proven in-process by the engine determinism suite.
    expect(report.blockDigests[0]?.digest).toBe(BLOCK_ZERO_DIGEST);
    expect(report.blockDigests[8]?.digest).toBe(report.finalDigest);
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
