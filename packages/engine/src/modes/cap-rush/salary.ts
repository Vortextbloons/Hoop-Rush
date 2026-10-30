import type {
  CapRushPayrollStatus,
  CapRushPlayerProfile,
  SimulationRatings,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_FIRST_APRON_DOLLARS,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_MAX_OVERALL,
  CAP_RUSH_MIN_OVERALL,
  CAP_RUSH_SALARY_ANCHORS,
} from '@hoop-rush/data-contracts';

type RatingField = keyof SimulationRatings;

const FIRST_APRON_REDUCTIONS: Partial<Record<RatingField, number>> = {
  passing: 3,
  ballHandling: 2,
  offensiveIq: 3,
  defensiveIq: 3,
  perimeterDefense: 3,
  interiorDefense: 3,
  threePoint: 1,
  midrange: 1,
};

const SECOND_APRON_REDUCTIONS: Partial<Record<RatingField, number>> = {
  passing: 8,
  ballHandling: 5,
  offensiveIq: 7,
  defensiveIq: 7,
  perimeterDefense: 5,
  interiorDefense: 5,
  threePoint: 3,
  midrange: 3,
  insideScoring: 3,
  closeShot: 3,
  offensiveRebound: 2,
  defensiveRebound: 2,
};

function roundHalfUp(numerator: number, denominator: number): number {
  const whole = Math.floor(numerator / denominator);
  const remainder = numerator - whole * denominator;
  return remainder * 2 >= denominator ? whole + 1 : whole;
}

export function capRushSalaryThousands(overall: number): number {
  if (
    !Number.isInteger(overall) ||
    overall < CAP_RUSH_MIN_OVERALL ||
    overall > CAP_RUSH_MAX_OVERALL
  ) {
    throw new Error(
      `cap rush salary requires an integer overall in ${String(CAP_RUSH_MIN_OVERALL)}..${String(CAP_RUSH_MAX_OVERALL)} (got ${String(overall)})`,
    );
  }
  for (let index = 1; index < CAP_RUSH_SALARY_ANCHORS.length; index += 1) {
    const low = CAP_RUSH_SALARY_ANCHORS[index - 1];
    const high = CAP_RUSH_SALARY_ANCHORS[index];
    if (low === undefined || high === undefined) break;
    if (overall > high.overall) continue;
    const steps = overall - low.overall;
    const span = high.overall - low.overall;
    const rise = high.thousands - low.thousands;
    return low.thousands + roundHalfUp(steps * rise, span);
  }
  const last = CAP_RUSH_SALARY_ANCHORS[CAP_RUSH_SALARY_ANCHORS.length - 1];
  if (last === undefined) throw new Error('cap rush salary curve has no anchors');
  return last.thousands;
}

export function capRushSalaryDollars(overall: number, seasonKey: string): number {
  const year = Number(seasonKey.slice(0, 4));
  const eraPercent =
    year >= 1960 && year < 1970
      ? 80
      : year >= 1970 && year < 1980
        ? 90
        : year >= 1980 && year < 1990
          ? 95
          : 100;
  return roundHalfUp(capRushSalaryThousands(overall) * 115 * eraPercent, 10_000) * 1_000;
}

export function capRushPayrollStatus(payrollDollars: number): CapRushPayrollStatus {
  if (!Number.isInteger(payrollDollars) || payrollDollars < 0) {
    throw new Error(
      `cap rush payroll must be a nonnegative integer dollar amount (got ${String(payrollDollars)})`,
    );
  }
  if (payrollDollars <= CAP_RUSH_CAP_LINE_DOLLARS) return 'under-cap';
  if (payrollDollars <= CAP_RUSH_FIRST_APRON_DOLLARS) return 'first-apron';
  if (payrollDollars <= CAP_RUSH_HARD_LIMIT_DOLLARS) return 'second-apron';
  return 'illegal';
}

function reducedRatings(
  ratings: SimulationRatings,
  reductions: Partial<Record<RatingField, number>>,
): SimulationRatings {
  const next = { ...ratings };
  for (const key of Object.keys(reductions) as RatingField[]) {
    const reduction = reductions[key];
    if (reduction === undefined) continue;
    next[key] = Math.max(0, next[key] - reduction);
  }
  return next;
}

export function capRushEffectiveRatings(
  ratings: SimulationRatings,
  status: CapRushPayrollStatus,
): SimulationRatings {
  if (status === 'first-apron') return reducedRatings(ratings, FIRST_APRON_REDUCTIONS);
  if (status === 'second-apron') return reducedRatings(ratings, SECOND_APRON_REDUCTIONS);
  return { ...ratings };
}

export interface CapRushApronPreview {
  readonly firstApron: SimulationRatings;
  readonly secondApron: SimulationRatings;
}

export interface CapRushApronReduction {
  readonly field: RatingField;
  readonly reduction: number;
}

export function capRushApronReductions(
  status: CapRushPayrollStatus,
): readonly CapRushApronReduction[] {
  const table =
    status === 'first-apron'
      ? FIRST_APRON_REDUCTIONS
      : status === 'second-apron'
        ? SECOND_APRON_REDUCTIONS
        : null;
  if (table === null) return [];
  return (Object.keys(table) as RatingField[]).map((field) => ({
    field,
    reduction: table[field] ?? 0,
  }));
}

export function capRushApronPreview(profile: CapRushPlayerProfile): CapRushApronPreview {
  return {
    firstApron: capRushEffectiveRatings(profile.ratings, 'first-apron'),
    secondApron: capRushEffectiveRatings(profile.ratings, 'second-apron'),
  };
}
