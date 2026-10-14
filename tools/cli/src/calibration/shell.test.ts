import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { M25Gate } from '../commands/season-calibration.ts';
import type { SeedRangeCalibration } from './harness.ts';
import { runCalibrationShell, type CalibrationMeasurement } from './shell.ts';
import { withTmpDir } from '../cli-test-helpers.ts';
import { z } from 'zod';

const PLAN: SeedRangeCalibration = {
  from: 0,
  to: 1,
  workers: 1,
  calibrationIndices: [0],
  validationIndices: [1],
};

function gate(
  key: string,
  pass: boolean,
  status: M25Gate['status'] = pass ? 'pass' : 'fail',
): M25Gate {
  return {
    key,
    observed: 1,
    target: 1,
    tolerance: 0,
    min: null,
    max: null,
    status,
    pass,
    sample: 10,
    minimumSample: 1,
  };
}

const payloadSchema = z.object({ schemaVersion: z.literal(1), command: z.string() }).strict();

function options(
  tmp: string,
  overrides: {
    metrics?: M25Gate[];
    targets?: (() => unknown) | null;
    validate?: (() => never) | null;
    measure?: () => CalibrationMeasurement<Record<string, never>>;
  },
) {
  return {
    command: 'test calibrate',
    argsForReport: { seedFrom: 0, seedTo: 1, workers: 1 },
    plan: PLAN,
    startedAt: Date.now(),
    validate: overrides.validate ?? null,
    artifact: {
      outPath: join(tmp, 'targets.json'),
      defaultTargetsPath: join(tmp, 'default-targets.json'),
      manifestPath: join(tmp, 'manifest.json'),
      manifestKey: 'testTargets',
      manifestUrl: 'season/test-targets.json',
    },
    payloadSchema,
    measure:
      overrides.measure ??
      (() => ({
        metrics: overrides.metrics ?? [gate('alpha', true)],
        gates: { alpha: true },
        extra: {},
        targets: overrides.targets ?? (() => ({ content: true })),
      })),
    report: () => ({
      details: ['measured'],
      payload: { schemaVersion: 1 as const, command: 'test calibrate' },
    }),
  };
}

describe('calibration shell', () => {
  it('writes the artifact and reports a passing calibration', async () => {
    await withTmpDir((tmp) => {
      const report = runCalibrationShell(options(tmp, {}));
      expect(report.ok).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.details).toEqual(['measured']);
      expect(JSON.parse(readFileSync(join(tmp, 'targets.json'), 'utf8'))).toEqual({
        content: true,
      });
    });
  });

  it('does not build the artifact when a gate fails', async () => {
    await withTmpDir((tmp) => {
      const targets = vi.fn(() => ({ content: true }));
      const report = runCalibrationShell(
        options(tmp, { metrics: [gate('alpha', false)], targets }),
      );
      expect(report.ok).toBe(false);
      expect(report.exitCode).toBe(1);
      expect(targets).not.toHaveBeenCalled();
      expect(report.failures).toEqual(['gate alpha: observed 1 (fail)']);
    });
  });

  it('reports skipped gates as failures', async () => {
    await withTmpDir((tmp) => {
      const report = runCalibrationShell(
        options(tmp, { metrics: [gate('alpha', false, 'skippedInsufficientSample')] }),
      );
      expect(report.failures).toEqual([
        'gates skipped (insufficient sample): alpha',
        'gate alpha: observed 1 (skippedInsufficientSample)',
      ]);
    });
  });

  it('reports a cohort failure with exit code 2', async () => {
    await withTmpDir((tmp) => {
      const report = runCalibrationShell(
        options(tmp, {
          measure: () => {
            throw new Error('fixture exploded');
          },
        }),
      );
      expect(report.exitCode).toBe(2);
      expect(report.failures).toEqual(['calibration cohort failed: fixture exploded']);
    });
  });

  it('short-circuits to validate without measuring', async () => {
    await withTmpDir((tmp) => {
      const measure = vi.fn(() => ({
        metrics: [] as M25Gate[],
        gates: {},
        extra: {},
        targets: null,
      }));
      const validate = () => {
        throw new Error('validate report');
      };
      expect(() => runCalibrationShell(options(tmp, { measure, validate }))).toThrow(
        'validate report',
      );
      expect(measure).not.toHaveBeenCalled();
    });
  });

  it('reports a commit error before the gate epilogue', async () => {
    await withTmpDir((tmp) => {
      const broken = options(tmp, {});
      broken.artifact = { ...broken.artifact, outPath: tmp };
      const report = runCalibrationShell(broken);
      expect(report.ok).toBe(false);
      expect(report.failures[0]).toMatch(/cannot write targets/);
      expect(report.failures.at(-1)).toBe('targets artifact was not written');
    });
  });
});
