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
