import { expect, test } from 'bun:test';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateFullCourtGame } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster, fullCourtTestSeed } from './game-test-support.ts';
import { planFullCourtOpponent, projectFullCourtMatchup } from './opponent-planning.ts';

test('projected scores and strength differences track seeded Full Court games', () => {
  const context = createEngineContext();
  const comparisons = [62, 74, 86].map((rating) => {
    const input = fullCourtTestInput({
      seed: 'projection',
      homeRoster: fullCourtTestRoster('projection-home', 9, (index) => ({
        rating: rating - index,
      })),
      awayRoster: fullCourtTestRoster('projection-away', 9, (index) => ({ rating: 74 - index })),
    });
    const home = {
      ...input.home,
      tactics: { pace: 'balanced', offense: 'interior', defense: 'pressure' } as const,
    };
    const predicted = projectFullCourtMatchup(home, input.away, input.profile);
    let homePoints = 0;
    let awayPoints = 0;
    const samples = 16;
    for (let index = 0; index < samples; index++) {
      const result = simulateFullCourtGame(
        {
          ...input,
          home,
          seed: fullCourtTestSeed(`projection-${String(index)}`),
        },
        context,
      );
      homePoints += result.home.box.points / samples;
      awayPoints += result.away.box.points / samples;
    }
    expect(Math.abs(predicted.home - homePoints)).toBeLessThan(12);
    expect(Math.abs(predicted.away - awayPoints)).toBeLessThan(12);
    expect(Math.abs(predicted.home - predicted.away - homePoints + awayPoints)).toBeLessThan(11);
    return { projected: predicted.home - predicted.away, simulated: homePoints - awayPoints };
  });
  const [weak, even, strong] = comparisons;
  if (weak === undefined || even === undefined || strong === undefined) {
    throw new Error('Expected three matchup comparisons');
  }
  expect(strong.projected).toBeGreaterThan(even.projected);
  expect(even.projected).toBeGreaterThan(weak.projected);
  expect(strong.simulated).toBeGreaterThan(even.simulated);
  expect(even.simulated).toBeGreaterThan(weak.simulated);
});

test('opponent plans are deterministic and improve the projected matchup', () => {
  const input = fullCourtTestInput({
    seed: 'planning',
    homeRoster: fullCourtTestRoster('planner', 10, (index) => ({ rating: index < 5 ? 60 : 88 })),
  });
  const home = {
    ...input.home,
    rotation: { startingFive: input.home.roster.slice(0, 5).map((player) => player.playerId) },
  };
  const planned = planFullCourtOpponent(home, [input.away], input.profile);
  const before = projectFullCourtMatchup(home, input.away, input.profile);
  const after = projectFullCourtMatchup(planned, input.away, input.profile);
  expect(planned).toEqual(planFullCourtOpponent(home, [input.away], input.profile));
  expect(planned.roster).toBe(home.roster);
  expect(after.home - after.away).toBeGreaterThan(before.home - before.away + 0.5);

  const context = createEngineContext();
  let pairedGain = 0;
  for (let index = 0; index < 24; index++) {
    const seed = fullCourtTestSeed(`loadout-${String(index)}`);
    const baselineGame = simulateFullCourtGame({ ...input, seed, home }, context);
    const plannedGame = simulateFullCourtGame({ ...input, seed, home: planned }, context);
    pairedGain +=
      plannedGame.home.box.points -
      plannedGame.away.box.points -
      (baselineGame.home.box.points - baselineGame.away.box.points);
  }
  expect(pairedGain / 24).toBeGreaterThan(0);
});
