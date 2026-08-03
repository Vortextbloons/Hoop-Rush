/**
 * Reviewed, versioned position override table keyed by NBA external player
 * ID (spec/02). The NBA API publishes one noisy primary label per season and
 * never publishes secondary positions, so the ratings pipeline compensates
 * with a height heuristic that stays; these corrections replace the source
 * label where review verified the API mislabels a known player (most often a
 * big listed as SF). Every ID below was confirmed against
 * raw-data/nba/{season}/roster.json before committing; corrections are frozen
 * under POSITION_OVERRIDES_VERSION so artifact rebuilds stay auditable.
 */
import { POSITION_OVERRIDES_VERSION, type Position } from '@hoop-rush/data-contracts';

export interface PositionOverride {
  primary: Position;
  secondary: Position[];
}

/** Reviewed position corrections (replace the noisy NBA API label). */
export const POSITION_OVERRIDES: Readonly<Record<string, PositionOverride>> = {
  // Victor Wembanyama: source lists SF; reviewed C with SF secondary.
  '1641705': { primary: 'C', secondary: ['SF'] },
  // Chet Holmgren: source lists SF; reviewed C with PF secondary.
  '1631096': { primary: 'C', secondary: ['PF'] },
  // Kristaps Porziņģis: source lists SF; reviewed C with PF secondary.
  '204001': { primary: 'C', secondary: ['PF'] },
  // Isaiah Hartenstein: source lists SF; reviewed C with PF secondary.
  '1628392': { primary: 'C', secondary: ['PF'] },
  // Anthony Davis: source lists SF; reviewed PF with C secondary.
  '203076': { primary: 'PF', secondary: ['C'] },
  // Bam Adebayo: source lists SF; reviewed C with PF secondary.
  '1628389': { primary: 'C', secondary: ['PF'] },
  // Domantas Sabonis: source lists SF; reviewed C with PF secondary.
  '1627734': { primary: 'C', secondary: ['PF'] },
  // Chris Webber: source lists SF; reviewed PF with C secondary.
  '185': { primary: 'PF', secondary: ['C'] },
  // Tim Duncan: source lists SF; reviewed PF with C secondary.
  '1495': { primary: 'PF', secondary: ['C'] },
  // Kevin McHale: source lists SF; reviewed PF with C secondary.
  '1450': { primary: 'PF', secondary: ['C'] },
  // Elden Campbell: source lists SF; reviewed C with PF secondary.
  '922': { primary: 'C', secondary: ['PF'] },
  // Roy Tarpley: source lists SF; reviewed C with PF secondary.
  '78293': { primary: 'C', secondary: ['PF'] },
};

/** The frozen version of the override table (bumps only by review). */
export const POSITION_OVERRIDES_TABLE_VERSION: string = POSITION_OVERRIDES_VERSION;

export function positionOverrideFor(playerExternalId: string): PositionOverride | null {
  return POSITION_OVERRIDES[playerExternalId] ?? null;
}
