import type { SeasonEffectsState } from '@hoop-rush/data-contracts';
import type { SeasonStaminaInput } from '@hoop-rush/data-contracts';

/**
 * M2.4 stamina derivation and fixed-point fatigue transitions
 * (spec/2.0/04, season-stamina-v1). Stamina ratings are derived once at
 * catalog-build time from the selected historical season; every fatigue
 * calculation below runs on integer basis points (0..10,000) and rounds
 * exactly once at each state boundary.
 *
 * ## Between-game recovery tick
 *
 * One deterministic recovery interval precedes every game except the
 * season's first (abstract schedule rounds provide no calendar, so M2.4
 * defines exactly one recovery tick between consecutive games). The tick
 * removes `fatigue x (4500 - 20 x staminaRating) / 10000` basis points from
 * every positive fatigue state and advances `lastCompletedRound` by one.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Stamina rating formula constant (historical MPG -> 45..95). */
export const SEASON_STAMINA_RATING_FLOOR = 45;
export const SEASON_STAMINA_RATING_CEIL = 95;
export const SEASON_STAMINA_RATING_PER_MPG = 1.25;

/** Historical MPG cap used by the derivation (60 minutes). */
export const SEASON_STAMINA_HISTORICAL_MPG_CAP = 60;

/**
 * Derives the stamina rating from a recorded historical season:
 * `45 + 1.25 x historicalMpg`, rounded and clamped to 45..95. The exact
 * catalog formula; `historicalMpg` must already be `minutes / gamesPlayed`.
 */
export function staminaRatingFromMpg(historicalMpg: number): number {
  const raw = SEASON_STAMINA_RATING_FLOOR + SEASON_STAMINA_RATING_PER_MPG * historicalMpg;
  return Math.round(
    Math.min(SEASON_STAMINA_RATING_CEIL, Math.max(SEASON_STAMINA_RATING_FLOOR, raw)),
  );
}

/** Historical MPG from recorded minutes and games played (guarded). */
export function historicalMpgOf(minutes: number | null, gamesPlayed: number | null): number {
  const gp = Math.max(1, gamesPlayed ?? 0);
  return Math.min(SEASON_STAMINA_HISTORICAL_MPG_CAP, (minutes ?? 0) / gp);
}

/** Basis-point scale (10,000 = 100%). */
export const SEASON_STAMINA_BASIS_POINT_SCALE = 10_000;

/** On-court accumulation constant A (bp per second at rating floor spacing). */
export const SEASON_STAMINA_ON_COURT_BASE = 120;

/** Off-court recovery constant B (bp per second). */
export const SEASON_STAMINA_OFF_COURT_BASE = 3;

/** Consecutive-stint ramp begins after 6 uninterrupted minutes. */
export const SEASON_STAMINA_STINT_RAMP_START_SECONDS = 360;

/** Consecutive-stint ramp reaches its max after 12 uninterrupted minutes. */
export const SEASON_STAMINA_STINT_RAMP_END_SECONDS = 720;

/** Maximum consecutive-stint multiplier (1.25x on the 10,000 scale). */
export const SEASON_STAMINA_STINT_MULTIPLIER_MAX = 12_500;

/** Role bonus: handler or shooter, basis points per completed trip. */
export const SEASON_STAMINA_ROLE_HANDLER_BP = 12;

/** Role bonus: primary defender, basis points per completed trip. */
export const SEASON_STAMINA_ROLE_DEFENDER_BP = 8;

/** Role bonus: rebound-contest participation, basis points per contest. */
export const SEASON_STAMINA_ROLE_REBOUND_BP = 2;

/** Halftime recovery: `SEASON_STAMINA_HALFTIME_BASE + SEASON_STAMINA_HALFTIME_PER_RATING x rating` bp. */
export const SEASON_STAMINA_HALFTIME_BASE_BP = 250;
export const SEASON_STAMINA_HALFTIME_PER_RATING_BP = 2;

/** Postgame recent-load update: 60% previous + 40% regulation share. */
export const SEASON_STAMINA_RECENT_LOAD_RETAIN = 60;
export const SEASON_STAMINA_RECENT_LOAD_SHARE = 40;

/** Recent load raises the next game's accumulation by up to 50%. */
export const SEASON_STAMINA_RECENT_LOAD_MAX_FACTOR = 1.5;

/** Recovery tick formula constants. */
export const SEASON_STAMINA_RECOVERY_DIVISOR = 4500;
export const SEASON_STAMINA_RECOVERY_PER_RATING = 20;

/**
 * Consecutive-stint multiplier on the 10,000 scale: 10,000 below six
 * minutes, linear 10,000 -> 12,500 between six and twelve minutes, 12,500
 * at/above twelve minutes.
 */
