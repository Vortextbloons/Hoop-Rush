import { describe, expect, it } from 'bun:test';
import { eraIdSchema, franchiseIdSchema } from '@hoop-rush/data-contracts';
import { buildChallengeRun } from '@hoop-rush/test-fixtures';
import {
  evaluateAchievements,
  evaluateClassicAchievements,
  evaluatePlayerAchievements,
  evaluateSandboxAchievements,
  seasonAchievementFactsFromRun,
  type SeasonAchievementFacts,
  type SeasonPlayerFacts,
} from './classic.ts';

function makePlayer(overrides: Partial<SeasonPlayerFacts> = {}): SeasonPlayerFacts {
  return {
    playerId: 'p-1',
    displayName: 'Player One',
    originalOverall: 80,
    gamesPlayed: 82,
    points: 1000,
    rebounds: 300,
    assists: 200,
    steals: 40,
    blocks: 20,
    turnovers: 150,
    fieldGoals: { made: 400, attempted: 1000 },
    threes: { made: 100, attempted: 333 },
    freeThrows: { made: 200, attempted: 250 },
    sourceFranchiseId: 'franchise-a',
    eraId: '1980s',
    ...overrides,
  };
}

function basePlayers(): SeasonPlayerFacts[] {
  return [
    makePlayer({ playerId: 'p-1', displayName: 'One', points: 1200 }),
    makePlayer({
      playerId: 'p-2',
      displayName: 'Two',
      points: 1000,
      rebounds: 500,
      assists: 250,
      steals: 50,
      blocks: 30,
      sourceFranchiseId: 'franchise-b',
      eraId: '1990s',
    }),
    makePlayer({
      playerId: 'p-3',
      displayName: 'Three',
      points: 1100,
      rebounds: 350,
      assists: 400,
      steals: 60,
      blocks: 35,
      sourceFranchiseId: 'franchise-c',
      eraId: '2000s',
    }),
    makePlayer({
      playerId: 'p-4',
      displayName: 'Four',
      points: 900,
      rebounds: 320,
      assists: 210,
      steals: 90,
      blocks: 40,
      sourceFranchiseId: 'franchise-d',
      eraId: '2010s',
    }),
    makePlayer({
      playerId: 'p-5',
      displayName: 'Five',
      points: 800,
      rebounds: 280,
      assists: 190,
      steals: 30,
      blocks: 70,
      sourceFranchiseId: 'franchise-e',
      eraId: '2020s',
    }),
  ];
}

function classicPlayers(): SeasonPlayerFacts[] {
  return basePlayers().map((player) => ({ ...player, originalOverall: 90 }));
}

function baseFacts(overrides: Partial<SeasonAchievementFacts> = {}): SeasonAchievementFacts {
  const players = overrides.players ?? basePlayers();
  return {
    mode: 'sandbox',
    status: 'finished',
    wins: 60,
    losses: 22,
    gamesPlayed: 82,
    variant: 'ratings',
    teamPoints: 5000,
    games: [],
    players,
    rerollsUsed: null,
    ...overrides,
  };
}

function classicFacts(overrides: Partial<SeasonAchievementFacts> = {}): SeasonAchievementFacts {
  return baseFacts({ mode: 'classic', players: classicPlayers(), ...overrides });
}

function ids(unlocks: readonly { id: string }[]): string[] {
  return unlocks.map((unlock) => unlock.id);
}

