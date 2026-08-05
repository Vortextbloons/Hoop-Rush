import {
  SEASON_HOME_COURT_VERSION,
  SEASON_HOME_WIN_RATE_TARGET,
  type SeasonHomeCourtProfile,
} from '@hoop-rush/data-contracts';

/**
 * Season Run home-court profile and the two named bounded mechanisms
 * (spec/2.0/02, season-home-court-v1, M2.3). The advantage flows through
 * exactly two basketball mechanisms, never a general ratings multiplier:
 *
 * - `homeDefensiveCommunication`: improved home defensive communication
 *   reduces the away team's shot conversion (home defense contests).
 * - `awayTurnoverPressure`: additional pressure on the away team's offense
 *   increases its turnover probability.
 *
 * `SEASON_HOME_COURT_PROFILE` is the tuned engine constant, calibrated
 * against `SEASON_HOME_WIN_RATE_TARGET` (0.575) on a held-out cohort and
 * recorded as evidence in `apps/web/static/data/season/home-court-targets.json`
 * by `season home-court calibrate`. The neutral adapter (zero profile) leaves
 * every probability and RNG draw byte-identical to the M2.2 engine, so
 * Classic fixed-five games and neutral Season games never change.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Maximum make-probability reduction applied to away shots vs the home defense. */
export const SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT = 0.02;

/** Maximum turnover-probability increase applied to away possessions. */
export const SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT = 0.035;

/**
 * The tuned engine home-court profile (authoritative). The constants are
 * bounded in 0..1 and calibrated so a home-court Season game wins about
 * 57.5% of the time against an equal away roster.
 */
export const SEASON_HOME_COURT_PROFILE: SeasonHomeCourtProfile = {
  schemaVersion: 1,
  profileVersion: SEASON_HOME_COURT_VERSION,
  homeDefensiveCommunication: 0.55,
  awayTurnoverPressure: 0.5,
  targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
};

/**
 * Signed, bounded probability adjustments derived from a home-court profile.
 * Both are exactly zero for the neutral profile, so possession probabilities
 * and RNG draw sequences are byte-identical to the M2.2 engine.
 */
export interface SeasonHomeCourtMechanisms {
  /** Negative make-probability adjustment for away shots (home defense). */
  homeDefenseShotAdjustment: number;
  /** Positive turnover-probability adjustment for away possessions. */
  awayTurnoverPressureAdjustment: number;
}

/** Derives the two mechanism adjustments from a profile (pure, monotonic). */
export function seasonHomeCourtMechanisms(
  profile: SeasonHomeCourtProfile,
): SeasonHomeCourtMechanisms {
  const communication = profile.homeDefensiveCommunication;
  return {
    // The neutral profile must yield exactly +0 (never -0) so every
    // probability and JSON serialization stays byte-identical.
    homeDefenseShotAdjustment:
      communication === 0 ? 0 : -communication * SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT,
    awayTurnoverPressureAdjustment:
      profile.awayTurnoverPressure * SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT,
  };
}
