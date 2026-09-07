import { describe, expect, it } from 'vitest';
import { REQUIRED_RATING_KEYS, type SimulationRatings } from './simulation.ts';
import { offenseDefenseOf, summaryRatingsOfRatings } from './summary-ratings.ts';
import { SIMULATION_RATINGS, SIMULATION_TENDENCIES } from './season-schemas-fixtures.ts';

function flatRatings(value: number): SimulationRatings {
  return Object.fromEntries(REQUIRED_RATING_KEYS.map((key) => [key, value])) as SimulationRatings;
}

describe('offenseDefenseOf', () => {
  it('derives the documented all-70 baseline', () => {
    expect(offenseDefenseOf(flatRatings(70), SIMULATION_TENDENCIES)).toEqual({
      offenseRating: 69,
      defenseRating: 70,
    });
  });

  it('is deterministic and bounded', () => {
    const first = offenseDefenseOf(SIMULATION_RATINGS, SIMULATION_TENDENCIES);
    expect(offenseDefenseOf(SIMULATION_RATINGS, SIMULATION_TENDENCIES)).toEqual(first);
    expect(
      offenseDefenseOf(flatRatings(0), SIMULATION_TENDENCIES).offenseRating,
    ).toBeGreaterThanOrEqual(0);
    expect(
      offenseDefenseOf(flatRatings(100), SIMULATION_TENDENCIES).defenseRating,
    ).toBeLessThanOrEqual(100);
  });

  it('responds to the boosted keys sponsors touch', () => {
    const base = offenseDefenseOf(flatRatings(70), SIMULATION_TENDENCIES);
    const lifted = offenseDefenseOf(
      { ...flatRatings(70), midrange: 78, threePoint: 75 },
      SIMULATION_TENDENCIES,
    );
    expect(lifted.offenseRating).toBeGreaterThan(base.offenseRating);
    expect(lifted.defenseRating).toBe(base.defenseRating);
    const stopped = offenseDefenseOf(
      { ...flatRatings(70), steal: 78, block: 76 },
      SIMULATION_TENDENCIES,
    );
    expect(stopped.defenseRating).toBeGreaterThan(base.defenseRating);
    expect(stopped.offenseRating).toBe(base.offenseRating);
  });
});

describe('summaryRatingsOfRatings', () => {
  it('blends offense and defense into the overall', () => {
    expect(summaryRatingsOfRatings(flatRatings(70), SIMULATION_TENDENCIES)).toEqual({
      offenseRating: 69,
      defenseRating: 70,
      overallRating: 69,
    });
  });

  it('moves the overall when a gear-sized boost lands', () => {
    const base = summaryRatingsOfRatings(flatRatings(70), SIMULATION_TENDENCIES);
    const boosted = summaryRatingsOfRatings(
      { ...flatRatings(70), midrange: 78 },
      SIMULATION_TENDENCIES,
    );
    expect(boosted.overallRating).toBe(base.overallRating + 1);
  });
});
