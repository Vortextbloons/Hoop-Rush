import { POSITION_OVERRIDES_VERSION, type Position } from '@hoop-rush/data-contracts';

export interface PositionOverride {
  primary: Position;
  secondary: Position[];
}

export const POSITION_OVERRIDES: Readonly<Record<string, PositionOverride>> = {
  '1641705': { primary: 'C', secondary: ['SF'] },

  '1631096': { primary: 'C', secondary: ['PF'] },

  '204001': { primary: 'C', secondary: ['PF'] },

  '1628392': { primary: 'C', secondary: ['PF'] },

  '203076': { primary: 'PF', secondary: ['C'] },

  '1628389': { primary: 'C', secondary: ['PF'] },

  '1627734': { primary: 'C', secondary: ['PF'] },

  '185': { primary: 'PF', secondary: ['C'] },

  '1495': { primary: 'PF', secondary: ['C'] },

  '1450': { primary: 'PF', secondary: ['C'] },

  '922': { primary: 'C', secondary: ['PF'] },

  '78293': { primary: 'C', secondary: ['PF'] },
};

export const POSITION_OVERRIDES_TABLE_VERSION: string = POSITION_OVERRIDES_VERSION;

export function positionOverrideFor(playerExternalId: string): PositionOverride | null {
  return POSITION_OVERRIDES[playerExternalId] ?? null;
}