describe('classic achievements', () => {
  it('awards better-than-73-9 only for a perfect 82-0 season', () => {
    expect(ids(evaluateClassicAchievements(classicFacts({ wins: 82, losses: 0 })))).toContain(
      'better-than-73-9',
    );
    expect(ids(evaluateClassicAchievements(classicFacts({ wins: 81, losses: 1 })))).not.toContain(
      'better-than-73-9',
    );
  });

  it('awards one-game-short only for an 81-1 season', () => {
    expect(ids(evaluateClassicAchievements(classicFacts({ wins: 81, losses: 1 })))).toContain(
      'one-game-short',
    );
    expect(ids(evaluateClassicAchievements(classicFacts({ wins: 82, losses: 0 })))).not.toContain(
      'one-game-short',
    );
    expect(ids(evaluateClassicAchievements(classicFacts({ wins: 80, losses: 2 })))).not.toContain(
      'one-game-short',
    );
  });

  it('requires 70 wins and neither classic reroll for the-popovich-way', () => {
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 70, losses: 12, rerollsUsed: { franchise: false, era: false } }),
        ),
      ),
    ).toContain('the-popovich-way');
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 70, losses: 12, rerollsUsed: { franchise: true, era: false } }),
        ),
      ),
    ).not.toContain('the-popovich-way');
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 70, losses: 12, rerollsUsed: { franchise: false, era: true } }),
        ),
      ),
    ).not.toContain('the-popovich-way');
    expect(
      ids(evaluateClassicAchievements(classicFacts({ wins: 70, losses: 12, rerollsUsed: null }))),
    ).not.toContain('the-popovich-way');
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 69, losses: 13, rerollsUsed: { franchise: false, era: false } }),
        ),
      ),
    ).not.toContain('the-popovich-way');
  });

  it('requires Ball Knowledge and 75 wins for ball-dont-lie', () => {
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 75, losses: 7, variant: 'ball-knowledge' }),
        ),
      ),
    ).toContain('ball-dont-lie');
    expect(
      ids(evaluateClassicAchievements(classicFacts({ wins: 75, losses: 7, variant: 'ratings' }))),
    ).not.toContain('ball-dont-lie');
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 74, losses: 8, variant: 'ball-knowledge' }),
        ),
      ),
    ).not.toContain('ball-dont-lie');
  });

  it('requires 65 wins and no 90+ original OVR player for goin-to-work', () => {
    const underNinety = classicPlayers().map((player) => ({
      ...player,
      originalOverall: 89,
    }));
    expect(
      ids(
        evaluateClassicAchievements(classicFacts({ wins: 65, losses: 17, players: underNinety })),
      ),
    ).toContain('goin-to-work');

    const oneNinety = classicPlayers().map((player, index) => ({
      ...player,
      originalOverall: index === 2 ? 90 : 80,
    }));
    expect(
      ids(evaluateClassicAchievements(classicFacts({ wins: 65, losses: 17, players: oneNinety }))),
    ).not.toContain('goin-to-work');
    expect(
      ids(
        evaluateClassicAchievements(classicFacts({ wins: 64, losses: 18, players: underNinety })),
      ),
    ).not.toContain('goin-to-work');
  });

  it('requires all 30 franchises beaten by 15+ for 30-for-30', () => {
    const thirtyGames = Array.from({ length: 30 }, (_, index) => ({
      opponentFranchiseId: `franchise-${String(index)}`,
      won: true,
      margin: 15,
    }));
    expect(ids(evaluateClassicAchievements(classicFacts({ games: thirtyGames })))).toContain(
      '30-for-30',
    );

    const oneCloseWin = thirtyGames.map((game, index) =>
      index === 5 ? { ...game, margin: 14 } : game,
    );
    expect(ids(evaluateClassicAchievements(classicFacts({ games: oneCloseWin })))).not.toContain(
      '30-for-30',
    );
    expect(
      ids(evaluateClassicAchievements(classicFacts({ games: thirtyGames.slice(0, 29) }))),
    ).not.toContain('30-for-30');
  });

  it('requires 70 wins and a starting-five average under 85 for we-believe', () => {
    const underEightyFive = classicPlayers().map((player) => ({
      ...player,
      originalOverall: 80,
    }));
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 70, losses: 12, players: underEightyFive }),
        ),
      ),
    ).toContain('we-believe');

    const exactlyEightyFive = classicPlayers().map((player) => ({
      ...player,
      originalOverall: 85,
    }));
    expect(
      ids(
        evaluateClassicAchievements(
          classicFacts({ wins: 70, losses: 12, players: exactlyEightyFive }),
        ),
      ),
    ).not.toContain('we-believe');
  });

  it('does not evaluate classic achievements outside classic mode', () => {
    expect(
      ids(
        evaluateClassicAchievements(baseFacts({ wins: 82, losses: 0, players: classicPlayers() })),
      ),
    ).toEqual([]);
  });
});

