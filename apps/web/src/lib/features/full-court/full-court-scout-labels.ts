import type { SimulationRatings, SimulationTendencies } from '@hoop-rush/data-contracts';

export type ScoutField = keyof SimulationRatings | keyof SimulationTendencies;

const RATING_LABELS: Readonly<Record<keyof SimulationRatings, string>> = {
  insideScoring: 'Inside',
  closeShot: 'Close',
  midrange: 'Midrange',
  threePoint: 'Three',
  freeThrow: 'Free throw',
  ballHandling: 'Handle',
  passing: 'Passing',
  offensiveIq: 'Off. IQ',
  offensiveRebound: 'Off. reb',
  defensiveRebound: 'Def. reb',
  perimeterDefense: 'Perimeter',
  interiorDefense: 'Interior',
  steal: 'Steal',
  block: 'Block',
  defensiveIq: 'Def. IQ',
  speed: 'Speed',
  strength: 'Strength',
  vertical: 'Vertical',
};

const TENDENCY_LABELS: Readonly<Record<keyof SimulationTendencies, string>> = {
  usageRate: 'Usage',
  passRate: 'Pass rate',
  shotRate: 'Shot rate',
  driveRate: 'Drive rate',
  postUpRate: 'Post-up',
  rimFrequency: 'Rim',
  shortMidFrequency: 'Short mid',
  longMidFrequency: 'Long mid',
  cornerThreeFrequency: 'Corner 3',
  aboveBreakThreeFrequency: 'Above break',
  threePointRate: 'Three rate',
  freeThrowRate: 'Free throw rate',
  turnoverRate: 'Turnovers',
  isolationRate: 'Isolation',
  pickAndRollBallHandlerRate: 'PnR handler',
  pickAndRollRollManRate: 'Roll man',
  spotUpRate: 'Spot-up',
  transitionRate: 'Transition',
  cutRate: 'Cut',
  foulRate: 'Fouls',
  stealAttemptRate: 'Steal attempts',
  blockAttemptRate: 'Block attempts',
  crashOffensiveGlassRate: 'Off. glass',
};

export function isScoutTendency(field: ScoutField): boolean {
  return field in TENDENCY_LABELS;
}

export function scoutFieldLabel(field: ScoutField): string {
  return field in TENDENCY_LABELS
    ? TENDENCY_LABELS[field as keyof SimulationTendencies]
    : RATING_LABELS[field as keyof SimulationRatings];
}

/** Tendencies are rates, ratings stay on their 0–100 scale. */
export function scoutFieldValue(field: ScoutField, value: number): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return isScoutTendency(field) ? `${text}%` : text;
}

export const LINEUP_FINDING_LABELS = {
  'multiple-creators': 'Multiple creators',
  'spacing-volume': 'Spacing volume',
  'playmaking-depth': 'Playmaking depth',
  'rim-protection': 'Rim protection',
  'perimeter-defense': 'Perimeter defense',
  'glass-control': 'Glass control',
  'roster-depth': 'Roster depth',
  'no-primary-creator': 'No primary creator',
  'no-spacing': 'No spacing',
  'thin-spacing': 'Thin spacing',
  'no-rim-protection': 'No rim protection',
  'no-perimeter-stopper': 'No perimeter stopper',
  'weak-defensive-glass': 'Weak defensive glass',
  'turnover-risk': 'Turnover risk',
  'thin-depth': 'Thin depth',
} as const;
