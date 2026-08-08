import { LINEUP_STRUCTURE, type SlotGroup } from '@hoop-rush/data-contracts';
import { clamp } from '../domain/math.ts';
import { ENGINE_CONSTANTS } from './constants.ts';

/**
 * Assigned-position responsibility modifiers (spec/03, m3-engine-v9).
 *
 * A player's assigned slot (the `players` array index, following the fixed
 * G/G/F/F/C lineup structure) is the one position source in possession
 * decision-making. Each slot group carries a bounded multiplier table applied
 * only to responsibility weights: initiation, P&R handler, roll man, post-up,
 * rebounding, and rim protection. Shooting, passing, turnover, contest,
 * block, defense-rating, overall-rating, anchor, and physical-attribute
 * formulas are untouched. Every coefficient is strictly positive, so a zero
 * tendency can never be manufactured into an action by position alone.
 *
 * All values are pure functions of the player snapshots, slot index, and the
 * versioned constants, so precomputing them once per game in `prepareTeam`
 * leaves the RNG draw sequence untouched.
 */

export interface PositionResponsibilityModifiers {
  /** Multiplier on possession initiator weights. */
  initiation: number;
  /** Multiplier on pick-and-roll ball-handler action weights. */
  pnrHandler: number;
  /** Multiplier on roll-man action weights and roll-man teammate selection. */
  rollMan: number;
  /** Multiplier on post-up action weights. */
  postUp: number;
  /** Multiplier on offensive and defensive rebound attribution weights. */
  rebounding: number;
  /** Multiplier on interior (rim/short-mid) defender selection weight. */
  rimProtection: number;
}

/** Assigned slot group for a slot index, from the fixed lineup structure. */
export function slotGroupOfSlot(slot: number): SlotGroup {
  const group = LINEUP_STRUCTURE[slot];
  if (group === undefined) {
    throw new Error(`position-responsibilities: no slot group for slot ${String(slot)}`);
  }
  return group;
}

/** Clamps every responsibility coefficient to the bounded band around 1. */
export function boundResponsibilityModifiers(
  modifiers: PositionResponsibilityModifiers,
  bound: number,
): PositionResponsibilityModifiers {
  const clamped = (value: number): number => clamp(value, 1 - bound, 1 + bound);
  return {
    initiation: clamped(modifiers.initiation),
    pnrHandler: clamped(modifiers.pnrHandler),
    rollMan: clamped(modifiers.rollMan),
    postUp: clamped(modifiers.postUp),
    rebounding: clamped(modifiers.rebounding),
    rimProtection: clamped(modifiers.rimProtection),
  };
}

/** Versioned responsibility modifiers for an assigned slot (slot index only). */
export function responsibilityModifiersForSlot(slot: number): PositionResponsibilityModifiers {
  const table = ENGINE_CONSTANTS.positionResponsibility[slotGroupOfSlot(slot)];
  return boundResponsibilityModifiers(table, ENGINE_CONSTANTS.positionResponsibilityBound);
}

/**
 * Same-group matchup weight for defender selection: 1.35 when the defender's
 * assigned slot group matches the shooter's assigned slot group, else 1. The
 * match is decided by assigned slots, never by native position unions.
 */
export function sameGroupMatchWeight(defenderSlot: number, shooterSlot: number): number {
  return slotGroupOfSlot(defenderSlot) === slotGroupOfSlot(shooterSlot)
    ? ENGINE_CONSTANTS.positionMatchBonus
    : 1;
}
