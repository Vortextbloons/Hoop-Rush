import { describe, expect, it } from 'vitest';
import { simBatch } from './commands/sim.ts';
import { simBatchReportSchema } from './report-schemas.ts';
import { jsonPayload, runCli } from './cli-test-helpers.ts';

describe('cli: sim batch worker independence', () => {
  it('produces identical aggregates with 1 and 4 workers', async () => {
    const runWith = async (workers: string) => {
      const report = await simBatch({
        fixture: 'equal',
        'seed-from': '0',
        'seed-to': '99',
        workers,
      });
      expect(report.exitCode).toBe(0);
      return simBatchReportSchema.parse(report.payload);
    };
    const single = await runWith('1');
    const many = await runWith('4');
    expect(many.games).toBe(100);
    expect(single.homeWins).toBe(many.homeWins);
    expect(single.awayWins).toBe(many.awayWins);
    expect(single.invariantFailures).toBe(0);
    expect(single.homeWinRate).toBe(many.homeWinRate);
    expect(single.averagePoints).toBe(many.averagePoints);
  });

  it('seed assignment depends only on the requested range', async () => {
    const run = async (from: string, to: string) => {
      const report = await simBatch({ fixture: 'equal', 'seed-from': from, 'seed-to': to });
      expect(report.exitCode).toBe(0);
      return simBatchReportSchema.parse(report.payload);
    };
    const full = await run('0', '49');
    const firstHalf = await run('0', '24');
    const secondHalf = await run('25', '49');
    expect(firstHalf.homeWins + secondHalf.homeWins).toBe(full.homeWins);
    expect(firstHalf.awayWins + secondHalf.awayWins).toBe(full.awayWins);
  });

  it('forwards --workers through the real CLI plumbing', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'batch',
      '--fixture',
      'equal',
      '--seed-from',
      '0',
      '--seed-to',
      '24',
      '--workers',
      '4',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simBatchReportSchema.parse(jsonPayload(stdout));
    expect(payload.workers).toBe(4);
    expect(payload.games).toBe(25);
    expect(payload.homeWins + payload.awayWins).toBe(25);
  });
});
