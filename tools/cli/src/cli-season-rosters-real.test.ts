import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonRostersCalibrateReportSchema } from './report-schemas.ts';
import { jsonPayload, runCli, TMP } from './cli-test-helpers.ts';
import { handBuiltTargets } from './cli-season-rosters-test-support.ts';

/**
 * The real-subprocess `season rosters calibrate` sentinel (spec/2.0 M2.4
 * roster-generation-v2): boots the CLI, its worker threads, and the
 * authoritative `generateAiLeague` seam end to end. The calibrate gate math
 * itself is covered by the injected-cohort doubles in
 * cli-season-rosters.test.ts; this file keeps one authoritative real run.
 *
 * It lives in its own file so vitest runs it in parallel with the doubles
 * suite instead of serially after it (the dominant cost is five full league
 * generations: one calibration seed, one validation seed, and one
 * order-invariance seed over three input variants).
 */

describe('cli: season rosters calibrate (real subprocess sentinel)', () => {
  it('--validate evaluates gates through the real subprocess without rewriting the artifact', async () => {
    const targets = handBuiltTargets();
    const targetsPath = join(TMP, 'validate-targets.json');
    const targetsBytes = `${JSON.stringify(targets, null, 2)}\n`;
    writeFileSync(targetsPath, targetsBytes);
    const { code, stdout, stderr } = await runCli([
      'season',
      'rosters',
      'calibrate',
      '--calibration-seeds',
      '1',
      '--validation-seeds',
      '1',
      '--workers',
      '2',
      '--targets',
      targetsPath,
      '--validate',
      '--format',
      'json',
    ]);
    expect([0, 1]).toContain(code);
    const payload = seasonRostersCalibrateReportSchema.parse(jsonPayload(stdout, stderr));
    expect(payload.calibrationSeeds).toBe(1);
    expect(payload.validationSeeds).toBe(1);
    expect(payload.validateOnly).toBe(true);
    expect(payload.targetsWritten).toBe(false);
    expect(payload.targetsPath).toBe(null);
    // Byte-compare: the artifact is untouched in validate mode.
    expect(readFileSync(targetsPath, 'utf8')).toBe(targetsBytes);
  }, 300_000);
});
