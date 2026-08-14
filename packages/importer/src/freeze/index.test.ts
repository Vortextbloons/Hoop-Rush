import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractCalibrationPayload, freezeTargets, MINIMUM_SAMPLES } from './index.ts';
import { writeJson } from '../json.ts';

const tempRoots: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hoop-rush-freeze-'));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function buildReport(overrides: Record<string, unknown> = {}): string {
  const payload = {
    command: 'calibrate run',
    eraId: '1990s',
    samples: 10000,
    engineVersion: 'm3-engine-v4',
    metrics: [
      { key: 'possessionsPerGame', observed: 88.76762 },
      { key: 'pointsPerGame', observed: 102.31256 },
      { key: 'zoneMix.rim', observed: 0.46253 },
      { key: 'closeGameRate', observed: 0.28471 },
      { key: 'overtimeRate', observed: 0.02794 },
    ],
    ...overrides,
  };
  return `calibration run finished\n--- begin report ---\n${JSON.stringify({ payload })}\n--- end report ---\n`;
}

function baseProfile(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eraId: '1990s',
    profileVersion: 'm3-1990s-v1',
    dataVersion: 'm1.6',
    seasons: ['1990-91'],
    baselineReport: 'derived from packaged stints; targets frozen after calibration baseline',
    parameters: {
      pace: 95.0,
      league3PARate: 0.1477,
      zoneMix: { rim: 0.4576, cornerThree: 0.0544 },
    },
    targets: {
      possessionsPerGame: { value: 88.7, tolerance: 3, minimumSample: 200 },
      pointsPerGame: { value: 102.0, tolerance: 5, minimumSample: 200 },
      zoneMix: { rim: { value: 0.4576, tolerance: 0.02, minimumSample: 200 } },
      closeGameRate: { value: 0.28, tolerance: 0.04, minimumSample: 2000 },
      overtimeRate: { value: 0.027, tolerance: 0.02, minimumSample: 2000 },
    },
  };
}

describe('extractCalibrationPayload', () => {
  it('slices the first balanced JSON object out of surrounding log text', () => {
    const payload = extractCalibrationPayload(buildReport());
    expect(payload.command).toBe('calibrate run');
    expect(payload.eraId).toBe('1990s');
    expect(payload.samples).toBe(10000);
    expect(payload.metrics).toHaveLength(5);
  });

  it('rejects text without a JSON payload', () => {
    expect(() => extractCalibrationPayload('no braces here')).toThrow(
      'report contains no JSON payload',
    );
  });

  it('rejects an unclosed JSON payload', () => {
    expect(() =>
      extractCalibrationPayload('prefix {"payload": {"command": "calibrate run"'),
    ).toThrow('report JSON payload is not closed');
  });

  it('rejects a report for a different command', () => {
    const raw = buildReport({ command: 'simulate run' });
    expect(() => extractCalibrationPayload(raw)).toThrow('expected a calibrate run report');
  });
});

describe('freezeTargets', () => {
  it('applies observed values with 4-decimal rounding, preserving tolerances', () => {
    const dir = makeTempDir();
    const reportPath = join(dir, 'baseline-report.json');
    const profilePath = join(dir, '1990s.json');
    writeFileSync(reportPath, buildReport(), 'utf8');
    writeJson(profilePath, baseProfile());

    freezeTargets(reportPath, '1990s', profilePath);

    const written = readFileSync(profilePath, 'utf8');
    expect(written.endsWith('\n')).toBe(true);

    const profile = JSON.parse(written) as {
      profileVersion: string;
      baselineReport: string;
      targets: Record<string, unknown>;
    };
    expect(profile.profileVersion).toBe('m3-1990s-v2');
    expect(profile.baselineReport).toBe('calibrate run --samples 10000 (engine m3-engine-v4)');
    expect(profile.targets['possessionsPerGame']).toEqual({
      value: 88.7676,
      tolerance: 3,
      minimumSample: 200,
    });
    expect(profile.targets['pointsPerGame']).toEqual({
      value: 102.3126,
      tolerance: 5,
      minimumSample: 200,
    });

    expect(profile.targets['zoneMix']).toEqual({
      rim: { value: 0.4625, tolerance: 0.02, minimumSample: 200 },
    });

    expect(profile.targets['closeGameRate']).toEqual({
      value: 0.2847,
      tolerance: 0.04,
      minimumSample: 2000,
    });
    expect(profile.targets['overtimeRate']).toEqual({
      value: 0.0279,
      tolerance: 0.02,
      minimumSample: 2000,
    });
  });

  it('rejects a report for a different era', () => {
    const dir = makeTempDir();
    const reportPath = join(dir, 'baseline-report.json');
    const profilePath = join(dir, '1990s.json');
    writeFileSync(reportPath, buildReport({ eraId: '2000s' }), 'utf8');
    writeJson(profilePath, baseProfile());

    expect(() => {
      freezeTargets(reportPath, '1990s', profilePath);
    }).toThrow('report is for era 2000s, not 1990s');
  });

  it('rejects a metric key the profile has no target for', () => {
    const dir = makeTempDir();
    const reportPath = join(dir, 'baseline-report.json');
    const profilePath = join(dir, '1990s.json');
    writeFileSync(
      reportPath,
      buildReport({ metrics: [{ key: 'madeUpGate', observed: 0.5 }] }),
      'utf8',
    );
    writeJson(profilePath, baseProfile());

    expect(() => {
      freezeTargets(reportPath, '1990s', profilePath);
    }).toThrow('profile has no target madeUpGate');
  });
});

describe('MINIMUM_SAMPLES', () => {
  it('covers the five distribution gates', () => {
    expect(MINIMUM_SAMPLES['closeGameRate']).toBe(2000);
    expect(MINIMUM_SAMPLES['blowoutRate']).toBe(2000);
    expect(MINIMUM_SAMPLES['overtimeRate']).toBe(2000);
    expect(MINIMUM_SAMPLES['strongVsWeakWinRate']).toBe(2000);
    expect(MINIMUM_SAMPLES['equalLineupHomeWinRate']).toBe(2000);
  });

  it('leaves per-game gates to the profile default', () => {
    expect(MINIMUM_SAMPLES['possessionsPerGame']).toBeUndefined();
  });
});
