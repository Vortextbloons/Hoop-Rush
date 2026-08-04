import { describe, expect, it } from 'vitest';
import { buildLegalSimulationTeam } from '@hoop-rush/test-fixtures';
import { foulerWeights, shootingFoulProbability } from './fouls.js';
import { rebounderWeights, teamMean } from './rebounding.js';
import { stealerWeights } from './security.js';
import { blockProbability } from './shooting.js';
import { buildEraSimulationProfile } from '@hoop-rush/test-fixtures';

function withTendency(key: string, value: number) {
  const team = buildLegalSimulationTeam();
  return {
    ...team,
    players: team.players.map((player, index) =>
      index === 0 ? { ...player, tendencies: { ...player.tendencies, [key]: value } } : player,
    ),
  };
}

describe('player tendencies affect possession mechanics', () => {
  it('uses foul aggression in foul probability and attribution', () => {
    const low = withTendency('foulRate', 3);
    const high = withTendency('foulRate', 12);
    const shooter = low.players[1]!;
    expect(foulerWeights(high)[0]).toBeGreaterThan(foulerWeights(low)[0]!);
    expect(
      shootingFoulProbability(shooter, high.players[0]!, 'rim', buildEraSimulationProfile()),
    ).toBeGreaterThan(
      shootingFoulProbability(shooter, low.players[0]!, 'rim', buildEraSimulationProfile()),
    );
  });

  it('uses steal, block, and offensive-glass aggression', () => {
    const lowSteal = withTendency('stealAttemptRate', 4);
    const highSteal = withTendency('stealAttemptRate', 18);
    expect(stealerWeights(highSteal)[0]).toBeGreaterThan(stealerWeights(lowSteal)[0]!);

    const lowBlock = withTendency('blockAttemptRate', 4).players[0]!;
    const highBlock = withTendency('blockAttemptRate', 18).players[0]!;
    expect(blockProbability(highBlock, 'rim', 'pickAndRoll')).toBeGreaterThan(
      blockProbability(lowBlock, 'rim', 'pickAndRoll'),
    );

    const lowCrash = withTendency('crashOffensiveGlassRate', 4);
    const highCrash = withTendency('crashOffensiveGlassRate', 30);
    expect(teamMean(highCrash, 'offensiveRebound')).toBeGreaterThan(
      teamMean(lowCrash, 'offensiveRebound'),
    );
    expect(rebounderWeights(highCrash, true)[0]).toBeGreaterThan(
      rebounderWeights(lowCrash, true)[0]!,
    );
  });
});
