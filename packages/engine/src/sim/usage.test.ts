import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { lineupMeanUsage, relativeUsage, usageCongestionScale } from './usage.ts';

function player(usageRate: number, id = 'p1'): SimulationPlayer {
  return {
    playerId: id as SimulationPlayer['playerId'],
    displayName: id,
    positions: ['PG'],
    heightInches: 75,
    weightLbs: 200,
    ratings: {
      insideScoring: 70,
      closeShot: 70,
      midrange: 70,
      threePoint: 70,
      freeThrow: 70,
      ballHandling: 70,
      passing: 70,
      offensiveIq: 70,
      offensiveRebound: 60,
      defensiveRebound: 60,
      perimeterDefense: 60,
      interiorDefense: 60,
      steal: 60,
      block: 60,
      defensiveIq: 60,
      speed: 70,
      strength: 70,
      vertical: 70,
    },
    tendencies: {
      usageRate,
      passRate: 30,
      shotRate: 25,
      driveRate: 18,
      postUpRate: 5,
      rimFrequency: 30,
      shortMidFrequency: 20,
      longMidFrequency: 14,
      cornerThreeFrequency: 8,
      aboveBreakThreeFrequency: 12,
      threePointRate: 20,
      freeThrowRate: 22,
      turnoverRate: 12,
      isolationRate: 10,
      pickAndRollBallHandlerRate: 25,
      pickAndRollRollManRate: 10,
      spotUpRate: 20,
      transitionRate: 15,
      cutRate: 10,
      foulRate: 2,
      stealAttemptRate: 8,
      blockAttemptRate: 10,
      crashOffensiveGlassRate: 12,
    },
  };
}

function team(usageRates: readonly number[]): SimulationTeam {
  return {
    teamId: 't',
    displayName: 'T',
    players: usageRates.map((usageRate, index) => player(usageRate, `p${String(index)}`)),
  };
}

describe('relativeUsage', () => {
  it('uses the fixed league reference, not lineup mean', () => {
    const soloStar = team([33, 18, 18, 18, 18]);
    const star = soloStar.players[0];
    expect(star).toBeDefined();
    if (star === undefined) throw new Error('missing player');
    expect(lineupMeanUsage(soloStar)).toBeLessThan(22);
    expect(relativeUsage(star, soloStar)).toBeCloseTo(33 / 20, 6);
  });

  it('down-ranks secondary high-usage peaks when several share the floor', () => {
    const stacked = team([31, 36, 29, 29, 31]);
    const alpha = stacked.players[1];
    const second = stacked.players[0];
    expect(alpha).toBeDefined();
    expect(second).toBeDefined();
    if (alpha === undefined || second === undefined) throw new Error('missing player');
    expect(relativeUsage(alpha, stacked)).toBeGreaterThan(relativeUsage(second, stacked));
    expect(usageCongestionScale(alpha, stacked)).toBe(1);
    expect(usageCongestionScale(second, stacked)).toBeLessThan(1);
  });

  it('matches prior behavior when lineup mean equals the reference', () => {
    const balanced = team([20, 20, 20, 20, 20]);
    const sample = balanced.players[0];
    expect(sample).toBeDefined();
    if (sample === undefined) throw new Error('missing player');
    expect(relativeUsage(sample, balanced)).toBeCloseTo(1, 6);
    expect(relativeUsage(sample, balanced)).toBeCloseTo(
      20 / ENGINE_CONSTANTS.usageRoleReference,
      6,
    );
  });
});
