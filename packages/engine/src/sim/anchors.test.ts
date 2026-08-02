import { describe, expect, it } from 'vitest';
import type {
  SimulationAnchors,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildGameSimulationInput,
  buildLegalSimulationTeam,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from './context.js';
import { simulateGame } from './game.js';
import { freeThrowProbability } from './fouls.js';
import { makeProbability } from './shooting.js';

const context = createEngineContext();

const shaquilleAnchors: SimulationAnchors = {
  gamesPlayed: 79,
  minutesPerGame: 40.1,
  pointsPerGame: 29.7,
  reboundsPerGame: 13.6,
  offensiveReboundsPerGame: 3.8,
  defensiveReboundsPerGame: 9.8,
  assistsPerGame: 3.8,
  stealsPerGame: 0.5,
  blocksPerGame: 3,
  turnoversPerGame: 2.8,
  fieldGoalPct: 0.573,
  threePointPct: null,
  freeThrowPct: 0.529,
  threePointAttemptRate: 0,
  freeThrowAttemptRate: 0.493,
};

function anchoredCenterTeam(): SimulationTeam {
  const base = buildLegalSimulationTeam();
  const players = base.players.map((player, index) =>
    index === 4
      ? buildSimulationPlayer({
          playerId: 'shaquille-anchor',
          displayName: 'Anchor Center',
          positions: ['C'],
          heightInches: 85,
          weightLbs: 325,
          ratings: {
            ...player.ratings,
            insideScoring: 96,
            freeThrow: 54,
            offensiveRebound: 88,
            defensiveRebound: 96,
            interiorDefense: 92,
            strength: 98,
            block: 90,
          },
          tendencies: {
            ...player.tendencies,
            usageRate: 31,
            passRate: 14,
            shotRate: 43,
            rimFrequency: 46,
            shortMidFrequency: 18,
            longMidFrequency: 7,
            cornerThreeFrequency: 0,
            aboveBreakThreeFrequency: 0,
            threePointRate: 0,
            freeThrowRate: 49,
            postUpRate: 30,
            pickAndRollRollManRate: 30,
          },
          anchors: shaquilleAnchors,
        })
      : player,
  );
  return { ...base, players };
}

describe('observed player anchors', () => {
  it('keep low free-throw shooters in a realistic probability band', () => {
    const player = anchoredCenterTeam().players[4]!;
    const probability = freeThrowProbability(player, buildEraSimulationProfile());
    expect(probability).toBeGreaterThan(0.45);
    expect(probability).toBeLessThan(0.65);
  });

  it('produce realistic aggregate lines without player-specific rules', () => {
    const home = anchoredCenterTeam();
    const away = anchoredCenterTeam();
    let freeThrowsMade = 0;
    let freeThrowsAttempted = 0;
    let rebounds = 0;
    let assists = 0;
    let threePointAttempts = 0;
    const samples = 240;

    for (let index = 0; index < samples; index += 1) {
      const result = simulateGame(
        buildGameSimulationInput({
          seed: seedFromString(`anchor-${index}`),
          home,
          away,
        }),
        context,
      );
      const player = result.home.players.find(
        (candidate) => candidate.playerId === 'shaquille-anchor',
      )!;
      freeThrowsMade += player.freeThrows.made;
      freeThrowsAttempted += player.freeThrows.attempted;
      rebounds += player.rebounds.total;
      assists += player.assists;
      threePointAttempts += player.threes.attempted;
    }

    const freeThrowPct = freeThrowsMade / Math.max(1, freeThrowsAttempted);
    expect(freeThrowPct).toBeGreaterThan(0.45);
    expect(freeThrowPct).toBeLessThan(0.65);
    expect(rebounds / samples).toBeGreaterThan(10);
    expect(assists / samples).toBeGreaterThan(1.5);
    expect(assists / samples).toBeLessThan(6);
    expect(threePointAttempts / samples).toBeLessThan(1);
  });

  it('keeps observed wing three-point accuracy below the inflated-rating failure mode', () => {
    const profile = buildEraSimulationProfile();
    const defender = buildSimulationPlayer({
      ratings: { ...buildSimulationPlayer().ratings, perimeterDefense: 62 },
    });
    const shotContext = {
      zone: 'aboveBreakThree' as const,
      action: 'spotUp' as const,
      secondsRemainingAtShot: 300,
    };
    const kobeLike = buildSimulationPlayer({
      ratings: { ...buildSimulationPlayer().ratings, threePoint: 66 },
      anchors: { ...shaquilleAnchors, threePointPct: 0.317, threePointAttemptRate: 0.123 },
    });
    const ceballosLike = buildSimulationPlayer({
      ratings: { ...buildSimulationPlayer().ratings, threePoint: 76 },
      anchors: { ...shaquilleAnchors, threePointPct: 0.397, threePointAttemptRate: 0.149 },
    });
    const teamOf = (shooter: ReturnType<typeof buildSimulationPlayer>) => ({
      teamId: 'anchor-team',
      displayName: 'Anchor Team',
      players: [shooter, shooter, shooter, shooter, shooter],
    });
    const kobeProbability = makeProbability(
      kobeLike,
      defender,
      teamOf(kobeLike),
      profile,
      shotContext,
      300,
    );
    const ceballosProbability = makeProbability(
      ceballosLike,
      defender,
      teamOf(ceballosLike),
      profile,
      shotContext,
      300,
    );
    expect(kobeProbability).toBeGreaterThan(0.28);
    expect(kobeProbability).toBeLessThan(0.4);
    expect(ceballosProbability).toBeGreaterThan(0.34);
    expect(ceballosProbability).toBeLessThan(0.46);
  });

  it('keeps deterministic results when anchors are present', () => {
    const team = anchoredCenterTeam();
    const input = buildGameSimulationInput({
      seed: seedFromString('anchor-determinism'),
      home: team,
      away: team,
    });
    expect(simulateGame(input, context)).toEqual(simulateGame(input, context));
  });
});

/** Average field-goal percentage of one anchored player across many games. */
function averageDefenseTeam(): SimulationTeam {
  const base = buildLegalSimulationTeam();
  const slots: SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];
  const ratings = {} as SimulationPlayer['ratings'];
  for (const key of Object.keys(base.players[0]!.ratings) as Array<
    keyof SimulationPlayer['ratings']
  >) {
    ratings[key] = 66;
  }
  return {
    teamId: 'average-defense',
    displayName: 'Average Defense',
    players: slots.map((positions, index) => ({
      ...base.players[index]!,
      playerId: `avg-def-${index}`,
      displayName: `Avg Def ${index}`,
      positions,
      ratings,
    })),
  };
}

