import type { SeasonEffectsState } from '@hoop-rush/data-contracts';
import type { SeasonStaminaInput } from '@hoop-rush/data-contracts';
import { REGULATION_TOTAL_SECONDS } from '../sim/periods.ts';
export const SEASON_STAMINA_RATING_FLOOR = 45;
export const SEASON_STAMINA_RATING_CEIL = 95;
export const SEASON_STAMINA_RATING_PER_MPG = 1.25;
export const SEASON_STAMINA_BASIS_POINT_SCALE = 10000;
export const SEASON_STAMINA_ON_COURT_BASE = 120;
export const SEASON_STAMINA_OFF_COURT_BASE = 3;
export const SEASON_STAMINA_STINT_RAMP_START_SECONDS = 360;
export const SEASON_STAMINA_STINT_RAMP_END_SECONDS = 720;
export const SEASON_STAMINA_STINT_MULTIPLIER_MAX = 12500;
export const SEASON_STAMINA_ROLE_HANDLER_BP = 12;
export const SEASON_STAMINA_ROLE_DEFENDER_BP = 8;
export const SEASON_STAMINA_ROLE_REBOUND_BP = 2;
export const SEASON_STAMINA_HALFTIME_BASE_BP = 250;
export const SEASON_STAMINA_HALFTIME_PER_RATING_BP = 2;
export const SEASON_STAMINA_RECENT_LOAD_RETAIN = 60;
export const SEASON_STAMINA_RECENT_LOAD_SHARE = 40;
export const SEASON_STAMINA_RECENT_LOAD_MAX_FACTOR = 1.5;
export const SEASON_STAMINA_RECOVERY_DIVISOR = 4500;
export const SEASON_STAMINA_RECOVERY_PER_RATING = 20;
export function stintMultiplierBp(stintSeconds: number): number {
    if (stintSeconds <= SEASON_STAMINA_STINT_RAMP_START_SECONDS) {
        return 10000;
    }
    if (stintSeconds >= SEASON_STAMINA_STINT_RAMP_END_SECONDS) {
        return SEASON_STAMINA_STINT_MULTIPLIER_MAX;
    }
    const scaled = ((stintSeconds - SEASON_STAMINA_STINT_RAMP_START_SECONDS) *
        (SEASON_STAMINA_STINT_MULTIPLIER_MAX - 10000)) /
        (SEASON_STAMINA_STINT_RAMP_END_SECONDS - SEASON_STAMINA_STINT_RAMP_START_SECONDS);
    return 10000 + scaled;
}
export function onCourtFatigueBp(elapsedSeconds: number, rating: number, postIntervalStintSeconds: number, recentLoadBp: number): number {
    const multiplier = stintMultiplierBp(postIntervalStintSeconds);
    const loadFactor = 10000 + Math.round(0.5 * recentLoadBp);
    const scaled = elapsedSeconds * SEASON_STAMINA_ON_COURT_BASE * (110 - rating) * multiplier * loadFactor;
    return Math.round(scaled / 1000000000000);
}
export function offCourtRecoveryBp(elapsedSeconds: number, rating: number): number {
    return Math.round((elapsedSeconds * SEASON_STAMINA_OFF_COURT_BASE * (rating - 40)) / 10000);
}
export function halftimeRemovalBp(rating: number): number {
    return SEASON_STAMINA_HALFTIME_BASE_BP + SEASON_STAMINA_HALFTIME_PER_RATING_BP * rating;
}
export function regulationShareBp(regulationSeconds: number): number {
    return Math.round(Math.min(SEASON_STAMINA_BASIS_POINT_SCALE, (regulationSeconds / REGULATION_TOTAL_SECONDS) * 10000));
}
export function recentLoadAfterGame(previousLoadBp: number, regulationSeconds: number): number {
    const raw = (SEASON_STAMINA_RECENT_LOAD_RETAIN * previousLoadBp +
        SEASON_STAMINA_RECENT_LOAD_SHARE * regulationShareBp(regulationSeconds)) /
        100;
    return Math.round(Math.min(SEASON_STAMINA_BASIS_POINT_SCALE, Math.max(0, raw)));
}
export function applySeasonRecoveryTick(state: SeasonEffectsState, staminaByVersion: ReadonlyMap<string, number>): SeasonEffectsState {
    return {
        schemaVersion: state.schemaVersion,
        playerStates: state.playerStates.map((player) => {
            const rating = staminaByVersion.get(player.playerVersionId);
            if (rating === undefined) {
                throw new Error(`season stamina: no rating for ${player.playerVersionId} during the recovery tick`);
            }
            const factor = SEASON_STAMINA_RECOVERY_DIVISOR - SEASON_STAMINA_RECOVERY_PER_RATING * rating;
            const recovered = Math.max(0, Math.round((player.fatigueBasisPoints * factor) / SEASON_STAMINA_BASIS_POINT_SCALE));
            return {
                playerVersionId: player.playerVersionId,
                fatigueBasisPoints: Math.min(SEASON_STAMINA_BASIS_POINT_SCALE, recovered),
                recentLoadBasisPoints: player.recentLoadBasisPoints,
                lastCompletedRound: Math.min(82, player.lastCompletedRound + 1),
            };
        }),
        inactivePlayerStates: state.inactivePlayerStates,
        pairStates: state.pairStates,
        archivedPairs: state.archivedPairs,
    };
}
export const SEASON_EFFECTS_STATE_SCHEMA_VERSION = 1;
export function assertStaminaInputs(inputs: readonly SeasonStaminaInput[], label: string): void {
    for (const input of inputs) {
        if (input.rating < SEASON_STAMINA_RATING_FLOOR || input.rating > SEASON_STAMINA_RATING_CEIL) {
            throw new Error(`season stamina: ${label} ${input.playerVersionId} rating out of range`);
        }
    }
}
