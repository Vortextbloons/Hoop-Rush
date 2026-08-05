import { describe, expect, it } from 'vitest';
import { simBatchReportSchema } from './report-schemas.ts';
import { jsonPayload, runCli } from './cli-test-helpers.ts';

describe('cli: sim batch worker independence', () => {
  it('produces identical aggregates with 1 and 4 workers', async () => {
    const runWith = async (workers: string) => {
      const { code, stdout } = await runCli([
        'sim',
        'batch',
        '--fixture',
        'equal',
        '--seed-from',
        '0',
        '--seed-to',
        '99',
        '--workers',
        workers,
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      return simBatchReportSchema.parse(jsonPayload(stdout));
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
    const full = await (async () => {
      const { code, stdout } = await runCli([
        'sim',
        'batch',
        '--fixture',
        'equal',
        '--seed-from',
        '0',
        '--seed-to',
        '49',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      return simBatchReportSchema.parse(jsonPayload(stdout));
    })();
    const halves = [];
    for (const [from, to] of [
      [0, 24],
      [25, 49],
    ] as const) {
      const { code, stdout } = await runCli([
        'sim',
        'batch',
        '--fixture',
        'equal',
        '--seed-from',
        String(from),
        '--seed-to',
        String(to),
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      halves.push(simBatchReportSchema.parse(jsonPayload(stdout)));
    }
    const firstHalf = halves[0];
    const secondHalf = halves[1];
    if (!firstHalf || !secondHalf) throw new Error('batch halves missing');
    expect(firstHalf.homeWins + secondHalf.homeWins).toBe(full.homeWins);
    expect(firstHalf.awayWins + secondHalf.awayWins).toBe(full.awayWins);
  });
});
