import type { HavocPhysicalSnapshot, Position } from '@hoop-rush/data-contracts';
import { HAVOC_ESTIMATED_HEIGHT_BY_SLOT } from '@hoop-rush/data-contracts';

export const HAVOC_EFFECTIVE_HEIGHT_MIN = 50;
export const HAVOC_EFFECTIVE_HEIGHT_MAX = 108;
export const HAVOC_MAX_WINGSPAN_DELTA_INCHES = 36;
export const HAVOC_MAX_REACH_UNITS = 2;

export interface HavocBaselineHeight {
  readonly baselineHeightInches: number;
  readonly baselineHeightSource: 'source' | 'estimated';
}

export function havocBaselineHeightInches(
  physical: HavocPhysicalSnapshot,
  slot: Position,
): HavocBaselineHeight {
  if (physical.heightInches !== null) {
    return { baselineHeightInches: physical.heightInches, baselineHeightSource: 'source' };
  }
  return {
    baselineHeightInches: HAVOC_ESTIMATED_HEIGHT_BY_SLOT[slot],
    baselineHeightSource: 'estimated',
  };
}

export function clampHavocEffectiveHeight(inches: number): number {
  return Math.min(HAVOC_EFFECTIVE_HEIGHT_MAX, Math.max(HAVOC_EFFECTIVE_HEIGHT_MIN, inches));
}

export function clampHavocWingspanDelta(inches: number): number {
  return Math.min(HAVOC_MAX_WINGSPAN_DELTA_INCHES, Math.max(0, inches));
}

export function havocReachUnits(heightDeltaInches: number, wingspanDeltaInches: number): number {
  const raw = (heightDeltaInches + wingspanDeltaInches / 2) / 12;
  return Math.min(HAVOC_MAX_REACH_UNITS, Math.max(-HAVOC_MAX_REACH_UNITS, raw));
}
