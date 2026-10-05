import { describe, expect, it } from 'vitest';
import { jsonPayload, runCli } from './cli-test-helpers.ts';
const LINEUP =
  "Stephen Curry@warriors/2010s,Giannis Antetokounmpo@bucks/2010s,Larry Bird@celtics/1980s,Tim Duncan@spurs/2000s,Shaquille O'Neal@lakers/1990s";
const SEED = '0123456789abcdef';
interface Spread {
  mean: number;
  min: number;
  max: number;
  stddev: number;
}
interface AveragePayload {
  command: string;
  attempts: number;
  outcomes: { perfect: number; eliminated: number };
  record: { wins: Spread; losses: Spread; gamesPlayed: Spread };
  teamPossessions: Spread;
  playerAverages: Array<{
    playerId: string;
    gamesPlayed: Spread;
    points: Spread;
    rebounds: { total: Spread };
  }>;
  timingMs: number;
}
function challengeAverageArgs(): string[] {
  return [
    'sim',
    'challenge-average',
    '--lineup',
    LINEUP,
    '--seed',
    SEED,
    '--reruns',
    '2',
    '--format',
    'json',
  ];
}
describe('sim challenge-average', () => {
  it('averages every stat across attempts with spread and stays deterministic', async () => {
    const first = await runCli(challengeAverageArgs());
    expect(first.code).toBe(0);
    const payload = jsonPayload(first.stdout, first.stderr) as AveragePayload;
    expect(payload.command).toBe('sim challenge-average');
    expect(payload.attempts).toBe(2);
    expect(payload.outcomes.perfect + payload.outcomes.eliminated).toBe(2);
    expect(payload.record.gamesPlayed.mean).toBe(82);
    expect(payload.playerAverages).toHaveLength(5);
    expect(payload.teamPossessions.mean).toBeGreaterThan(0);
    for (const player of payload.playerAverages) {
      expect(player.points.mean).toBeGreaterThanOrEqual(player.points.min);
      expect(player.points.mean).toBeLessThanOrEqual(player.points.max);
      expect(player.points.stddev).toBeGreaterThanOrEqual(0);
      expect(player.rebounds.total.mean).toBeGreaterThanOrEqual(0);
    }
    const second = await runCli(challengeAverageArgs());
    expect(second.code).toBe(0);
    const repeat = jsonPayload(second.stdout, second.stderr) as AveragePayload;
    expect({ ...repeat, timingMs: 0 }).toEqual({ ...payload, timingMs: 0 });
  });
  it('rejects a missing lineup', async () => {
    const { code, stderr } = await runCli([
      'sim',
      'challenge-average',
      '--seed',
      SEED,
      '--format',
      'json',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('--lineup');
  });
});
