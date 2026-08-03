import { describe, expect, it } from 'vitest';
import { simChallengeReportSchema } from './report-schemas.js';
import { jsonPayload, runCli } from './cli-test-helpers.js';

describe('cli: sim challenge', () => {
  it('runs a complete 82-game challenge with a validated payload', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'challenge',
      '--lineup',
      'challenge-user',
      '--seed',
      '12341234123412341234123412341234',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
    expect(payload.record.gamesPlayed).toBe(82);
    expect(payload.record.wins + payload.record.losses).toBe(82);
    expect(['eliminated', 'perfect']).toContain(payload.outcome);
    expect(payload.invariantFailures).toBe(0);
    expect(payload.bracketVersion).toMatch(/^bracket-m3/);
    expect(payload.playerTotals).toHaveLength(5);
    expect(payload.attempts).toBe(2);
    expect(payload.chosenSeed).toMatch(/^[0-9a-f]{16,64}$/);
    expect(payload.chosenSeed).not.toBe(payload.seed);
    if (payload.outcome === 'eliminated') {
      expect(payload.firstLossGameNumber).toBeGreaterThanOrEqual(1);
      expect(payload.firstLossGameNumber).toBeLessThanOrEqual(82);
    } else {
      expect(payload.firstLossGameNumber).toBeNull();
    }
  });

  it('requires a seed and rejects invalid hex with exit 2', async () => {
    const missing = await runCli(['sim', 'challenge']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('--seed');
    const bad = await runCli(['sim', 'challenge', '--seed', 'not-hex!']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('hex');
  });

  it('is reproducible: the same seed reproduces the same record', async () => {
    const run = async () => {
      const { code, stdout } = await runCli([
        'sim',
        'challenge',
        '--seed',
        'abcdefabcdefabcdefabcdefabcdef',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
      return `${String(payload.record.wins)}-${String(payload.record.losses)}-${String(payload.firstLossGameNumber ?? 0)}`;
    };
    expect(await run()).toBe(await run());
  });
});