function sampleFieldGoalPct(
  playerId: string,
  home: SimulationTeam,
  away: SimulationTeam,
  games: number,
): { fieldGoalPct: number; threePointPct: number; freeThrowPct: number; turnoverRate: number } {
  let fgm = 0;
  let fga = 0;
  let tpm = 0;
  let tpa = 0;
  let ftm = 0;
  let fta = 0;
  let tov = 0;
  let tovPossessionEstimate = 0;
  for (let index = 0; index < games; index += 1) {
    const result = simulateGame(
      buildGameSimulationInput({
        seed: seedFromString(`anchor-pin-${playerId}-${index}`),
        home,
        away,
      }),
      context,
    );
    const box = result.home.players.find((p) => p.playerId === playerId)!;
    fgm += box.fieldGoals.made;
    fga += box.fieldGoals.attempted;
    tpm += box.threes.made;
    tpa += box.threes.attempted;
    ftm += box.freeThrows.made;
    fta += box.freeThrows.attempted;
    tov += box.turnovers;
    tovPossessionEstimate +=
      box.fieldGoals.attempted + 0.44 * box.freeThrows.attempted + box.turnovers;
  }
  return {
    fieldGoalPct: fgm / Math.max(1, fga),
    threePointPct: tpm / Math.max(1, tpa),
    freeThrowPct: ftm / Math.max(1, fta),
    turnoverRate: tov / Math.max(1, tovPossessionEstimate),
  };
}