describe('player achievements', () => {
  it('awards brodie-mode for a 10/10/10 season', () => {
    const tripleDouble = basePlayers().map((player, index) =>
      index === 0 ? { ...player, points: 820, rebounds: 820, assists: 820 } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: tripleDouble })))).toContain(
      'brodie-mode',
    );

    const justShort = tripleDouble.map((player, index) =>
      index === 0 ? { ...player, points: 819 } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: justShort })))).not.toContain(
      'brodie-mode',
    );
  });

  it('awards the 50/40/90 club only with exact percentages and minimum attempts', () => {
    const shooter = basePlayers().map((player, index) =>
      index === 0
        ? {
            ...player,
            fieldGoals: { made: 600, attempted: 1200 },
            threes: { made: 150, attempted: 375 },
            freeThrows: { made: 300, attempted: 333 },
          }
        : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: shooter })))).toContain(
      'welcome-to-the-50-40-90-club',
    );

    const lowVolume = shooter.map((player, index) =>
      index === 0 ? { ...player, fieldGoals: { made: 350, attempted: 598 } } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: lowVolume })))).not.toContain(
      'welcome-to-the-50-40-90-club',
    );

    const justBelow = shooter.map((player, index) =>
      index === 0 ? { ...player, freeThrows: { made: 299, attempted: 333 } } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: justBelow })))).not.toContain(
      'welcome-to-the-50-40-90-club',
    );
  });

  it('requires 35% of team points and 70 wins for the-harden-system', () => {
    const harden = basePlayers().map((player, index) => {
      if (index === 0) return { ...player, points: 1750 };
      if (index === 4) return { ...player, points: 250 };
      return player;
    });
    expect(
      ids(
        evaluatePlayerAchievements(
          baseFacts({ wins: 70, losses: 12, players: harden, teamPoints: 5000 }),
        ),
      ),
    ).toContain('the-harden-system');

    const justBelow = harden.map((player, index) =>
      index === 0 ? { ...player, points: 1749 } : player,
    );
    expect(
      ids(
        evaluatePlayerAchievements(
          baseFacts({ wins: 70, losses: 12, players: justBelow, teamPoints: 5000 }),
        ),
      ),
    ).not.toContain('the-harden-system');
    expect(
      ids(
        evaluatePlayerAchievements(
          baseFacts({ wins: 69, losses: 13, players: harden, teamPoints: 5000 }),
        ),
      ),
    ).not.toContain('the-harden-system');
  });

  it('requires all five starters at 15+ PPG and 65 wins for the-beautiful-game', () => {
    const balanced = basePlayers().map((player) => ({ ...player, points: 1230 }));
    expect(
      ids(evaluatePlayerAchievements(baseFacts({ wins: 65, losses: 17, players: balanced }))),
    ).toContain('the-beautiful-game');

    const oneShort = balanced.map((player, index) =>
      index === 2 ? { ...player, points: 1229 } : player,
    );
    expect(
      ids(evaluatePlayerAchievements(baseFacts({ wins: 65, losses: 17, players: oneShort }))),
    ).not.toContain('the-beautiful-game');
    expect(
      ids(evaluatePlayerAchievements(baseFacts({ wins: 64, losses: 18, players: balanced }))),
    ).not.toContain('the-beautiful-game');
  });

  it('awards magic-vision at 10 APG and a 5:1 ratio, including zero turnovers', () => {
    const playmaker = basePlayers().map((player, index) =>
      index === 0 ? { ...player, assists: 820, turnovers: 164 } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: playmaker })))).toContain(
      'magic-vision',
    );

    const belowRatio = playmaker.map((player, index) =>
      index === 0 ? { ...player, turnovers: 165 } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: belowRatio })))).not.toContain(
      'magic-vision',
    );

    const noTurnovers = playmaker.map((player, index) =>
      index === 0 ? { ...player, turnovers: 0 } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: noTurnovers })))).toContain(
      'magic-vision',
    );
  });

  it('awards leeverything when one player leads every total, counting ties', () => {
    const leader = basePlayers().map((player) => ({
      ...player,
      ...(player.playerId === 'p-1'
        ? { points: 2000, rebounds: 600, assists: 500, steals: 100, blocks: 80 }
        : {}),
    }));
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: leader })))).toContain(
      'leeverything',
    );

    const notBlocksLeader = leader.map((player) =>
      player.playerId === 'p-1' ? { ...player, blocks: 60 } : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: notBlocksLeader })))).not.toContain(
      'leeverything',
    );

    const tiedLeader = leader.map((player) =>
      player.playerId === 'p-2'
        ? { ...player, points: 2000, rebounds: 600, assists: 500, steals: 100, blocks: 80 }
        : player,
    );
    expect(ids(evaluatePlayerAchievements(baseFacts({ players: tiedLeader })))).toContain(
      'leeverything',
    );
  });

  it('requires a finished full 82-game season', () => {
    const tripleDouble = basePlayers().map((player, index) =>
      index === 0 ? { ...player, points: 820, rebounds: 820, assists: 820 } : player,
    );
    expect(
      ids(evaluatePlayerAchievements(baseFacts({ status: 'active', players: tripleDouble }))),
    ).toEqual([]);
    expect(
      ids(
        evaluatePlayerAchievements(
          baseFacts({ gamesPlayed: 81, wins: 60, losses: 21, players: tripleDouble }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('sandbox achievements', () => {
  function dreamPlayers(): SeasonPlayerFacts[] {
    const eras = ['1960s', '1970s', '1980s', '1990s', '2000s'];
    return basePlayers().map((player, index) => ({ ...player, eraId: eras[index] ?? null }));
  }

  it('awards the-dream-team only in Sandbox for five different decades', () => {
    expect(
      ids(
        evaluateSandboxAchievements(
          baseFacts({ mode: 'sandbox', wins: 70, losses: 12, players: dreamPlayers() }),
        ),
      ),
    ).toContain('the-dream-team');
    expect(
      ids(
        evaluateSandboxAchievements(
          baseFacts({ mode: 'classic', wins: 70, losses: 12, players: dreamPlayers() }),
        ),
      ),
    ).not.toContain('the-dream-team');

    const duplicateDecade = dreamPlayers().map((player, index) =>
      index === 4 ? { ...player, eraId: '1960s' } : player,
    );
    expect(
      ids(
        evaluateSandboxAchievements(
          baseFacts({ mode: 'sandbox', wins: 70, losses: 12, players: duplicateDecade }),
        ),
      ),
    ).not.toContain('the-dream-team');
  });

  it('awards laker-legacy for one franchise across three decades', () => {
    const eras = ['1980s', '1980s', '1990s', '2000s', '2000s'];
    const lakers = basePlayers().map((player, index) => ({
      ...player,
      sourceFranchiseId: 'lakers',
      eraId: eras[index] ?? null,
    }));
    expect(
      ids(evaluateSandboxAchievements(baseFacts({ wins: 70, losses: 12, players: lakers }))),
    ).toContain('laker-legacy');

    const mixedFranchise = lakers.map((player, index) =>
      index === 4 ? { ...player, sourceFranchiseId: 'celtics' } : player,
    );
    expect(
      ids(
        evaluateSandboxAchievements(baseFacts({ wins: 70, losses: 12, players: mixedFranchise })),
      ),
    ).not.toContain('laker-legacy');

    const twoDecades = ['1980s', '1980s', '1990s', '1990s', '1990s'];
    const shortSpan = lakers.map((player, index) => ({
      ...player,
      eraId: twoDecades[index] ?? null,
    }));
    expect(
      ids(evaluateSandboxAchievements(baseFacts({ wins: 70, losses: 12, players: shortSpan }))),
    ).not.toContain('laker-legacy');
  });

  it('awards old-school-legends for at least three pre-1980 seasons', () => {
    const eras = ['1960s', '1970s', '1970s', '1980s', '1980s'];
    const oldSchool = basePlayers().map((player, index) => ({
      ...player,
      eraId: eras[index] ?? null,
    }));
    expect(
      ids(evaluateSandboxAchievements(baseFacts({ wins: 70, losses: 12, players: oldSchool }))),
    ).toContain('old-school-legends');

    const onlyTwo = oldSchool.map((player, index) =>
      index === 1 ? { ...player, eraId: '1990s' } : player,
    );
    expect(
      ids(evaluateSandboxAchievements(baseFacts({ wins: 70, losses: 12, players: onlyTwo }))),
    ).not.toContain('old-school-legends');
  });

  it('does not evaluate sandbox achievements for an incomplete season', () => {
    expect(
      ids(
        evaluateSandboxAchievements(
          baseFacts({
            mode: 'sandbox',
            wins: 70,
            losses: 11,
            gamesPlayed: 81,
            players: dreamPlayers(),
          }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('combined evaluation', () => {
  it('returns the classic, player, and sandbox unlocks without cross-mode leakage', () => {
    const perfectClassic = classicFacts({ wins: 82, losses: 0 });
    const combined = ids(evaluateAchievements(perfectClassic));
    expect(combined).toContain('better-than-73-9');
    expect(combined).not.toContain('the-dream-team');

    const sandboxPerfect = baseFacts({ wins: 82, losses: 0 });
    expect(ids(evaluateAchievements(sandboxPerfect))).not.toContain('better-than-73-9');
  });

  it('maps completed runs and captured rerolls into evaluator facts', () => {
    const base = buildChallengeRun({ mode: 'classic', variant: 'ball-knowledge' });
    const players = base.players.map((player, index) => ({
      ...player,
      overall: 80 + index,
    }));
    const selections = players.map((player, index) => ({
      playerId: player.playerId,
      franchiseId: franchiseIdSchema.parse(`franchise-${String(index)}`),
      eraId: eraIdSchema.parse(['1980s', '1990s', '2000s', '2010s', '2020s'][index]),
    }));
    const run = buildChallengeRun({
      mode: 'classic',
      variant: 'ball-knowledge',
      status: 'finished',
      players,
      selections,
      classicDraft: {
        draftId: 'draft-fixture',
        variant: 'ball-knowledge',
        seed: base.runSeed,
        rerolls: { franchiseSpent: false, eraSpent: false },
        picks: selections.map((selection, index) => ({
          ...selection,
          round: (index + 1) as 1 | 2 | 3 | 4 | 5,
          slotIndex: index as 0 | 1 | 2 | 3 | 4,
        })),
      },
    });

    const facts = seasonAchievementFactsFromRun(run);
    expect(facts.mode).toBe('classic');
    expect(facts.variant).toBe('ball-knowledge');
    expect(facts.rerollsUsed).toEqual({ franchise: false, era: false });
    expect(facts.players.map((player) => player.originalOverall)).toEqual([80, 81, 82, 83, 84]);
    expect(facts.players.map((player) => player.sourceFranchiseId)).toEqual([
      'franchise-0',
      'franchise-1',
      'franchise-2',
      'franchise-3',
      'franchise-4',
    ]);
    expect(facts.players.map((player) => player.eraId)).toEqual([
      '1980s',
      '1990s',
      '2000s',
      '2010s',
      '2020s',
    ]);
  });
});
