import { describe, expect, it } from 'vitest';
import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import {
  poolSortLabel,
  presentationForVariant,
  ratingBadges,
  sortDraftRows,
  variantLabel,
} from './draft-presentation';

function row(partial: Partial<PlayersIndexEntry> & { playerId: string }): PlayersIndexEntry {
  return {
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1990-91',
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '1',
    altIds: null,
    positionsCanonical: ['F'],
    overall: 70,
    offense: 70,
    defense: 70,
    selectionScore: 50,
    heightInches: 78,
    weightLbs: 200,
    stats: {
      gamesPlayed: 80,
      minutes: 2400,
      points: 1600,
      rebounds: 800,
      offensiveRebounds: null,
      defensiveRebounds: null,
      assists: 400,
      steals: 80,
      blocks: 40,
      turnovers: 200,
      fieldGoalsMade: 600,
      fieldGoalsAttempted: 1200,
      threesMade: 100,
      threesAttempted: 250,
      freeThrowsMade: 300,
      freeThrowsAttempted: 360,
      per: 20,
      boxPlusMinus: 2,
      usageRate: 25,
      tsPct: 0.6,
      efgPct: 0.54,
    },
    ...partial,
  };
}

describe('sortDraftRows', () => {
  it('sorts sandbox pools by overall descending, then display name', () => {
    const low = row({ playerId: 'low', displayName: 'Aaron Low', overall: 60 });
    const high = row({ playerId: 'high', displayName: 'Zed High', overall: 92 });
    const tieA = row({ playerId: 'tie-a', displayName: 'Anna Tie', overall: 80 });
    const tieB = row({ playerId: 'tie-b', displayName: 'Bob Tie', overall: 80 });
    const sorted = sortDraftRows([low, tieB, high, tieA], 'sandbox');
    expect(sorted.map((r) => r.playerId)).toEqual(['high', 'tie-a', 'tie-b', 'low']);
  });

  it('sorts ratings pools exactly like sandbox', () => {
    const low = row({ playerId: 'low', displayName: 'Aaron Low', overall: 60 });
    const high = row({ playerId: 'high', displayName: 'Zed High', overall: 92 });
    const sorted = sortDraftRows([low, high], 'ratings');
    expect(sorted.map((r) => r.playerId)).toEqual(['high', 'low']);
  });

  it('sorts ball-knowledge pools alphabetically by normalized display name', () => {
    const zed = row({ playerId: 'zed', displayName: 'Zed Zoster', overall: 99 });
    const aaron = row({ playerId: 'aaron', displayName: 'Aaron Aardvark', overall: 1 });
    const sorted = sortDraftRows([zed, aaron], 'ball-knowledge');
    expect(sorted.map((r) => r.playerId)).toEqual(['aaron', 'zed']);
  });

  it('ball-knowledge ties break by lastName, firstName, then playerId', () => {
    const same = { displayName: 'Magic Johnson', lastName: 'Johnson', firstName: 'Magic' } as const;
    const z = row({ playerId: 'z', ...same });
    const a = row({ playerId: 'a', ...same });
    const abbott = row({
      playerId: 'm',
      displayName: 'Magic Johnson',
      lastName: 'Abbott',
      firstName: 'Magic',
    });
    const sorted = sortDraftRows([z, a, abbott], 'ball-knowledge');
    expect(sorted.map((r) => r.playerId)).toEqual(['m', 'a', 'z']);
  });

  it('ball-knowledge never falls back to unstable array order for equal identities', () => {
    const x = row({ playerId: 'x', displayName: 'Dup Name' });
    const y = row({ playerId: 'y', displayName: 'Dup Name' });
    expect(sortDraftRows([y, x], 'ball-knowledge').map((r) => r.playerId)).toEqual(['x', 'y']);
    expect(sortDraftRows([x, y], 'ball-knowledge').map((r) => r.playerId)).toEqual(['x', 'y']);
  });

  it('ball-knowledge compares display names case-insensitively', () => {
    const zed = row({ playerId: 'zed', displayName: 'ZED' });
    const aaron = row({ playerId: 'aaron', displayName: 'aaron' });
    expect(sortDraftRows([zed, aaron], 'ball-knowledge').map((r) => r.playerId)).toEqual([
      'aaron',
      'zed',
    ]);
  });

  it('never mutates the input array', () => {
    const a = row({ playerId: 'a', displayName: 'Aaron A', overall: 80 });
    const b = row({ playerId: 'b', displayName: 'Zed Z', overall: 90 });
    const input = [a, b];
    sortDraftRows(input, 'sandbox');
    sortDraftRows(input, 'ball-knowledge');
    expect(input.map((r) => r.playerId)).toEqual(['a', 'b']);
  });
});

describe('ratingBadges', () => {
  const player = row({ playerId: 'x', overall: 92, offense: 90, defense: 88 });

  it('shows Overall, Offense, and Defense for sandbox', () => {
    expect(ratingBadges(player, 'sandbox')).toEqual([
      { label: 'O', value: 92 },
      { label: 'OFF', value: 90 },
      { label: 'DEF', value: 88 },
    ]);
  });

  it('shows Overall, Offense, and Defense for ratings', () => {
    expect(ratingBadges(player, 'ratings')).toEqual([
      { label: 'O', value: 92 },
      { label: 'OFF', value: 90 },
      { label: 'DEF', value: 88 },
    ]);
  });

  it('hides only Overall for ball-knowledge', () => {
    expect(ratingBadges(player, 'ball-knowledge')).toEqual([
      { label: 'OFF', value: 90 },
      { label: 'DEF', value: 88 },
    ]);
  });
});

describe('poolSortLabel', () => {
  it('describes the pool sort in the count line', () => {
    expect(poolSortLabel('sandbox')).toBe('sorted by OVER');
    expect(poolSortLabel('ratings')).toBe('sorted by OVER');
    expect(poolSortLabel('ball-knowledge')).toBe('sorted by NAME');
  });
});

describe('variantLabel', () => {
  it('names the Classic information variants', () => {
    expect(variantLabel('ratings')).toBe('Ratings');
    expect(variantLabel('ball-knowledge')).toBe('Ball Knowledge');
  });
});

describe('presentationForVariant', () => {
  it('maps each variant to its draft presentation', () => {
    expect(presentationForVariant('ratings')).toBe('ratings');
    expect(presentationForVariant('ball-knowledge')).toBe('ball-knowledge');
  });
});
