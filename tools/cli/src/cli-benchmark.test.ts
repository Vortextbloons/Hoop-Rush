import { describe, expect, it } from 'vitest';
import { benchmarkReportSchema } from './report-schemas.js';
import { jsonPayload, runCli } from './cli-test-helpers.js';

describe('cli: benchmark', () => {
  it('measures warm single-game and 82-game runs with a validated payload', async () => {
    const { code, stdout } = await runCli(['benchmark', '--samples', '5', '--format', 'json']);
    expect(code).toBe(0);
    const payload = benchmarkReportSchema.parse(jsonPayload(stdout));
    expect(payload.environment.platform).toBe(process.platform);
    expect(payload.engineVersion).toMatch(/^m3-engine/);
    expect(payload.singleGame.sampleCount).toBe(5);
    expect(payload.challenge82.sampleCount).toBe(5);
    expect(payload.singleGame.medianMs).toBeGreaterThan(0);
    expect(payload.challenge82.medianMs).toBeGreaterThan(0);
    expect(payload.heapUsedMb).toBeGreaterThan(0);
  });

  it('produces identical results across worker counts', async () => {
    const runWith = async (workers: string) => {
      const { code, stdout } = await runCli([
        'benchmark',
        '--samples',
        '4',
        '--workers',
        workers,
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      return benchmarkReportSchema.parse(jsonPayload(stdout));
    };
    const single = await runWith('1');
    const many = await runWith('4');
    expect(many.singleGame.sampleCount).toBe(single.singleGame.sampleCount);
    expect(many.challenge82.sampleCount).toBe(single.challenge82.sampleCount);
  });
});
