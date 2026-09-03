import { describe, expect, it } from 'vitest';
import { buildLegalSimulationTeam, buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import {
  evaluateContextualPlayerValue,
  evaluateLineupFit,
  evaluateLineupMatchup,
} from './contextual-value.ts';
describe('contextual lineup value', () => {
  it('rewards a missing creator without changing the player base overall', () => {
    const creator = buildSimulationPlayer({
      playerId: 'creator',
      overall: 82,
      ratings: {
        ...buildSimulationPlayer().ratings,
        ballHandling: 92,
        passing: 90,
        offensiveIq: 88,
      },
      tendencies: { ...buildSimulationPlayer().tendencies, usageRate: 25 },
    });
    const teammates = buildLegalSimulationTeam().players.slice(1);
    const value = evaluateLineupFit(creator, teammates);
    expect(value.fitDelta).toBeGreaterThan(0);
    expect(value.baseOverall).toBe(82);
    expect(value.reasons[0]?.code).toBe('missing-creation');
  });
  it('penalizes redundant non-shooting and high-usage roles', () => {
    const candidate = buildSimulationPlayer({
      overall: 80,
      ratings: { ...buildSimulationPlayer().ratings, threePoint: 35, midrange: 40 },
      tendencies: { ...buildSimulationPlayer().tendencies, usageRate: 27 },
    });
    const teammates = [0, 1, 2, 3].map((index) =>
      buildSimulationPlayer({
        playerId: `redundant-${String(index)}`,
        ratings: { ...buildSimulationPlayer().ratings, threePoint: 38 },
        tendencies: { ...buildSimulationPlayer().tendencies, usageRate: 25 },
      }),
    );
    const value = evaluateLineupFit(candidate, teammates);
    expect(value.fitDelta).toBeLessThan(0);
    expect(value.reasons.map((reason) => reason.code)).toContain('spacing-redundancy');
  });
  it('keeps fit and matchup bounded and leaves simulation player data unchanged', () => {
    const lineup = buildLegalSimulationTeam();
    const opponent = buildLegalSimulationTeam({ teamId: 'opponent', displayName: 'Opponent' });
    const snapshot = JSON.stringify(lineup);
    const matchup = evaluateLineupMatchup(lineup, opponent);
    const focalPlayer = lineup.players.at(0);
    if (!focalPlayer) throw new Error('fixture lineup must contain a focal player');
    const value = evaluateContextualPlayerValue(focalPlayer, lineup.players.slice(1), opponent);
    expect(matchup.matchupDelta).toBeGreaterThanOrEqual(-3);
    expect(matchup.matchupDelta).toBeLessThanOrEqual(3);
    expect(value.effectiveValue).toBeGreaterThanOrEqual(0);
    expect(value.effectiveValue).toBeLessThanOrEqual(100);
    expect(JSON.stringify(lineup)).toBe(snapshot);
  });
});
