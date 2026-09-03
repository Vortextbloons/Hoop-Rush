import { describe, expect, it } from 'vitest';
import { benchmarkReportSchema } from './report-schemas.ts';
import { jsonPayload, runCli } from './cli-test-helpers.ts';
describe('cli: benchmark', () => {
  it('measures warm single-game and 82-game runs with a validated payload', async () => {
    const { code, stdout } = await runCli([
      'benchmark',
      '--samples',
      '25',
      '--workers',
      '2',
      '--format',
      'json',
    ]);
    expect([0, 1]).toContain(code);
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