export function stintMultiplierBp(stintSeconds: number): number {
  if (stintSeconds <= SEASON_STAMINA_STINT_RAMP_START_SECONDS) {
    return 10_000;
  }
  if (stintSeconds >= SEASON_STAMINA_STINT_RAMP_END_SECONDS) {
    return SEASON_STAMINA_STINT_MULTIPLIER_MAX;
  }
  const scaled =
    ((stintSeconds - SEASON_STAMINA_STINT_RAMP_START_SECONDS) *
      (SEASON_STAMINA_STINT_MULTIPLIER_MAX - 10_000)) /
    (SEASON_STAMINA_STINT_RAMP_END_SECONDS - SEASON_STAMINA_STINT_RAMP_START_SECONDS);
  return 10_000 + scaled;
}

/**
 * On-court fatigue accumulation for one stint interval, in basis points:
 * `elapsed x A x (110 - rating) / 10000` scaled by the consecutive-stint
 * multiplier (based on the stint duration AFTER this interval) and the
 * player's recent-load factor `1 + 0.5 x recentLoad/10000`. Rounds once.
 */
export function onCourtFatigueBp(
  elapsedSeconds: number,
  rating: number,
  postIntervalStintSeconds: number,
  recentLoadBp: number,
): number {
  const multiplier = stintMultiplierBp(postIntervalStintSeconds);
  const loadFactor = 10_000 + Math.round(0.5 * recentLoadBp);
  const scaled =
    elapsedSeconds * SEASON_STAMINA_ON_COURT_BASE * (110 - rating) * multiplier * loadFactor;
  return Math.round(scaled / 1_000_000_000_000);
}

/**
 * Off-court recovery for one stint interval, in basis points:
 * `elapsed x B x (rating - 40) / 10000`. The caller clamps the resulting
 * fatigue at zero.
 */
export function offCourtRecoveryBp(elapsedSeconds: number, rating: number): number {
  return Math.round((elapsedSeconds * SEASON_STAMINA_OFF_COURT_BASE * (rating - 40)) / 10_000);
}

/** Halftime fatigue removal for one player (clamped at zero by the caller). */
export function halftimeRemovalBp(rating: number): number {
  return SEASON_STAMINA_HALFTIME_BASE_BP + SEASON_STAMINA_HALFTIME_PER_RATING_BP * rating;
}

/**
 * Regulation-minute share as basis points: `regulationSeconds / 2880`,
 * rounded, clamped to 0..10,000.
 */
export function regulationShareBp(regulationSeconds: number): number {
  return Math.round(
    Math.min(SEASON_STAMINA_BASIS_POINT_SCALE, (regulationSeconds / 2880) * 10_000),
  );
}

/**
 * Postgame recent load, in basis points: 60% of the previous load plus 40%
 * of the regulation-minute share. Rounds once and clamps to 0..10,000.
 */
export function recentLoadAfterGame(previousLoadBp: number, regulationSeconds: number): number {
  const raw =
    (SEASON_STAMINA_RECENT_LOAD_RETAIN * previousLoadBp +
      SEASON_STAMINA_RECENT_LOAD_SHARE * regulationShareBp(regulationSeconds)) /
    100;
  return Math.round(Math.min(SEASON_STAMINA_BASIS_POINT_SCALE, Math.max(0, raw)));
}

/**
 * One deterministic between-game recovery tick: `fatigue x (4500 - 20 x
 * rating) / 10000`, rounded, clamped at zero, for every player; advances
 * every player's `lastCompletedRound` by one (capped at 82). Recent load is
 * untouched. `staminaByVersion` must cover every player in the state.
 */
export function applySeasonRecoveryTick(
  state: SeasonEffectsState,
  staminaByVersion: ReadonlyMap<string, number>,
): SeasonEffectsState {
  return {
    schemaVersion: state.schemaVersion,
    playerStates: state.playerStates.map((player) => {
      const rating = staminaByVersion.get(player.playerVersionId);
      if (rating === undefined) {
        throw new Error(
          `season stamina: no rating for ${player.playerVersionId} during the recovery tick`,
        );
      }
      const factor = SEASON_STAMINA_RECOVERY_DIVISOR - SEASON_STAMINA_RECOVERY_PER_RATING * rating;
      const recovered = Math.max(
        0,
        Math.round((player.fatigueBasisPoints * factor) / SEASON_STAMINA_BASIS_POINT_SCALE),
      );
      return {
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints: Math.min(SEASON_STAMINA_BASIS_POINT_SCALE, recovered),
        recentLoadBasisPoints: player.recentLoadBasisPoints,
        lastCompletedRound: Math.min(82, player.lastCompletedRound + 1),
      };
    }),
    pairStates: state.pairStates,
  };
}

/** Stability anchor used by chemistry (see chemistry.ts). */
export const SEASON_EFFECTS_STATE_SCHEMA_VERSION = 1;

/** Type guard: every input carries a rating in the derived 45..95 range. */
export function assertStaminaInputs(inputs: readonly SeasonStaminaInput[], label: string): void {
  for (const input of inputs) {
    if (input.rating < SEASON_STAMINA_RATING_FLOOR || input.rating > SEASON_STAMINA_RATING_CEIL) {
      throw new Error(`season stamina: ${label} ${input.playerVersionId} rating out of range`);
    }
  }
}
