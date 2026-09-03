import type { Rng } from './rng.ts';
export const REGULATION_PERIOD_SECONDS = 720;
export const OVERTIME_PERIOD_SECONDS = 300;
export const REGULATION_TOTAL_SECONDS = 4 * REGULATION_PERIOD_SECONDS;
export const HALFTIME_SECOND = 2 * REGULATION_PERIOD_SECONDS;
export const MAX_PERIODS = 12;
export const MAX_PERIODS_HARD_CAP = 30;
export function overtimePeriodsOf(periodPointsLength: number): number {
  return Math.max(0, periodPointsLength - 4);
}
export function resolveGameWinner(homeScore: number, awayScore: number, rng: Rng): 'home' | 'away' {
  if (homeScore !== awayScore) {
    return homeScore > awayScore ? 'home' : 'away';
  }
  return rng.chance(0.5) ? 'home' : 'away';
}
export function assertUntiedGame(homeScore: number, awayScore: number): void {
  if (homeScore === awayScore) {
    throw new Error(
      `simulation: game ended tied ${String(homeScore)}-${String(awayScore)} after exhausting overtime`,
    );
  }
}
