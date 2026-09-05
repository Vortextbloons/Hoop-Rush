export const REGULATION_PERIOD_SECONDS = 720;
export const OVERTIME_PERIOD_SECONDS = 300;
export const REGULATION_TOTAL_SECONDS = 4 * REGULATION_PERIOD_SECONDS;
export const HALFTIME_SECOND = 2 * REGULATION_PERIOD_SECONDS;
export const MAX_PERIODS_HARD_CAP = 30;
export function overtimePeriodsOf(periodPointsLength: number): number {
  return Math.max(0, periodPointsLength - 4);
}
