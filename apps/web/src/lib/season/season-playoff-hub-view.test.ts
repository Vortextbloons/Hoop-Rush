import { describe, expect, it } from 'vitest';
import {
  playoffPrepSummaryOf,
  playoffSnapshotOf,
} from './season-playoff-hub-view';

function agg(franchiseId: string, overrides: Record<string, number> = {}) {
  return {
    franchiseId: franchiseId as never,
    gamesPlayed: 82,
    wins: 41,
    losses: 41,
    points: 82 * 112,
    fieldGoalsMade: 3000,
    fieldGoalsAttempted: 6500,
    threePointersMade: 900,
    threePointersAttempted: 2500,
    freeThrowsMade: 1400,
    freeThrowsAttempted: 1800,
    offensiveRebounds: 800,
    defensiveRebounds: 2600,
    assists: 2000,
    steals: 600,
    blocks: 400,
    turnovers: 1100,
    fouls: 1500,
    possessions: 8200,
    ...overrides,
  } as never;
}

describe('playoffSnapshotOf', () => {
  it('compares two teams on recorded aggregates only', () => {
    const series = {
      homeFranchiseId: 'dal',
      awayFranchiseId: 'nop',
      homeSeed: 3,
      awaySeed: 6,
    } as never;
    const snapshot = playoffSnapshotOf({
      series,
      summaries: [],
      aggregates: [
        agg('dal', { points: 82 * 114, offensiveRebounds: 950 }),
        agg('nop', { points: 82 * 109, offensiveRebounds: 700 }),
      ],
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rows.map((r) => r.key)).toEqual(['ppg', 'ts', '3p', 'reb', 'oreb']);
    expect(snapshot?.rows[0]?.homeDisplay).toBe('114.0');
    expect(snapshot?.rows[0]?.leader).toBe('home');
    expect(snapshot?.seasonSeries.label).toBe('Did not meet in the regular season');
    expect(snapshot?.homeForm).toBe('No games yet');
  });

  it('returns null without both teams', () => {
    expect(
      playoffSnapshotOf({ series: { homeFranchiseId: null, awayFranchiseId: 'nop' } as never, summaries: [] }),
    ).toBeNull();
  });
});

describe('playoffPrepSummaryOf', () => {
  it('summarizes minutes, closers, and starters', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `pv-${String(i)}`);
    const rotation = {
      franchiseId: 'nop',
      starters: ids.slice(0, 5),
      benchOrder: ids.slice(5),
      targetMinutes: ids.map((id, i) => ({ playerVersionId: id, minutes: i < 8 ? 26 : 16 })),
      closingFive: ids.slice(0, 5),
    } as never;
    const prep = playoffPrepSummaryOf({
      rotation,
      failures: [],
      nameOf: (id) => `Player ${id}`,
    });
    expect(prep.minutesTotal).toBe(240);
    expect(prep.minutesOk).toBe(true);
    expect(prep.closersOk).toBe(true);
    expect(prep.invalid).toBe(false);
    expect(prep.rotationLabel).toBe('240/240 min · 5/5 closers');
  });
});
