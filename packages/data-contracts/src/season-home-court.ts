import { z } from 'zod';
import { SEASON_HOME_COURT_VERSION, SEASON_HOME_WIN_RATE_TARGET } from './season-versions.ts';

/**
 * Season Run home-court profile (spec/2.0/02 home court, M2.3,
 * season-home-court-v1). The advantage works through exactly two named,
 * bounded basketball mechanisms — modestly improved home defensive
 * communication and modest additional away-team turnover pressure. It is
 * never a general ratings multiplier. The neutral adapter is the zero
 * profile; Classic fixed-five games use the neutral adapter and remain
 * byte-identical to the M2.2 engine.
 */

export const seasonHomeCourtProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileVersion: z.literal(SEASON_HOME_COURT_VERSION),
  /** Bounded strength of improved home defensive communication (0..1). */
  homeDefensiveCommunication: z.number().min(0).max(1),
  /** Bounded strength of additional away-team turnover pressure (0..1). */
  awayTurnoverPressure: z.number().min(0).max(1),
  /** Frozen held-out calibration target (0.575 = 57.5% home win rate). */
  targetHomeWinRate: z.literal(SEASON_HOME_WIN_RATE_TARGET),
});
export type SeasonHomeCourtProfile = z.infer<typeof seasonHomeCourtProfileSchema>;

/** Neutral adapter: no home advantage. Classic fixed-five games use this. */
export const SEASON_NEUTRAL_HOME_COURT: SeasonHomeCourtProfile = {
  schemaVersion: 1,
  profileVersion: SEASON_HOME_COURT_VERSION,
  homeDefensiveCommunication: 0,
  awayTurnoverPressure: 0,
  targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
};
