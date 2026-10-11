import type { EraSimulationProfile } from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';

export const REGULATION_PERIOD_SECONDS = 720;
export const OVERTIME_PERIOD_SECONDS = 300;
export const REGULATION_TOTAL_SECONDS = 4 * REGULATION_PERIOD_SECONDS;
export const HALFTIME_SECOND = 2 * REGULATION_PERIOD_SECONDS;
export const MAX_PERIODS_HARD_CAP = 30;
export function overtimePeriodsOf(periodPointsLength: number): number {
  return Math.max(0, periodPointsLength - 4);
}
export function meanTripSeconds(profile: EraSimulationProfile): number {
  const tripsPerTeamGame = profile.parameters.pace * ENGINE_CONSTANTS.estimateToTripsFactor;
  return Math.max(
    ENGINE_CONSTANTS.minimumTripSeconds,
    REGULATION_TOTAL_SECONDS / (2 * tripsPerTeamGame),
  );
}
export function sampleTripSeconds(
  rng: Rng,
  profile: EraSimulationProfile,
  secondsRemaining: number,
  mean: number = meanTripSeconds(profile),
): number | null {
  if (secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) return null;
  const raw = mean * (0.6 + rng.next() * 0.8);
  const clamped = Math.min(
    Math.max(raw, ENGINE_CONSTANTS.minimumTripSeconds),
    ENGINE_CONSTANTS.shotClockSeconds,
  );
  return Math.min(clamped, secondsRemaining);
}
