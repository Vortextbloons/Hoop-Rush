import { LINEUP_STRUCTURE, type SlotGroup } from '@hoop-rush/data-contracts';
import { clamp } from '../domain/math.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
export interface PositionResponsibilityModifiers {
  initiation: number;
  pnrHandler: number;
  rollMan: number;
  postUp: number;
  rebounding: number;
  rimProtection: number;
}
export function slotGroupOfSlot(slot: number): SlotGroup {
  const group = LINEUP_STRUCTURE[slot];
  if (group === undefined) {
    throw new Error(`position-responsibilities: no slot group for slot ${String(slot)}`);
  }
  return group;
}
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
export function responsibilityModifiersForSlot(slot: number): PositionResponsibilityModifiers {
  const table = ENGINE_CONSTANTS.positionResponsibility[slotGroupOfSlot(slot)];
  return boundResponsibilityModifiers(table, ENGINE_CONSTANTS.positionResponsibilityBound);
}
export function sameGroupMatchWeight(defenderSlot: number, shooterSlot: number): number {
  return slotGroupOfSlot(defenderSlot) === slotGroupOfSlot(shooterSlot)
    ? ENGINE_CONSTANTS.positionMatchBonus
    : 1;
}
