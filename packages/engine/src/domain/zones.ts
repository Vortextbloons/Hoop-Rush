import type { ShotZone } from '@hoop-rush/data-contracts';

/** Frozen ordered list of shot zones (spec/03). */
export const SHOT_ZONES: readonly ShotZone[] = [
  'rim',
  'shortMid',
  'longMid',
  'cornerThree',
  'aboveBreakThree',
];
