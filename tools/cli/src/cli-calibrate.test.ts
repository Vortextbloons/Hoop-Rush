import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calibrateRunReportSchema, calibrateSensitivityReportSchema } from './report-schemas.js';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.js';

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
      if (lowSampleMetrics.has(metric.key)) continue;
      expect(metric.observed).toBeGreaterThanOrEqual(metric.target - metric.tolerance - 0.02);
      expect(metric.observed).toBeLessThanOrEqual(metric.target + metric.tolerance + 0.02);
    }
  }, 60_000);

  it('calibrate run exits 1 when a gate fails', async () => {
    // A tolerance of zero on one metric cannot be satisfied by a seeded batch.
    const badProfile = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json'), 'utf8'),
    ) as { targets: Record<string, { tolerance: number }> };
    const pointsTarget = badProfile.targets.pointsPerGame;
    if (!pointsTarget) throw new Error('profile lacks pointsPerGame target');
    pointsTarget.tolerance = 0;
    const badPath = join(TMP, 'bad-profile.json');
    writeFileSync(badPath, JSON.stringify(badProfile));
    const { code } = await runCli([
      'calibrate',
      'run',
      '--samples',
      '300',
      '--challenge-samples',
      '0',
      '--opponent-games',
      '3',
      '--profile',
      badPath,
    ]);
    expect(code).toBe(1);
  }, 60_000);

  it('calibrate run rejects an invalid profile with exit 2', async () => {
    const badPath = join(TMP, 'invalid-profile.json');
    writeFileSync(badPath, JSON.stringify({ not: 'a profile' }));
    const { code, stderr } = await runCli(['calibrate', 'run', '--profile', badPath]);
    expect(code).toBe(2);
    expect(stderr).toContain('profile');
  });

  it('calibrate sensitivity passes every family', async () => {
    const { code, stdout } = await runCli([
      'calibrate',
      'sensitivity',
      '--samples',
      '200',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = calibrateSensitivityReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.metrics.length).toBe(9);
  });
});
