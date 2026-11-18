import {
  LINEUP_STRUCTURE,
  POSITIONS,
  type Position,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { clamp } from '../domain/math.ts';
import { ENGINE_CONSTANTS, type PositionResponsibilityModifiers } from './constants.ts';
export function positionOfSlot(slot: number): Position {
  const position = LINEUP_STRUCTURE[slot];
  if (position === undefined) {
    throw new Error(`position-responsibilities: no position for slot ${String(slot)}`);
  }
  return position;
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
  const table = ENGINE_CONSTANTS.positionResponsibility[positionOfSlot(slot)];
  return boundResponsibilityModifiers(table, ENGINE_CONSTANTS.positionResponsibilityBound);
}
export function positionMatchWeight(
  defenderSlot: number,
  shooterSlot: number,
  interior = true,
): number {
  return defenderSlot === shooterSlot
    ? interior
      ? ENGINE_CONSTANTS.positionMatchBonus
      : ENGINE_CONSTANTS.perimeterMatchBonus
    : 1;
}

export function positionDefenseOf(ratings: Pick<SimulationRatings, 'speed'>, position: Position) {
  const responsibility = responsibilityModifiersForSlot(POSITIONS.indexOf(position));
  const perimeterExposure = position === 'C' ? 0 : position === 'PF' ? 0.25 : 1;
  const mobilityGap = clamp((75 - ratings.speed) / 100, 0, 0.25);
  return {
    rimHelpWeight: responsibility.rimProtection,
    perimeterContestScale: 1 - perimeterExposure * mobilityGap,
  };
}
