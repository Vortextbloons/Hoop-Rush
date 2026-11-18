import { describe, expect, it } from 'bun:test';
import type { HavocComparison, HavocGameResult } from '@hoop-rush/data-contracts';
import { buildHavocGameResult } from '@hoop-rush/test-fixtures';
import type { HavocStoredGame } from '../modes/havoc/api.ts';
import {
  evaluateHavocAchievements,
  havocAchievementFactsFromRun,
  type HavocAchievementFacts,
  type HavocComparisonFacts,
  type HavocGameFacts,
  type HavocParticipantFacts,
  type HavocRunSource,
} from './havoc.ts';

function makeParticipant(
  kind: HavocParticipantFacts['kind'],
  points: number,
  index: number,
): HavocParticipantFacts {
  return {
    instanceId: `i-${String(index)}`,
    kind,
    displayName: `${kind}-${String(index)}`,
    points,
  };
}

function starters(points: readonly number[]): HavocParticipantFacts[] {
  return points.map((value, index) => makeParticipant('starter', value, index));
}

function makeGame(overrides: Partial<HavocGameFacts> = {}): HavocGameFacts {
  return {
    gameNumber: 1,
    humanPoints: 100,
    participants: starters([20, 18, 16, 14, 12]),
    bodySnatcher: null,
    ...overrides,
  };
}

function comparison(overrides: Partial<HavocComparisonFacts> = {}): HavocComparisonFacts {
  return {
    matchedGames: 82,
    havocWins: 50,
    normalWins: 40,
    winsGained: 10,
    havocWinsNormalLosses: 0,
    ...overrides,
  };
}

function baseFacts(overrides: Partial<HavocAchievementFacts> = {}): HavocAchievementFacts {
  return {
    seasonGames: 0,
    wins: 0,
    losses: 0,
    games: [],
    mutationIds: [],
    comparison: null,
    ...overrides,
  };
}

function ids(unlocks: readonly { id: string }[]): string[] {
  return unlocks.map((unlock) => unlock.id);
}

describe('The Curry Effect', () => {
  it('requires 25+ matched games where Havoc wins and Normal loses', () => {
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({ comparison: comparison({ havocWinsNormalLosses: 25 }) }),
        ),
      ),
    ).toContain('the-curry-effect');
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({ comparison: comparison({ havocWinsNormalLosses: 24 }) }),
        ),
      ),
    ).not.toContain('the-curry-effect');
    expect(ids(evaluateHavocAchievements(baseFacts()))).not.toContain('the-curry-effect');
  });
});

describe('The Dynasty Effect', () => {
  it('requires Havoc to win at least 40 more games than Normal', () => {
    expect(
      ids(evaluateHavocAchievements(baseFacts({ comparison: comparison({ winsGained: 40 }) }))),
    ).toContain('the-dynasty-effect');
    expect(
      ids(evaluateHavocAchievements(baseFacts({ comparison: comparison({ winsGained: 39 }) }))),
    ).not.toContain('the-dynasty-effect');
  });
});

describe('All-Star Game Numbers', () => {
  it('requires 200+ human team points in a Havoc game', () => {
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({ games: [makeGame({ humanPoints: 200, gameNumber: 7 })] }),
        ),
      ),
    ).toContain('all-star-game-numbers');
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({ games: [makeGame({ humanPoints: 199, gameNumber: 7 })] }),
        ),
      ),
    ).not.toContain('all-star-game-numbers');
  });
});

describe('Wilt Chamberlain Mode', () => {
  it('requires one human player with 100+ points in a Havoc game', () => {
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            games: [makeGame({ gameNumber: 3, participants: starters([100, 20, 20, 20, 20]) })],
          }),
        ),
      ),
    ).toContain('wilt-chamberlain-mode');
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            games: [makeGame({ gameNumber: 3, participants: starters([99, 20, 20, 20, 20]) })],
          }),
        ),
      ),
    ).not.toContain('wilt-chamberlain-mode');
  });
});

