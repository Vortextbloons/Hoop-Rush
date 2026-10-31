import { describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_PLAYOFF_CAPS,
  CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  capRushPlayoffPerformanceSchema,
  capRushPlayoffPlayerSchema,
  type CapRushPlayoffApplied,
  type CapRushPlayoffPlayer,
} from '@hoop-rush/data-contracts';
import {
  capRushPlayoffCoverage,
  capRushPlayoffDirection,
  capRushPlayoffRowFor,
  capRushPlayoffStatusOf,
  sampleLabel,
  signedFixed,
  signedPer36,
  signedPoints,
  weightLabel,
} from './cap-rush-playoff-presentation.ts';

const row: CapRushPlayoffPlayer = capRushPlayoffPlayerSchema.parse({
  playerId: 'p-1',
  playerVersionId: `pv-${'a'.repeat(32)}`,
  seasonKey: '2017-18',
  weight: 0.83,
  observed: {
    tsPct: 0.024,
    pointsPer36: 2.4,
    assistsPer36: -1.1,
    reboundsPer36: 0.6,
    turnoversPer36: 0.45,
  },
  regularSeason: {
    gamesPlayed: 82,
    minutes: 3026,
    tsPct: 0.588,
    pointsPer36: 27.2,
    assistsPer36: 9.1,
    reboundsPer36: 8.6,
    turnoversPer36: 4.2,
  },
  playoffs: {
    gamesPlayed: 22,
    minutes: 922,
    tsPct: 0.612,
    pointsPer36: 29.6,
    assistsPer36: 8,
    reboundsPer36: 9.2,
    turnoversPer36: 4.65,
  },
  applied: {
    fieldGoalPct: 0.016,
    threePointPct: 0.016,
    fieldGoalAttemptsPerGame: 0.7,
    passRate: -1.8,
    assistsPerGame: -0.32,
    offensiveReboundsPerGame: 0.05,
    defensiveReboundsPerGame: 0.13,
    turnoverRate: 0.6,
  },
});

const neutralApplied: CapRushPlayoffApplied = {
  fieldGoalPct: 0,
  threePointPct: 0,
  fieldGoalAttemptsPerGame: 0,
  passRate: 0,
  assistsPerGame: 0,
  offensiveReboundsPerGame: 0,
  defensiveReboundsPerGame: 0,
  turnoverRate: 0,
};

const performance = capRushPlayoffPerformanceSchema.parse({
  formulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  sampleMinutesAnchor: CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  players: [row],
});

describe('cap rush playoff presentation', () => {
  it('reads the mark from the effective adjustment, not the raw history', () => {
    expect(capRushPlayoffDirection({ ...neutralApplied, fieldGoalPct: 0.02 })).toBe('up');
    expect(capRushPlayoffDirection({ ...neutralApplied, fieldGoalPct: -0.02 })).toBe('down');
    expect(capRushPlayoffDirection(neutralApplied)).toBe('neutral');
  });

  it('treats a positive turnover tendency as a decline', () => {
    expect(
      capRushPlayoffDirection({
        ...neutralApplied,
        turnoverRate: CAP_RUSH_PLAYOFF_CAPS.turnoverRate,
      }),
    ).toBe('down');
    expect(
      capRushPlayoffDirection({
        ...neutralApplied,
        turnoverRate: -CAP_RUSH_PLAYOFF_CAPS.turnoverRate,
      }),
    ).toBe('up');
  });

  it('cannot let one capped rebound shift outvote a capped shooting shift', () => {
    const rebounds =
      CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame +
      CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame;
    expect(
      capRushPlayoffDirection({
        ...neutralApplied,
        offensiveReboundsPerGame: CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame,
        defensiveReboundsPerGame: CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame,
        fieldGoalPct: -CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct,
      }),
    ).toBe('neutral');
    expect(
      capRushPlayoffDirection({
        ...neutralApplied,
        offensiveReboundsPerGame: CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame,
        defensiveReboundsPerGame: CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame,
      }),
    ).toBe('up');
    expect(rebounds).toBeGreaterThan(0);
  });

  it('shows true shooting as percentage points and production per 36', () => {
    expect(signedPoints(0.02)).toBe('+2.0 pp');
    expect(signedPoints(-0.0123)).toBe('−1.2 pp');
    expect(signedPoints(null)).toBe('—');
    expect(signedPer36(2.44)).toBe('+2.4');
    expect(signedPer36(-1.05)).toBe('−1.1');
    expect(signedPer36(null)).toBe('—');
  });

  it('never renders a negative zero', () => {
    expect(signedFixed(-0.0001, 2)).toBe('0.00');
    expect(signedFixed(0, 1)).toBe('0.0');
  });

  it('reports the sample and how much of the difference is applied', () => {
    expect(sampleLabel(row)).toBe('22 G · 922 min');
    expect(weightLabel(row)).toBe('83% of the measured difference');
  });

  it('reads pinned rows and identifies the status of a run', () => {
    const locked = { playoffPerformance: performance, human: { teamId: 't' } } as never;
    expect(capRushPlayoffRowFor(locked, row.playerVersionId)?.row).toEqual(row);
    expect(capRushPlayoffRowFor(locked, `pv-${'b'.repeat(32)}`)).toBeNull();
    expect(capRushPlayoffRowFor(locked, null)).toBeNull();
    expect(capRushPlayoffRowFor(null, row.playerVersionId)).toBeNull();
    expect(
      capRushPlayoffStatusOf({
        playoffFormulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
        stage: 'locked',
        locked,
      } as never),
    ).toBe('pending');
    expect(
      capRushPlayoffStatusOf({
        playoffFormulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
        stage: 'postseason',
        postseason: {},
        locked,
      } as never),
    ).toBe('active');
  });

  it('marks a pre-feature run as legacy so it never claims an adjustment', () => {
    const locked = { playoffPerformance: performance } as never;
    expect(capRushPlayoffStatusOf({ stage: 'postseason', postseason: {}, locked } as never)).toBe(
      'legacy',
    );
    expect(
      capRushPlayoffStatusOf({
        playoffFormulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
        stage: 'locked',
        locked: { human: {} },
      } as never),
    ).toBe('no-sample');
  });

  it('counts coverage against the roster it is given', () => {
    const locked = { playoffPerformance: performance } as never;
    expect(capRushPlayoffCoverage(locked, [row.playerVersionId, null, 'pv-unknown'])).toEqual({
      withEvidence: 1,
      total: 3,
    });
    expect(capRushPlayoffCoverage(null, [row.playerVersionId])).toEqual({
      withEvidence: 0,
      total: 1,
    });
  });
});
