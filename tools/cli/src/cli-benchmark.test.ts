import { describe, expect, it } from 'vitest';
import { benchmarkReportSchema } from './report-schemas.js';
import { jsonPayload, runCli } from './cli-test-helpers.js';

describe('cli: benchmark', () => {
  it('measures warm single-game and 82-game runs with a validated payload', async () => {
    // `--workers` is a pass-through re-chunking a sequential loop; the flag
    // is still exercised end-to-end here (worker plumbing itself is covered
    // by the sim batch worker-count test).
    // Use enough samples for stable stats: with 5 samples the median is the
    // third of five noisy samples and p95 is the max, which flaked the perf
    // gates on shared CI runners even with no engine regression.
    const { code, stdout, stderr } = await runCli([
      'benchmark',
      '--samples',
      '25',
      '--workers',
      '2',
      '--format',
      'json',
    ]);
    expect(code, stderr || stdout).toBe(0);
    const payload = benchmarkReportSchema.parse(jsonPayload(stdout));
    expect(payload.environment.platform).toBe(process.platform);
    expect(payload.engineVersion).toMatch(/^m3-engine/);
    expect(payload.singleGame.sampleCount).toBe(25);
    expect(payload.challenge82.sampleCount).toBe(25);
    expect(payload.singleGame.medianMs).toBeGreaterThan(0);
    expect(payload.challenge82.medianMs).toBeGreaterThan(0);
    expect(payload.heapUsedMb).toBeGreaterThan(0);
  });
});