describe('Better Without the Boost', () => {
  it('requires Normal to win more games than Havoc', () => {
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            comparison: comparison({ havocWins: 40, normalWins: 41, winsGained: -1 }),
          }),
        ),
      ),
    ).toContain('better-without-the-boost');
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            comparison: comparison({ havocWins: 40, normalWins: 40, winsGained: 0 }),
          }),
        ),
      ),
    ).not.toContain('better-without-the-boost');
  });
});

describe('The Monstars', () => {
  it('requires a full 82-0 Havoc season', () => {
    expect(
      ids(evaluateHavocAchievements(baseFacts({ seasonGames: 82, wins: 82, losses: 0 }))),
    ).toContain('the-monstars');
    expect(
      ids(evaluateHavocAchievements(baseFacts({ seasonGames: 81, wins: 81, losses: 0 }))),
    ).not.toContain('the-monstars');
    expect(
      ids(evaluateHavocAchievements(baseFacts({ seasonGames: 82, wins: 81, losses: 1 }))),
    ).not.toContain('the-monstars');
  });
});

describe('Space Jam', () => {
  it('requires 40+ Body Snatcher points while the stolen body was active', () => {
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            games: [
              makeGame({
                gameNumber: 9,
                bodySnatcher: {
                  instanceId: 'i-0',
                  displayName: 'Swapped',
                  swapPoints: 40,
                },
              }),
            ],
          }),
        ),
      ),
    ).toContain('space-jam');
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            games: [
              makeGame({
                gameNumber: 9,
                bodySnatcher: {
                  instanceId: 'i-0',
                  displayName: 'Swapped',
                  swapPoints: 39,
                },
              }),
            ],
          }),
        ),
      ),
    ).not.toContain('space-jam');
  });
});

describe('Manu Off the Bench', () => {
  it('requires a clone to outscore at least three original starters in one game', () => {
    const manuGame = makeGame({
      gameNumber: 5,
      participants: [...starters([10, 12, 14, 30, 40]), makeParticipant('clone', 25, 5)],
    });
    expect(ids(evaluateHavocAchievements(baseFacts({ games: [manuGame] })))).toContain(
      'manu-off-the-bench',
    );

    const onlyTwo = makeGame({
      gameNumber: 5,
      participants: [...starters([10, 12, 20, 30, 40]), makeParticipant('clone', 15, 5)],
    });
    expect(ids(evaluateHavocAchievements(baseFacts({ games: [onlyTwo] })))).not.toContain(
      'manu-off-the-bench',
    );
  });
});

describe('Built Different (Havoc)', () => {
  it('requires 75+ wins in a full Havoc season with all three mutation tiers', () => {
    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            seasonGames: 82,
            wins: 75,
            losses: 7,
            mutationIds: ['growth-spurt', 'four-point-dunk', 'clone-army'],
          }),
        ),
      ),
    ).toContain('havoc-built-different');

    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            seasonGames: 82,
            wins: 74,
            losses: 8,
            mutationIds: ['growth-spurt', 'four-point-dunk', 'clone-army'],
          }),
        ),
      ),
    ).not.toContain('havoc-built-different');

    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            seasonGames: 82,
            wins: 80,
            losses: 2,
            mutationIds: ['growth-spurt', 'four-point-dunk'],
          }),
        ),
      ),
    ).not.toContain('havoc-built-different');

    expect(
      ids(
        evaluateHavocAchievements(
          baseFacts({
            seasonGames: 81,
            wins: 75,
            losses: 6,
            mutationIds: ['growth-spurt', 'four-point-dunk', 'clone-army'],
          }),
        ),
      ),
    ).not.toContain('havoc-built-different');
  });
});

