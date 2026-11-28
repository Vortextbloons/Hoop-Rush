import { describe, expect, it } from 'bun:test';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import {
  evaluateIndividualGameAchievements,
  evaluateIndividualSeasonAchievements,
  individualGameLineFromBoxScore,
  type IndividualGamePlayerLine,
  type IndividualSeasonPlayerFacts,
} from './individual.ts';

function line(overrides: Partial<IndividualGamePlayerLine> = {}): IndividualGamePlayerLine {
  return {
    playerId: 'p-1',
    displayName: 'Test Player',
    points: 0,
    rebounds: { total: 0, offensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    ...overrides,
  };
}

function ids(unlocks: readonly { id: string }[]): string[] {
  return unlocks.map((unlock) => unlock.id);
}

function game(unlockLine: IndividualGamePlayerLine, mode: 'classic' | 'havoc' = 'classic') {
  return evaluateIndividualGameAchievements({ mode, players: [unlockLine] });
}

describe('individual game achievements', () => {
  it('awards a quadruple-double', () => {
    expect(
      ids(
        game(
          line({
            points: 12,
            rebounds: { total: 11, offensive: 2 },
            assists: 10,
            blocks: 10,
          }),
        ),
      ),
    ).toContain('the-hakeem-special');
  });

  it('does not award a quadruple-double for three double-digit stats', () => {
    expect(
      ids(
        game(
          line({
            points: 12,
            rebounds: { total: 11, offensive: 2 },
            assists: 10,
          }),
        ),
      ),
    ).not.toContain('the-hakeem-special');
  });

  it('awards the AK-47 for five in every category', () => {
    const unlockLine = line({
      points: 5,
      rebounds: { total: 5, offensive: 1 },
      assists: 5,
      steals: 5,
      blocks: 5,
    });
    expect(ids(game(unlockLine))).toContain('the-ak-47');
    expect(ids(game(line({ ...unlockLine, blocks: 4 })))).not.toContain('the-ak-47');
  });

  it('awards 30 rebounds', () => {
    expect(ids(game(line({ rebounds: { total: 30, offensive: 4 } })))).toContain(
      'board-man-gets-paid',
    );
    expect(ids(game(line({ rebounds: { total: 29, offensive: 4 } })))).not.toContain(
      'board-man-gets-paid',
    );
  });

  it('awards the Klay line only within one assist and one turnover', () => {
    const qualifying = line({ points: 40, assists: 1, turnovers: 1 });
    expect(ids(game(qualifying))).toContain('the-klay-thompson-experience');
    expect(ids(game({ ...qualifying, assists: 2 }))).not.toContain('the-klay-thompson-experience');
    expect(ids(game({ ...qualifying, turnovers: 2 }))).not.toContain(
      'the-klay-thompson-experience',
    );
  });

  it('awards the zero-turnover scoring and passing lines', () => {
    expect(ids(game(line({ points: 50 })))).toContain('agent-zero');
    expect(ids(game(line({ points: 50, turnovers: 1 })))).not.toContain('agent-zero');
    expect(ids(game(line({ assists: 20 })))).toContain('the-point-god');
    expect(ids(game(line({ assists: 20, turnovers: 1 })))).not.toContain('the-point-god');
  });

  it('awards 10 steals', () => {
    expect(ids(game(line({ steals: 10 })))).toContain('the-glove');
    expect(ids(game(line({ steals: 9 })))).not.toContain('the-glove');
  });

  it('awards 10 made rim shots when rim data exists', () => {
    expect(ids(game(line({ rim: { made: 10, attempted: 12 } })))).toContain(
      'the-human-highlight-film',
    );
    expect(ids(game(line({ rim: { made: 9, attempted: 12 } })))).not.toContain(
      'the-human-highlight-film',
    );
    expect(ids(game(line()))).not.toContain('the-human-highlight-film');
  });

  it('awards 12 threes', () => {
    expect(ids(game(line({ threes: { made: 12, attempted: 20 } })))).toContain('logo-lillard');
    expect(ids(game(line({ threes: { made: 11, attempted: 20 } })))).not.toContain('logo-lillard');
  });

  it('awards 20 rebounds without points', () => {
    expect(ids(game(line({ rebounds: { total: 20, offensive: 3 } })))).toContain(
      'the-rodman-paradox',
    );
    expect(ids(game(line({ points: 1, rebounds: { total: 20, offensive: 3 } })))).not.toContain(
      'the-rodman-paradox',
    );
  });

  it('awards a perfect shooting triple-double with at least eight attempts', () => {
    const perfect = line({
      points: 20,
      rebounds: { total: 10, offensive: 2 },
      assists: 10,
      fieldGoals: { made: 8, attempted: 8 },
    });
    expect(ids(game(perfect))).toContain('the-jokers-masterpiece');
    expect(ids(game({ ...perfect, fieldGoals: { made: 7, attempted: 8 } }))).not.toContain(
      'the-jokers-masterpiece',
    );
    expect(ids(game({ ...perfect, fieldGoals: { made: 7, attempted: 7 } }))).not.toContain(
      'the-jokers-masterpiece',
    );
  });

  it('awards 15 offensive rebounds', () => {
    expect(ids(game(line({ rebounds: { total: 18, offensive: 15 } })))).toContain(
      'the-moses-malone-special',
    );
    expect(ids(game(line({ rebounds: { total: 18, offensive: 14 } })))).not.toContain(
      'the-moses-malone-special',
    );
  });

  it('awards the 81 and 100 point games', () => {
    expect(ids(game(line({ points: 81 })))).toContain('kobes-revenge');
    expect(ids(game(line({ points: 81 })))).not.toContain('wilt-was-here');
    expect(ids(game(line({ points: 100 })))).toEqual(
      expect.arrayContaining(['kobes-revenge', 'wilt-was-here']),
    );
  });

  it('does not award individual lines in Havoc', () => {
    expect(
      ids(
        game(
          line({
            points: 100,
            rebounds: { total: 30, offensive: 15 },
            assists: 20,
            steals: 10,
            blocks: 10,
            threes: { made: 12, attempted: 20 },
            rim: { made: 10, attempted: 12 },
          }),
          'havoc',
        ),
      ),
    ).toEqual([]);
  });
});

describe('individual season achievements', () => {
  function seasonPlayer(
    overrides: Partial<IndividualSeasonPlayerFacts> = {},
  ): IndividualSeasonPlayerFacts {
    return {
      playerId: 'p-1',
      displayName: 'Test Player',
      gamesPlayed: 82,
      points: 18 * 82,
      rebounds: 11 * 82,
      assists: 4 * 82,
      fieldGoals: { made: 500, attempted: 9 * 82 },
      ...overrides,
    };
  }

  it('awards a low-volume double-double season', () => {
    expect(
      ids(evaluateIndividualSeasonAchievements({ mode: 'classic', players: [seasonPlayer()] })),
    ).toEqual(['the-quiet-superstar']);
  });

  it('rejects ten or more field goal attempts per game', () => {
    expect(
      ids(
        evaluateIndividualSeasonAchievements({
          mode: 'classic',
          players: [seasonPlayer({ fieldGoals: { made: 500, attempted: 10 * 82 } })],
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a season without two double-digit averages', () => {
    expect(
      ids(
        evaluateIndividualSeasonAchievements({
          mode: 'classic',
          players: [seasonPlayer({ rebounds: 9 * 82 })],
        }),
      ),
    ).toEqual([]);
  });

  it('ignores ineligible modes', () => {
    expect(
      ids(
        evaluateIndividualSeasonAchievements({
          mode: 'cap-rush',
          players: [seasonPlayer()],
        }),
      ),
    ).toEqual([]);
  });
});

describe('individualGameLineFromBoxScore', () => {
  it('maps player boxes and the rim zone', () => {
    const mapped = individualGameLineFromBoxScore(
      {
        playerId: playerIdSchema.parse('p-9'),
        minutes: 36,
        points: 22,
        fieldGoals: { made: 9, attempted: 14 },
        threes: { made: 2, attempted: 5 },
        freeThrows: { made: 2, attempted: 2 },
        rebounds: { total: 8, offensive: 3, defensive: 5 },
        assists: 6,
        steals: 2,
        blocks: 1,
        turnovers: 3,
        fouls: 2,
        diagnostics: {
          usage: 25,
          shotZones: [
            { zone: 'rim', attempts: 9, makes: 7 },
            { zone: 'shortMid', attempts: 2, makes: 1 },
            { zone: 'longMid', attempts: 1, makes: 0 },
            { zone: 'cornerThree', attempts: 2, makes: 1 },
            { zone: 'aboveBreakThree', attempts: 3, makes: 1 },
          ],
          assistOpportunities: 8,
          offensiveReboundChances: 4,
          defensiveReboundChances: 7,
          contestedShots: 5,
        },
      },
      'Nine',
    );
    expect(mapped.displayName).toBe('Nine');
    expect(mapped.rebounds).toMatchObject({ total: 8, offensive: 3 });
    expect(mapped.rim).toEqual({ made: 7, attempted: 9 });
  });
});
