import { describe, expect, it } from 'vitest';
import { franchiseIdSchema, seasonGameIdSchema } from '@hoop-rush/data-contracts';
import { blockLiveFactsOf } from '../../workers/season-block-worker';

function summary(gameId: string, home: string, away: string, homeScore: number, awayScore: number) {
  const box = (franchiseId: string, points: number) => ({
    franchiseId: franchiseIdSchema.parse(franchiseId),
    points,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  });
  return {
    schemaVersion: 1 as const,
    summaryVersion: 'season-game-summary-v4' as const,
    gameId: seasonGameIdSchema.parse(gameId),
    round: 1,
    homeFranchiseId: franchiseIdSchema.parse(home),
    awayFranchiseId: franchiseIdSchema.parse(away),
    status: 'final' as const,
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox: box(home, homeScore),
    awayBox: box(away, awayScore),
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
  };
}

describe('season block worker pulse tie-break (wire v10)', () => {
  it('picks the earliest canonical game when margins tie', () => {
    const summaries = [
      summary('s000002', 'lakers', 'celtics', 110, 100),
      summary('s000001', 'bulls', 'knicks', 120, 110),
    ];
    const order = new Map([
      ['s000001', 0],
      ['s000002', 1],
    ]);
    const facts = blockLiveFactsOf(summaries, null, order);
    expect(facts.leaguePulse.blowout?.gameId).toBe('s000001');
    const reversed = blockLiveFactsOf([...summaries].reverse(), null, order);
    expect(reversed.leaguePulse.blowout?.gameId).toBe('s000001');
  });

  it('breaks highest-scoring ties by gameId after canonical order', () => {
    const summaries = [
      summary('s000002', 'lakers', 'celtics', 120, 110),
      summary('s000001', 'bulls', 'knicks', 115, 115 - 0 + 0),
    ];
    const a = summary('s000010', 'lakers', 'celtics', 120, 110);
    const b = summary('s000009', 'bulls', 'knicks', 125, 105);
    expect(a.homeScore + a.awayScore).toBe(b.homeScore + b.awayScore);
    const order = new Map([
      ['s000009', 0],
      ['s000010', 1],
    ]);
    const facts = blockLiveFactsOf([a, b], null, order);
    expect(facts.leaguePulse.highestScoring?.gameId).toBe('s000009');
    void summaries;
  });

  it('derives human record solely from completed summaries', () => {
    const summaries = [
      { ...summary('s000001', 'lakers', 'celtics', 112, 108), round: 1 },
      { ...summary('s000002', 'bulls', 'lakers', 110, 100), round: 2 },
      { ...summary('s000003', 'knicks', 'bulls', 100, 90), round: 3 },
    ];
    const order = new Map([
      ['s000001', 0],
      ['s000002', 1],
      ['s000003', 2],
    ]);
    const facts = blockLiveFactsOf(summaries, 'lakers', order);
    expect(facts.humanResults.map((r) => r.gameId)).toEqual(['s000001', 's000002']);
    expect(facts.humanRecord).toEqual({ wins: 1, losses: 1 });
    expect(facts.leaguePulse.closest?.gameId).toBe('s000001');
  });
});
