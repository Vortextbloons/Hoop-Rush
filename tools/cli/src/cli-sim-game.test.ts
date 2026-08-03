import { describe, expect, it } from 'vitest';
import { simGameReportSchema } from './report-schemas.js';
import { jsonPayload, runCli } from './cli-test-helpers.js';

describe('cli: sim game', () => {
  it('runs a game and emits a validated payload with versions and invariants', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'game',
      '--input',
      'equal',
      '--seed',
      '45ca740e45ca740e45ca740e45ca740e',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simGameReportSchema.parse(jsonPayload(stdout));
    expect(payload.invariants).toEqual([]);
    expect(payload.engineVersion).toMatch(/^m3-engine/);
    expect(payload.profileVersion).toMatch(/^m3-1990s/);
    expect(payload.fixture).toBe('equal');
    expect(payload.result).toBeDefined();
    expect(payload.timingMs).toBeGreaterThan(0);
  });

  it('is reproducible: the same seed and fixture produce the same score', async () => {
    const run = async () => {
      const { code, stdout } = await runCli([
        'sim',
        'game',
        '--input',
        'strong-weak',
        '--seed',
        'abcdefabcdefabcdefabcdefabcdef',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      const payload = simGameReportSchema.parse(jsonPayload(stdout));
      const result = payload.result as {
        home: { box: { points: number } };
        away: { box: { points: number } };
      };
      return `${String(result.home.box.points)}-${String(result.away.box.points)}`;
    };
    expect(await run()).toBe(await run());
  });
});