describe('observed player anchors pin efficiency (m3-engine-v5)', () => {
  it('pins a rim-reliant interior scorer to his observed two-point percentage', () => {
    // Shaq's observed FG% is 0.573 with no three-point attempts. Before the
    // anchor mix fix the era-blended shot mix dragged this to ~0.52; the
    // anchor must now be computed against the exact mix the sim shoots.
    // The opponent is a league-average defense (all ratings at the
    // population mean), so the zero-centered contest leaves the anchored
    // conversion intact.
    const team = anchoredCenterTeam();
    const { fieldGoalPct } = sampleFieldGoalPct(
      'shaquille-anchor',
      team,
      averageDefenseTeam(),
      300,
    );
    expect(fieldGoalPct).toBeGreaterThan(0.545);
    expect(fieldGoalPct).toBeLessThan(0.59);
  });

  it('pins a perimeter star to observed field-goal, three-point, and free-throw rates', () => {
    const mjAnchors: SimulationAnchors = {
      gamesPlayed: 82,
      minutesPerGame: 37.9,
      pointsPerGame: 29.6,
      reboundsPerGame: 6.9,
      offensiveReboundsPerGame: 1.1,
      defensiveReboundsPerGame: 5.8,
      assistsPerGame: 4.3,
      stealsPerGame: 1.7,
      blocksPerGame: 0.6,
      turnoversPerGame: 2.6,
      fieldGoalPct: 0.486,
      threePointPct: 0.374,
      freeThrowPct: 0.833,
      threePointAttemptRate: 0.158,
      freeThrowAttemptRate: 0.379,
    };
    const base = buildLegalSimulationTeam();
    const slots: SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];
    const star = buildSimulationPlayer({
      playerId: 'mj-anchor',
      displayName: 'Anchor Star',
      positions: ['G'],
      ratings: {
        ...base.players[0]!.ratings,
        insideScoring: 90,
        closeShot: 80,
        midrange: 85,
        threePoint: 80,
        ballHandling: 90,
        passing: 80,
      },
      tendencies: {
        ...base.players[0]!.tendencies,
        usageRate: 33,
        shotRate: 35,
        rimFrequency: 40,
        shortMidFrequency: 22,
        longMidFrequency: 22,
        cornerThreeFrequency: 5,
        aboveBreakThreeFrequency: 11,
        threePointRate: 16,
        freeThrowRate: 38,
        turnoverRate: 9,
      },
      anchors: mjAnchors,
    });
    const home = {
      ...base,
      players: slots.map((positions, index) =>
        index === 0 ? { ...star, positions } : { ...base.players[index]!, positions },
      ),
    };
    const away = {
      ...base,
      players: slots.map((positions, index) =>
        index === 0 ? { ...star, positions } : { ...base.players[index]!, positions },
      ),
    };
    const { fieldGoalPct, threePointPct, freeThrowPct, turnoverRate } = sampleFieldGoalPct(
      'mj-anchor',
      home,
      away,
      300,
    );
    // Observed FG% is 0.486 overall (0.374 from three). The anchor blend must
    // hold the aggregate near the recorded season, not the era mean.
    expect(fieldGoalPct).toBeGreaterThan(0.451);
    expect(fieldGoalPct).toBeLessThan(0.521);
    expect(threePointPct).toBeGreaterThan(0.334);
    expect(threePointPct).toBeLessThan(0.414);
    expect(freeThrowPct).toBeGreaterThan(0.81);
    expect(freeThrowPct).toBeLessThan(0.88);
    // Real MJ converts ~8.6% of his possessions into turnovers; the old
    // era-anchored model pushed stars to the league mean (~11-12%). The
    // observed-tendency blend must keep stars near their own rate.
    expect(turnoverRate).toBeLessThan(0.1);
    expect(turnoverRate).toBeGreaterThan(0.04);
  });
});
