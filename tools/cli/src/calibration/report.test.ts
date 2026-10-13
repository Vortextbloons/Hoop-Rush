import { describe, expect, it } from 'vitest';
import { calibrationGateFailures, targetsDetail } from './report.ts';

describe('calibration reporting', () => {
  it('labels written, unwritten, and no-write targets', () => {
    expect(targetsDetail({ targetsWritten: true, targetsPath: 'out.json' })).toBe(
      'targets written to out.json',
    );
    expect(targetsDetail({ targetsWritten: true, targetsPath: null })).toBe('targets written to ?');
    expect(targetsDetail({ targetsWritten: false, targetsPath: null })).toBe('targets NOT written');
    expect(targetsDetail({ targetsWritten: false, targetsPath: null, writeRequested: false })).toBe(
      'targets not written (no --write)',
    );
  });

  it('reports skipped gates, failed gates, and a missing artifact in order', () => {
    const failures = calibrationGateFailures({
      pass: false,
      targetsWritten: false,
      skippedGates: ['heldOut'],
      metrics: [
        { key: 'dealCompleteness', observed: 0.9, status: 'fail', pass: false },
        { key: 'canonicalOrder', observed: 1, status: 'pass', pass: true },
      ],
    });
    expect(failures).toEqual([
      'gates skipped (insufficient sample): heldOut',
      'gate dealCompleteness: observed 0.9 (fail)',
    ]);
  });

  it('flags a passing calibration that did not write the artifact', () => {
    const failures = calibrationGateFailures({
      pass: true,
      targetsWritten: false,
      skippedGates: [],
      metrics: [{ key: 'dealCompleteness', observed: 1, status: 'pass', pass: true }],
    });
    expect(failures).toEqual(['targets artifact was not written']);
  });

  it('reports no failures for a written passing calibration', () => {
    const failures = calibrationGateFailures({
      pass: true,
      targetsWritten: true,
      skippedGates: [],
      metrics: [{ key: 'dealCompleteness', observed: 1, status: 'pass', pass: true }],
    });
    expect(failures).toEqual([]);
  });
});
