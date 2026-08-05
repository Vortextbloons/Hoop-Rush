import type { EraSimulationProfile } from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';

/**
 * Era pace determines possession duration (spec/03). Both teams share the game
 * clock, so the mean trip length is 2880 / (2 * pace) seconds; trips sample
 * around that mean, clamped to the shot clock and the time remaining in the
 * period. Free throws consume additional clock so the pace target holds for
 * high-foul games too.
 *
 * The profile's `pace` is the league's possessions-per-game ESTIMATE (FGA +
 * 0.44*FTA - OReb + TOV from the packaged stints). That convention over-counts
 * real trips by the offensive-rebound continuation adjustment, so the engine
 * converts it to the trip rate it actually accounts for before deriving trip
 * duration. The conversion is a versioned engine constant re-checked by the
 * possessions-per-game calibration gate.
 */

/** Mean wall-clock seconds of one offensive trip for the era pace. */
export function meanTripSeconds(profile: EraSimulationProfile): number {
  const tripsPerTeamGame = profile.parameters.pace * ENGINE_CONSTANTS.estimateToTripsFactor;
  return Math.max(
    ENGINE_CONSTANTS.minimumTripSeconds,
    2880 / (2 * tripsPerTeamGame) - ENGINE_CONSTANTS.paceDeadBallAdjustment,
  );
}

/**
 * Samples the clock seconds one offensive trip consumes. Returns null when the
 * period has less than the minimum start time left (period ends without a trip).
 * `mean` is the hoisted meanTripSeconds(profile) so the per-game scalar is
 * computed once instead of once per trip.
 */
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
