import { describe, expect, it } from 'vitest';
import {
  percentOf,
  playerRowsOf,
  teamBoxViewOf,
  teamComparisonOf,
  trueShootingOf,
  type PlayerBoxInput,
  type TeamBoxInput,
} from './collection-box-score';

function player(overrides: Partial<PlayerBoxInput> & { cardId: string }): PlayerBoxInput {
  return {
    seconds: 0,
    minutes: 0,
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    ...overrides,
  };
}

function box(overrides: Partial<TeamBoxInput['box']> = {}): TeamBoxInput['box'] {
  return {
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
    ...overrides,
  };
}

function viewOf(input: {
  score: number;
  players: PlayerBoxInput[];
  starterIds: string[];
  box?: Partial<TeamBoxInput['box']>;
}) {
  return teamBoxViewOf({
    starterIds: input.starterIds,
    result: { score: input.score, box: box(input.box), players: input.players },
  });
}

describe('collection box score presentation', () => {
  it('marks starters, orders by recorded seconds, and keeps deep fours optional', () => {
    const rows = playerRowsOf(
      [
        player({
          cardId: 'bench',
          seconds: 600,
          minutes: 10,
          points: 4,
          deepFours: { made: 0, attempted: 0 },
        }),
        player({ cardId: 'starter', seconds: 1800, minutes: 30, points: 12 }),
        player({ cardId: 'tie', seconds: 600, minutes: 10, points: 2 }),
      ],
      ['starter'],
    );
    expect(rows.map((row) => row.cardId)).toEqual(['starter', 'bench', 'tie']);
    expect(rows.find((row) => row.cardId === 'starter')?.starter).toBe(true);
    expect(rows.find((row) => row.cardId === 'bench')?.starter).toBe(false);
    expect(rows.find((row) => row.cardId === 'bench')?.deepFours).toEqual({
      made: 0,
      attempted: 0,
    });
    expect(rows.find((row) => row.cardId === 'tie')?.deepFours).toBeNull();
  });

  it('uses recorded team totals and splits starter and bench points', () => {
    const view = viewOf({
      score: 99,
      starterIds: ['a', 'b'],
      box: {
        points: 99,
        fieldGoals: { made: 40, attempted: 80 },
        rebounds: { total: 44, offensive: 9, defensive: 35, team: 2 },
        possessions: 96,
      },
      players: [
        player({ cardId: 'a', seconds: 1800, minutes: 30, points: 20 }),
        player({ cardId: 'b', seconds: 1700, minutes: 28, points: 14 }),
        player({ cardId: 'c', seconds: 900, minutes: 15, points: 7 }),
      ],
    });
    expect(view.totals.points).toBe(99);
    expect(view.totals.fieldGoals).toEqual({ made: 40, attempted: 80 });
    expect(view.totals.rebounds).toBe(44);
    expect(view.totals.offensiveRebounds).toBe(9);
    expect(view.totals.possessions).toBe(96);
    expect(view.startersPoints).toBe(34);
    expect(view.benchPoints).toBe(7);
  });

  it('builds shooting, discipline, and neutral comparison rows from recorded facts', () => {
    const home = viewOf({
      score: 100,
      starterIds: [],
      box: {
        points: 100,
        fieldGoals: { made: 38, attempted: 80 },
        threes: { made: 12, attempted: 30 },
        freeThrows: { made: 12, attempted: 15 },
        rebounds: { total: 40, offensive: 8, defensive: 32, team: 1 },
        assists: 24,
        steals: 7,
        blocks: 4,
        turnovers: 11,
        fouls: 18,
        possessions: 95,
      },
      players: [player({ cardId: 'a', seconds: 600, minutes: 10, points: 6 })],
    });
    const away = viewOf({
      score: 96,
      starterIds: [],
      box: {
        points: 96,
        fieldGoals: { made: 34, attempted: 78 },
        threes: { made: 8, attempted: 28 },
        freeThrows: { made: 20, attempted: 24 },
        rebounds: { total: 44, offensive: 11, defensive: 33, team: 2 },
        assists: 18,
        steals: 5,
        blocks: 3,
        turnovers: 15,
        fouls: 21,
        possessions: 97,
      },
      players: [player({ cardId: 'b', seconds: 600, minutes: 10, points: 12 })],
    });
    const rows = teamComparisonOf(home, away);
    const byKey = new Map(rows.map((row) => [row.key, row]));

    const fieldGoals = byKey.get('fg');
    expect(fieldGoals?.home).toEqual({ primary: '47.5%', detail: '38-80' });
    expect(fieldGoals?.away).toEqual({ primary: '43.6%', detail: '34-78' });
    expect(fieldGoals?.leader).toBe('home');

    const freeThrows = byKey.get('ft');
    expect(freeThrows?.leader).toBe('away');

    const turnovers = byKey.get('tov');
    expect(turnovers?.leader).toBe('home');
    expect(turnovers?.home.primary).toBe('11');
    expect(turnovers?.away.primary).toBe('15');

    const rebounds = byKey.get('reb');
    expect(rebounds?.home.detail).toBe('8 off · 32 def');
    expect(rebounds?.away.detail).toBe('11 off · 33 def');

    const possessions = byKey.get('poss');
    expect(possessions?.leader).toBe('neutral');

    const bench = byKey.get('bench');
    expect(bench?.home.primary).toBe('6');
    expect(bench?.away.primary).toBe('12');
    expect(bench?.leader).toBe('away');

    expect(rows.every((row) => row.homeShare >= 0 && row.homeShare <= 1)).toBe(true);
  });

  it('marks empty shooting splits as unrecorded and ties', () => {
    const home = viewOf({ score: 0, starterIds: [], players: [] });
    const away = viewOf({ score: 0, starterIds: [], players: [] });
    const rows = teamComparisonOf(home, away);
    const fieldGoals = rows.find((row) => row.key === 'fg');
    expect(fieldGoals?.home).toEqual({ primary: '—', detail: null });
    expect(fieldGoals?.leader).toBe('tie');
    expect(fieldGoals?.homeShare).toBe(0.5);
  });

  it('computes shooting helpers from recorded attempts', () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(3, 4)).toBeCloseTo(0.75);
    expect(trueShootingOf(20, 10, 5)).toBeCloseTo(20 / (2 * (10 + 2.2)));
    expect(trueShootingOf(0, 0, 0)).toBe(0);
  });
});
