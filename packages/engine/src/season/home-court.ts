import {
  SEASON_HOME_COURT_VERSION,
  SEASON_HOME_WIN_RATE_TARGET,
  type SeasonHomeCourtProfile,
} from '@hoop-rush/data-contracts';
export const SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT = 0.02;
export const SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT = 0.035;
export const SEASON_HOME_COURT_PROFILE: SeasonHomeCourtProfile = {
  schemaVersion: 1,
  profileVersion: SEASON_HOME_COURT_VERSION,
  homeDefensiveCommunication: 0.55,
  awayTurnoverPressure: 0.5,
  targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
};
export interface SeasonHomeCourtMechanisms {
  homeDefenseShotAdjustment: number;
  awayTurnoverPressureAdjustment: number;
}
export function seasonHomeCourtMechanisms(
  profile: SeasonHomeCourtProfile,
): SeasonHomeCourtMechanisms {
  const communication = profile.homeDefensiveCommunication;
  return {
    homeDefenseShotAdjustment:
      communication === 0 ? 0 : -communication * SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT,
    awayTurnoverPressureAdjustment:
      profile.awayTurnoverPressure * SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT,
  };
}
