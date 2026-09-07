import { describe, expect, it } from 'vitest';
import {
  franchiseIdSchema,
  type SeasonGameSummary,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { leaguePulseOf } from './season-presentation';

function row(franchiseId: string, wins: number, losses: number) {
  return {
    franchiseId: franchiseIdSchema.parse(franchiseId),
    wins,
    losses,
    pointsFor: wins * 100,
    pointsAgainst: losses * 100,
  };
}
function run(): SeasonRun {
  return {
    runId: 'pulse-run',
    rootSeed: '0'.repeat(32),
    league: {
      teams: [
        { franchiseId: franchiseIdSchema.parse('lakers'), control: 'human' },
        { franchiseId: franchiseIdSchema.parse('celtics'), control: 'ai' },
        { franchiseId: franchiseIdSchema.parse('bulls'), control: 'ai' },
      ],
    },
    standings: { rows: [row('lakers', 5, 5), row('celtics', 9, 1), row('bulls', 2, 8)] },
    aiAssignments: [
      {
        franchiseId: franchiseIdSchema.parse('celtics'),
        band: 'contender',
        identity: 'star-chaser',
      },
      { franchiseId: franchiseIdSchema.parse('bulls'), band: 'weaker', identity: 'continuity' },
      { franchiseId: franchiseIdSchema.parse('lakers'), band: 'average', identity: 'continuity' },
    ],
    transactions: [
      {
        transactionId: 'txn-pulse-trade-00000001',
        commandId: null,
        franchiseId: franchiseIdSchema.parse('celtics'),
        type: 'trade',
        blockIndex: 2,
        appliedAtStateRevision: 3,
        payload: {},
        explanation: 'Celtics accepted a 1-for-1 swap',
      },
    ],
    evolution: { selections: {} },
  } as unknown as SeasonRun;
}
function finalGame(
  gameId: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  round = 1,
): SeasonGameSummary {
  return {
    gameId,
    round,
    status: 'final',
    homeFranchiseId: franchiseIdSchema.parse(home),
    awayFranchiseId: franchiseIdSchema.parse(away),
    homeScore,
    awayScore,
  } as unknown as SeasonGameSummary;
}

describe('leaguePulseOf', () => {
  it('surfaces threats before ledger noise and caps entries', () => {
    const summaries = [
      finalGame('g1', 'celtics', 'bulls', 110, 100, 1),
      finalGame('g2', 'celtics', 'lakers', 112, 100, 2),
      finalGame('g3', 'celtics', 'bulls', 108, 102, 3),
    ];
    const entries = leaguePulseOf(run(), summaries, (id) => id, 6);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(6);
    expect(entries[0]?.kind).toBe('threat');
    expect(entries[0]?.headline).toContain('celtics');
    expect(entries.some((entry) => entry.kind === 'streak')).toBe(true);
    expect(entries.some((entry) => entry.kind === 'trade')).toBe(true);
    for (const entry of entries) {
      expect(entry.headline.length).toBeGreaterThan(0);
      expect(entry.detail.length).toBeGreaterThan(0);
    }
  });
  it('returns empty for null run', () => {
    expect(leaguePulseOf(null, [], (id) => id)).toEqual([]);
  });
});
