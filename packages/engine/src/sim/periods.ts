import type { Rng } from './rng.ts';

/**
 * Shared period/overtime/winner rules (spec/03, spec/2.0/04 M2.2). Classic
 * (`sim/game.ts`) and Season (`season/season-game.ts`) drive the same
 * constants and tie-break semantics, so this module is the single source of
 * the determinism-critical period rules.
 */

/** Regulation period length in seconds (four 12-minute periods). */
export const REGULATION_PERIOD_SECONDS = 720;
/** Overtime period length in seconds (repeating five-minute periods). */
export const OVERTIME_PERIOD_SECONDS = 300;
/** Hard period cap: 4 regulation + up to 8 overtime. */
export const MAX_PERIODS = 12;

/**
 * Overtime periods played, derived from the recorded per-period points
 * (`periodPoints` length: 4 regulation entries plus one per overtime).
 */
export function overtimePeriodsOf(periodPointsLength: number): number {
  return Math.max(0, periodPointsLength - 4);
}

/**
 * Resolves the game winner. A tie after the period cap is a pathological
 * guard; the seeded draw decides (identical to the Classic fixed-five path).
 */
export function resolveGameWinner(homeScore: number, awayScore: number, rng: Rng): 'home' | 'away' {
  return homeScore > awayScore
    ? 'home'
    : awayScore > homeScore
      ? 'away'
      : rng.chance(0.5)
        ? 'home'
        : 'away';
}
