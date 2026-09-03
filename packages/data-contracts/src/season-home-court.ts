import { z } from 'zod';
import { SEASON_HOME_COURT_VERSION, SEASON_HOME_WIN_RATE_TARGET } from './season-versions.ts';
export const seasonHomeCourtProfileSchema = z.object({
    schemaVersion: z.literal(1),
    profileVersion: z.literal(SEASON_HOME_COURT_VERSION),
    homeDefensiveCommunication: z.number().min(0).max(1),
    awayTurnoverPressure: z.number().min(0).max(1),
    targetHomeWinRate: z.literal(SEASON_HOME_WIN_RATE_TARGET),
});
export type SeasonHomeCourtProfile = z.infer<typeof seasonHomeCourtProfileSchema>;
export const SEASON_NEUTRAL_HOME_COURT: SeasonHomeCourtProfile = {
    schemaVersion: 1,
    profileVersion: SEASON_HOME_COURT_VERSION,
    homeDefensiveCommunication: 0,
    awayTurnoverPressure: 0,
    targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
};