describe('havocAchievementFactsFromRun', () => {
  function humanOwner(result: HavocGameResult): { instanceId: string; displayName: string } {
    const owner = result.home.participants[0];
    if (owner === undefined) throw new Error('fixture is missing its first participant');
    return { instanceId: owner.instanceId, displayName: owner.displayName };
  }

  it('maps Havoc results, Body Snatcher rollups, comparison flips, and mutations', () => {
    const base = buildHavocGameResult();
    const owner = humanOwner(base);
    const result = buildHavocGameResult({
      gameNumber: 3,
      home: {
        ...base.home,
        points: 201,
        participants: base.home.participants.map((line, index) => ({
          ...line,
          points: index === 0 ? 100 : 10,
        })),
      },
      rollups: [
        {
          ownerInstanceId: owner.instanceId,
          mutationId: 'body-snatcher',
          side: 'human',
          triggers: 1,
          pointsDelta: 0,
          freeThrowsGranted: 0,
          turnoversCancelled: 0,
          extraPossessionsEarned: 0,
          extraPossessionsUsed: 0,
          extraPossessionsExpired: 0,
          swapPoints: 44,
          swapSeconds: 600,
          capSeconds: 0,
          activeSeconds: 600,
          ratingChanges: 0,
        },
      ],
    });
    const normal = buildHavocGameResult({ gameNumber: 4, variant: 'normal' });
    const stored: HavocStoredGame = {
      gameNumber: result.gameNumber,
      result,
      resultDigest: 'a'.repeat(32),
    };
    const storedNormal: HavocStoredGame = {
      gameNumber: normal.gameNumber,
      result: normal,
      resultDigest: 'b'.repeat(32),
    };
    const source: HavocRunSource = {
      totals: { games: 82, wins: 80, losses: 2 },
      starters: [
        {
          mutationPackage: [
            { mutationId: 'growth-spurt' },
            { mutationId: 'four-point-dunk' },
            { mutationId: 'clone-army' },
          ],
        },
      ],
      havocGames: [stored, storedNormal],
      comparison: {
        havoc: { wins: 80 },
        normal: { wins: 38 },
        winsGained: 42,
        games: Array.from({ length: 82 }, (_value, index) => ({
          flips: { havocWinNormalLoss: index < 26 },
        })),
      },
    };

    const facts = havocAchievementFactsFromRun(source);
    expect(facts.games).toHaveLength(1);
    expect(facts.games[0]?.gameNumber).toBe(3);
    expect(facts.games[0]?.humanPoints).toBe(201);
    expect(facts.games[0]?.bodySnatcher?.swapPoints).toBe(44);
    expect(facts.games[0]?.bodySnatcher?.displayName).toBe(owner.displayName);
    expect(facts.comparison?.matchedGames).toBe(82);
    expect(facts.comparison?.havocWins).toBe(80);
    expect(facts.comparison?.normalWins).toBe(38);
    expect(facts.comparison?.winsGained).toBe(42);
    expect(facts.comparison?.havocWinsNormalLosses).toBe(26);
    expect(facts.mutationIds).toEqual(['growth-spurt', 'four-point-dunk', 'clone-army']);
    expect(facts.seasonGames).toBe(82);
    expect(facts.wins).toBe(80);

    const unlocked = ids(evaluateHavocAchievements(facts));
    expect(unlocked).toContain('the-curry-effect');
    expect(unlocked).toContain('the-dynasty-effect');
    expect(unlocked).toContain('all-star-game-numbers');
    expect(unlocked).toContain('wilt-chamberlain-mode');
    expect(unlocked).toContain('space-jam');
    expect(unlocked).toContain('havoc-built-different');
    expect(unlocked).not.toContain('better-without-the-boost');
    expect(unlocked).not.toContain('the-monstars');
  });

  it('accepts real HavocComparison and HavocStoredGame types', () => {
    const acceptsComparison = (comparison: HavocComparison): HavocAchievementFacts =>
      havocAchievementFactsFromRun({
        totals: comparison.havoc,
        starters: [],
        havocGames: [],
        comparison,
      });
    expect(typeof acceptsComparison).toBe('function');

    const acceptsStoredGame = (game: HavocStoredGame): HavocAchievementFacts =>
      havocAchievementFactsFromRun({
        totals: { games: 1, wins: 1, losses: 0 },
        starters: [],
        havocGames: [game],
      });
    expect(typeof acceptsStoredGame).toBe('function');
  });
});
