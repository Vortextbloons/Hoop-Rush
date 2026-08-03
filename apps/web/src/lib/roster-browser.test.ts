import { describe, expect, it } from 'vitest';
import {
  defaultDirection,
  filterRoster,
  formatPct,
  formatPerGame,
  groupRoster,
  lowercaseName,
  paginateGroupedRows,
  paginateItems,
  perGame,
  shotPct,
  sortRoster,
  type RosterDetailRow,
  type RosterListItem,
} from './roster-browser';

function row(partial: Partial<RosterDetailRow> & { playerId: string }): RosterDetailRow {
  return {
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1990-91',
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '1',
    altIds: null,
    positionsPlayable: ['SF'],
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

describe('sortRoster', () => {
  const a = row({
    playerId: 'a',
    lastName: 'Adams',
    overall: 70,
    eraId: '1990s',
    franchiseId: 'bulls',
    seasonKey: '1995-96',
    positionsPlayable: ['PG'],
    stats: { ...row({ playerId: 'x' }).stats, points: 1600, per: 20 },
  });
  const b = row({
    playerId: 'b',
    lastName: 'Baker',
    overall: 90,
    eraId: '2000s',
    franchiseId: 'lakers',
    seasonKey: '2000-01',
    positionsPlayable: ['SF'],
    stats: { ...row({ playerId: 'x' }).stats, points: 2000, per: 28 },
  });
  const c = row({
    playerId: 'c',
    lastName: 'Clark',
    overall: 60,
    eraId: '1980s',
    franchiseId: 'celtics',
    seasonKey: '1985-86',
    positionsPlayable: ['C'],
    stats: { ...row({ playerId: 'x' }).stats, points: 1200, per: 15 },
  });

  it('keeps dataset order for none', () => {
    const rows = [c, a, b];
    expect(sortRoster(rows, 'none', 'asc').map((r) => r.playerId)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by name ascending', () => {
    const sorted = sortRoster([c, b, a], 'name', 'asc');
    expect(sorted.map((r) => r.lastName)).toEqual(['Adams', 'Baker', 'Clark']);
  });

  it('sorts by overall rating', () => {
    const sorted = sortRoster([a, b, c], 'overall', 'desc');
    expect(sorted.map((r) => r.playerId)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by points per game descending', () => {
    const sorted = sortRoster([c, a, b], 'points', 'desc');
    expect(sorted.map((r) => r.playerId)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by PER descending', () => {
    const sorted = sortRoster([a, c, b], 'per', 'desc');
    expect(sorted.map((r) => r.playerId)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by season descending', () => {
    const sorted = sortRoster([a, c, b], 'season', 'desc');
    expect(sorted.map((r) => r.seasonKey)).toEqual(['2000-01', '1995-96', '1985-86']);
  });

  it('sorts by team and decade alphabetically', () => {
    const byTeam = sortRoster([a, b, c], 'team', 'asc');
    expect(byTeam.map((r) => r.franchiseId)).toEqual(['bulls', 'celtics', 'lakers']);
    const byDecade = sortRoster([b, a, c], 'decade', 'asc');
    expect(byDecade.map((r) => r.eraId)).toEqual(['1980s', '1990s', '2000s']);
  });

  it('sorts by position PG, SF, C', () => {
    const sorted = sortRoster([c, b, a], 'position', 'asc');
    expect(sorted.map((r) => r.playerId)).toEqual(['a', 'b', 'c']);
  });

  it('ties break by name for determinism', () => {
    const x = row({ playerId: 'x', lastName: 'Adams', firstName: 'Aaron', overall: 90 });
    const y = row({ playerId: 'y', lastName: 'Adams', firstName: 'Zed', overall: 90 });
    const sorted = sortRoster([y, x], 'overall', 'desc');
    expect(sorted.map((r) => r.playerId)).toEqual(['x', 'y']);
  });
});

describe('filterRoster', () => {
  const lakers90 = row({
    playerId: 'a',
    franchiseId: 'lakers',
    eraId: '1990s',
    positionsPlayable: ['PG'],
    displayName: 'Magic Johnson',
  });
  const bulls90 = row({
    playerId: 'b',
    franchiseId: 'bulls',
    eraId: '1990s',
    positionsPlayable: ['SF'],
    displayName: 'Scottie Pippen',
  });
  const lakers00 = row({
    playerId: 'c',
    franchiseId: 'lakers',
    eraId: '2000s',
    positionsPlayable: ['C'],
    displayName: "Shaquille O'Neal",
  });

  it('applies franchise, decade, position, and query filters together', () => {
    expect(
      filterRoster([lakers90, bulls90, lakers00], {
        franchiseId: 'lakers',
        eraId: null,
        position: null,
        query: '',
      }).map((r) => r.playerId),
    ).toEqual(['a', 'c']);
    expect(
      filterRoster([lakers90, bulls90, lakers00], {
        franchiseId: null,
        eraId: '1990s',
        position: 'SF',
        query: '',
      }).map((r) => r.playerId),
    ).toEqual(['b']);
    expect(
      filterRoster([lakers90, bulls90, lakers00], {
        franchiseId: null,
        eraId: null,
        position: null,
        query: 'shaq',
      }).map((r) => r.playerId),
    ).toEqual(['c']);
    expect(
      filterRoster([lakers90, bulls90, lakers00], {
        franchiseId: null,
        eraId: null,
        position: null,
        query: '',
      }).length,
    ).toBe(3);
  });
});

describe('lowercaseName', () => {
  it('case-folds the display name and memoizes per row object', () => {
    const player = row({
      playerId: 'a',
      displayName: "Shaquille O'Neal",
    });
    expect(lowercaseName(player)).toBe("shaquille o'neal");
    expect(lowercaseName(player)).toBe("shaquille o'neal");
    expect(lowercaseName(row({ playerId: 'b', displayName: 'MAGIC' }))).toBe('magic');
  });
});

describe('groupRoster', () => {
  it('groups by franchise then era in dataset order', () => {
    const lakers90a = row({ playerId: 'a', franchiseId: 'lakers', eraId: '1990s' });
    const lakers90b = row({ playerId: 'b', franchiseId: 'lakers', eraId: '1990s' });
    const lakers00 = row({ playerId: 'c', franchiseId: 'lakers', eraId: '2000s' });
    const bulls90 = row({ playerId: 'd', franchiseId: 'bulls', eraId: '1990s' });

    const groups = groupRoster([bulls90, lakers90a, lakers90b, lakers00]);
    expect(groups.map((g) => `${g.franchiseId}/${g.eraId}`)).toEqual([
      'bulls/1990s',
      'lakers/1990s',
      'lakers/2000s',
    ]);
    expect(groups[1]?.players.map((p) => p.playerId)).toEqual(['a', 'b']);
  });
});

describe('paginateItems', () => {
  it('keeps group headers leading into the page and counts only players', () => {
    const a = row({ playerId: 'a' });
    const b = row({ playerId: 'b' });
    const c = row({ playerId: 'c' });
    const items: (
      | { type: 'group'; franchiseId: string; eraId: string; count: number }
      | { type: 'player'; player: RosterDetailRow }
    )[] = [
      { type: 'group', franchiseId: 'x', eraId: '1990s', count: 1 },
      { type: 'player', player: a },
      { type: 'group', franchiseId: 'y', eraId: '1990s', count: 2 },
      { type: 'player', player: b },
      { type: 'player', player: c },
    ];
    const page = paginateItems(items, 2);
    expect(page.map((item) => (item.type === 'player' ? item.player.playerId : item.type))).toEqual(
      ['group', 'a', 'group', 'b'],
    );
  });
});

describe('paginateGroupedRows', () => {
  // Contiguous by franchise/era, like the packaged players index.
  const rows = [
    row({ playerId: 'a', franchiseId: 'lakers', eraId: '1990s' }),
    row({ playerId: 'b', franchiseId: 'lakers', eraId: '1990s' }),
    row({ playerId: 'c', franchiseId: 'bulls', eraId: '1990s' }),
    row({ playerId: 'd', franchiseId: 'bulls', eraId: '1990s' }),
    row({ playerId: 'e', franchiseId: 'bulls', eraId: '1990s' }),
    row({ playerId: 'f', franchiseId: 'lakers', eraId: '2000s' }),
    row({ playerId: 'g', franchiseId: 'celtics', eraId: '2000s' }),
    row({ playerId: 'h', franchiseId: 'celtics', eraId: '2000s' }),
  ];

  function reference(rows: RosterDetailRow[], count: number): RosterListItem[] {
    return paginateItems(
      groupRoster(rows).flatMap((group): RosterListItem[] => [
        {
          type: 'group',
          franchiseId: group.franchiseId,
          eraId: group.eraId,
          count: group.players.length,
        },
        ...group.players.map((player): RosterListItem => ({ type: 'player', player })),
      ]),
      count,
    );
  }

  it('is output-identical to groupRoster + flatMap + paginateItems at every cut point', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100]) {
      expect(paginateGroupedRows(rows, n)).toEqual(reference(rows, n));
    }
  });

  it('stops at exactly count player items', () => {
    const page = paginateGroupedRows(rows, 5);
    const players = page.filter((item) => item.type === 'player');
    expect(players).toHaveLength(5);
    expect(page.map((item) => (item.type === 'player' ? item.player.playerId : item.type))).toEqual(
      ['group', 'a', 'b', 'group', 'c', 'd', 'e'],
    );
    const exhausted = paginateGroupedRows(rows, 100);
    expect(exhausted.filter((item) => item.type === 'player')).toHaveLength(rows.length);
  });

  it('keeps the group header of the boundary group with its full count', () => {
    const page = paginateGroupedRows(rows, 3);
    expect(page).toEqual([
      { type: 'group', franchiseId: 'lakers', eraId: '1990s', count: 2 },
      { type: 'player', player: rows[0] },
      { type: 'player', player: rows[1] },
      { type: 'group', franchiseId: 'bulls', eraId: '1990s', count: 3 },
      { type: 'player', player: rows[2] },
    ]);
  });
});

describe('stat helpers', () => {
  it('computes per-game values and guards zero games', () => {
    expect(perGame(row({ playerId: 'a' }).stats, 'points')).toBe(20);
    expect(
      perGame(
        row({ playerId: 'a', stats: { ...row({ playerId: 'x' }).stats, gamesPlayed: 0 } }).stats,
        'points',
      ),
    ).toBe(0);
  });

  it('computes shot percentages and guards zero attempts', () => {
    expect(shotPct(600, 1200)).toBe(0.5);
    expect(shotPct(0, 0)).toBe(0);
  });

  it('formats percentages and per-game values', () => {
    expect(formatPct(0.5)).toBe('50.0%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPerGame(20.55)).toBe('20.6');
  });
});

describe('defaultDirection', () => {
  it('defaults rating/stat/season sorts to descending and the rest ascending', () => {
    expect(defaultDirection('overall')).toBe('desc');
    expect(defaultDirection('points')).toBe('desc');
    expect(defaultDirection('per')).toBe('desc');
    expect(defaultDirection('season')).toBe('desc');
    expect(defaultDirection('none')).toBe('asc');
    expect(defaultDirection('name')).toBe('asc');
    expect(defaultDirection('team')).toBe('asc');
  });
});
