import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calibrateRunReportSchema, calibrateSensitivityReportSchema } from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, withTmpDir } from './cli-test-helpers.ts';

describe('cli: calibrate commands', () => {
  it('calibrate run passes the frozen profile and emits a validated payload', async () => {
    const { code, stdout } = await runCli([
      'calibrate',
      'run',
      '--samples',
      '500',
      '--challenge-samples',
      '1',
      '--opponent-games',
      '3',
      '--allow-skipped',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = calibrateRunReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.metrics.length).toBeGreaterThan(20);
    expect(payload.profileVersion).toMatch(/^m3-1990s/);
    expect(payload.bracketDistribution).toHaveLength(30);
    expect(payload.bracketMedianObservedWinRate).not.toBeNull();
    expect(payload.perfectRunRate).not.toBeNull();
    expect(payload.challengeRuns).toBe(1);

    const lowSampleMetrics = new Set([
      'closeGameRate',
      'blowoutRate',
      'overtimeRate',
      'strongVsWeakWinRate',
      'equalLineupHomeWinRate',
    ]);
    for (const metric of payload.metrics) {
      if (lowSampleMetrics.has(metric.key)) {
        expect(metric.status).toBe('skippedInsufficientSample');
        expect(metric.sample).toBe(500);
        expect(metric.minimumSample).toBe(2000);
        expect(metric.pass).toBe(false);
        continue;
      }
      expect(metric.status).toBe('pass');
      expect(metric.observed).toBeGreaterThanOrEqual(metric.target - metric.tolerance - 0.02);
      expect(metric.observed).toBeLessThanOrEqual(metric.target + metric.tolerance + 0.02);
    }
  }, 60_000);

  it('calibrate run fails when a required gate is skipped (no --allow-skipped)', async () => {
    const { code, stdout, stderr } = await runCli([
      'calibrate',
      'run',
      '--samples',
      '150',
      '--challenge-samples',
      '0',
      '--opponent-games',
      '3',
      '--format',
      'json',
    ]);
    expect(code).toBe(1);
    const payload = calibrateRunReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.pass).toBe(false);
    const skipped = payload.metrics.filter((m) => m.status === 'skippedInsufficientSample');
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.some((m) => m.key === 'strongVsWeakWinRate')).toBe(true);
  }, 60_000);

  it('calibrate run exits 1 when a gate fails', async () => {
    await withTmpDir(async (tmp) => {
      const badProfile = JSON.parse(
        readFileSync(join(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json'), 'utf8'),
      ) as { targets: Record<string, { tolerance: number }> };
      const pointsTarget = badProfile.targets.pointsPerGame;
      if (!pointsTarget) throw new Error('profile lacks pointsPerGame target');
      pointsTarget.tolerance = 0;
      const badPath = join(tmp, 'bad-profile.json');
      writeFileSync(badPath, JSON.stringify(badProfile));
      const { code } = await runCli([
        'calibrate',
        'run',
        '--samples',
        '200',
        '--challenge-samples',
        '0',
        '--opponent-games',
        '3',
        '--profile',
        badPath,
        '--allow-skipped',
      ]);
      expect(code).toBe(1);
    });
  }, 60_000);

  it('calibrate run rejects an invalid profile with exit 2', async () => {
    await withTmpDir(async (tmp) => {
      const badPath = join(tmp, 'invalid-profile.json');
      writeFileSync(badPath, JSON.stringify({ not: 'a profile' }));
      const { code, stderr } = await runCli(['calibrate', 'run', '--profile', badPath]);
      expect(code).toBe(2);
      expect(stderr).toContain('profile');
    });
  });

  it('calibrate sensitivity passes every family', async () => {
    const { code, stdout } = await runCli([
      'calibrate',
      'sensitivity',
      '--samples',
      '100',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = calibrateSensitivityReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.metrics.length).toBe(9);
  });
});
