import { describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_FIRST_APRON_DOLLARS,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_SALARY_ANCHORS,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
} from '@hoop-rush/data-contracts';
import {
  capRushApronPreview,
  capRushEffectiveRatings,
  capRushPayrollStatus,
  capRushSalaryDollars,
  capRushSalaryThousands,
} from './salary.ts';

describe('cap rush salary curve', () => {
  it('matches every supplied anchor exactly', () => {
    for (const anchor of CAP_RUSH_SALARY_ANCHORS) {
      expect(capRushSalaryThousands(anchor.overall)).toBe(anchor.thousands);
      expect(capRushSalaryDollars(anchor.overall)).toBe(anchor.thousands * 1_000);
    }
  });

  it('interpolates and rounds half up in integer thousands', () => {
    expect(capRushSalaryDollars(76)).toBe(9_000_000);
    expect(capRushSalaryDollars(86)).toBe(22_000_000);
    expect(capRushSalaryDollars(96)).toBe(50_667_000);
    expect(capRushSalaryDollars(97)).toBe(55_333_000);
  });

  it('is strictly monotone across the draft range', () => {
    for (let overall = 60; overall < 99; overall += 1) {
      expect(capRushSalaryThousands(overall + 1)).toBeGreaterThan(capRushSalaryThousands(overall));
    }
  });

  it('rejects overalls outside the draft range', () => {
    expect(() => capRushSalaryThousands(59)).toThrow();
    expect(() => capRushSalaryThousands(100)).toThrow();
    expect(() => capRushSalaryThousands(80.5)).toThrow();
  });
});

describe('cap rush payroll boundaries', () => {
  it('uses continuous apron thresholds', () => {
    expect(capRushPayrollStatus(CAP_RUSH_CAP_LINE_DOLLARS)).toBe('under-cap');
    expect(capRushPayrollStatus(CAP_RUSH_CAP_LINE_DOLLARS + 1)).toBe('first-apron');
    expect(capRushPayrollStatus(CAP_RUSH_FIRST_APRON_DOLLARS)).toBe('first-apron');
    expect(capRushPayrollStatus(CAP_RUSH_FIRST_APRON_DOLLARS + 1)).toBe('second-apron');
    expect(capRushPayrollStatus(CAP_RUSH_HARD_LIMIT_DOLLARS)).toBe('second-apron');
    expect(capRushPayrollStatus(CAP_RUSH_HARD_LIMIT_DOLLARS + 1)).toBe('illegal');
  });

  it('rejects fractional and negative payrolls', () => {
    expect(() => capRushPayrollStatus(-1)).toThrow();
    expect(() => capRushPayrollStatus(1.5)).toThrow();
  });
});

describe('cap rush apron ratings', () => {
  it('applies the first-apron table once from original ratings', () => {
    const reduced = capRushEffectiveRatings(SIMULATION_RATINGS, 'first-apron');
    expect(reduced.passing).toBe(SIMULATION_RATINGS.passing - 5);
    expect(reduced.ballHandling).toBe(SIMULATION_RATINGS.ballHandling - 3);
    expect(reduced.offensiveIq).toBe(SIMULATION_RATINGS.offensiveIq - 5);
    expect(reduced.defensiveIq).toBe(SIMULATION_RATINGS.defensiveIq - 5);
    expect(reduced.perimeterDefense).toBe(SIMULATION_RATINGS.perimeterDefense - 4);
    expect(reduced.interiorDefense).toBe(SIMULATION_RATINGS.interiorDefense - 4);
    expect(reduced.threePoint).toBe(SIMULATION_RATINGS.threePoint - 2);
    expect(reduced.midrange).toBe(SIMULATION_RATINGS.midrange - 2);
    expect(reduced.insideScoring).toBe(SIMULATION_RATINGS.insideScoring);
    expect(reduced.offensiveRebound).toBe(SIMULATION_RATINGS.offensiveRebound);
  });

  it('replaces first-apron effects with the second-apron table', () => {
    const reduced = capRushEffectiveRatings(SIMULATION_RATINGS, 'second-apron');
    expect(reduced.passing).toBe(SIMULATION_RATINGS.passing - 12);
    expect(reduced.ballHandling).toBe(SIMULATION_RATINGS.ballHandling - 9);
    expect(reduced.insideScoring).toBe(SIMULATION_RATINGS.insideScoring - 4);
    expect(reduced.closeShot).toBe(SIMULATION_RATINGS.closeShot - 4);
    expect(reduced.offensiveRebound).toBe(SIMULATION_RATINGS.offensiveRebound - 4);
    expect(reduced.defensiveRebound).toBe(SIMULATION_RATINGS.defensiveRebound - 4);
  });

  it('leaves ratings untouched under the cap', () => {
    expect(capRushEffectiveRatings(SIMULATION_RATINGS, 'under-cap')).toEqual(SIMULATION_RATINGS);
  });

  it('floors reduced ratings at zero', () => {
    const ratings = {
      ...SIMULATION_RATINGS,
      passing: 4,
      ballHandling: 2,
      threePoint: 3,
    };
    const reduced = capRushEffectiveRatings(ratings, 'second-apron');
    expect(reduced.passing).toBe(0);
    expect(reduced.ballHandling).toBe(0);
    expect(reduced.threePoint).toBe(0);
  });

  it('previews both aprons without mutating the original', () => {
    const profile = {
      ratings: { ...SIMULATION_RATINGS },
      tendencies: { ...SIMULATION_TENDENCIES },
    };
    const preview = capRushApronPreview(profile);
    expect(preview.firstApron.passing).toBe(SIMULATION_RATINGS.passing - 5);
    expect(preview.secondApron.passing).toBe(SIMULATION_RATINGS.passing - 12);
    expect(profile.ratings.passing).toBe(SIMULATION_RATINGS.passing);
  });
});
