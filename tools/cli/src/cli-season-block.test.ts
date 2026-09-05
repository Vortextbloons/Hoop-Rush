import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  seasonBlockSimulateReportSchema,
  seasonFullSimulateReportSchema,
} from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli } from './cli-test-helpers.ts';
const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
const BLOCK_ZERO_DIGEST = 'b4a56279ab857e9567e8a0f3f4c7d749';
describe('cli: season block simulate', () => {
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
  }, 60000);
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
    expect(report.blockDigests[0]?.digest).toBe(BLOCK_ZERO_DIGEST);
    expect(report.blockDigests[8]?.digest).toBe(report.finalDigest);
  }, 300000);
});
