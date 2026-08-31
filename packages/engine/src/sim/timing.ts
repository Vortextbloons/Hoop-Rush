import type { EraSimulationProfile } from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { REGULATION_TOTAL_SECONDS } from './periods.ts';
export function meanTripSeconds(profile: EraSimulationProfile): number {
  const tripsPerTeamGame = profile.parameters.pace * ENGINE_CONSTANTS.estimateToTripsFactor;
  return Math.max(
    ENGINE_CONSTANTS.minimumTripSeconds,
    REGULATION_TOTAL_SECONDS / (2 * tripsPerTeamGame) - ENGINE_CONSTANTS.paceDeadBallAdjustment,
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
