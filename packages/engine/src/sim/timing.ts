import type { EraSimulationProfile } from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { ENGINE_CONSTANTS } from './constants.js';

/**
 * Era pace determines possession duration (spec/03). Both teams share the game
 * clock, so the mean trip length is 2880 / (2 * pace) seconds; trips sample
 * around that mean, clamped to the shot clock and the time remaining in the
 * period. Free throws consume additional clock so the pace target holds for
 * high-foul games too.
 */

/** Mean wall-clock seconds of one offensive trip for the era pace. */
export function meanTripSeconds(profile: EraSimulationProfile): number {
  const pace = profile.parameters.pace;
  return 2880 / (2 * pace);
}

/**
 * Samples the clock seconds one offensive trip consumes. Returns null when the
 * period has less than the minimum start time left (period ends without a trip).
 */
export function sampleTripSeconds(
  rng: Rng,
  profile: EraSimulationProfile,
  secondsRemaining: number,
): number | null {
  if (secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) return null;
  const mean = meanTripSeconds(profile);
  const raw = mean * (0.6 + rng.next() * 0.8);
  const clamped = Math.min(
    Math.max(raw, ENGINE_CONSTANTS.minimumTripSeconds),
    ENGINE_CONSTANTS.shotClockSeconds,
  );
  return Math.min(clamped, secondsRemaining);
}

/** Extra clock consumed by a free-throw trip. */
export function freeThrowSeconds(attempts: number): number {
  return attempts * ENGINE_CONSTANTS.secondsPerFreeThrow;
}
