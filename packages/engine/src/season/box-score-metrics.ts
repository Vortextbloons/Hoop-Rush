export const DEFENSE_WEIGHTS = { steal: 0.6, block: 0.6, defensiveRebound: 0.15 } as const;
export const PLAYMAKING_ASSIST_WEIGHT = 0.5;
export const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;

export function shotsUsedOf(line: {
  fieldGoalsAttempted: number;
  freeThrowsAttempted: number;
}): number {
  return line.fieldGoalsAttempted + 0.44 * line.freeThrowsAttempted;
}

export function trueShootingOf(line: {
  points: number;
  fieldGoalsAttempted: number;
  freeThrowsAttempted: number;
}): number {
  const shots = shotsUsedOf(line);
  return shots <= 0 ? 0 : line.points / (2 * shots);
}
