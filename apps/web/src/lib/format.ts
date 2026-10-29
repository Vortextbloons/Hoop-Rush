export function percentOneDecimal(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
export function oneDecimal(value: number): string {
  return value.toFixed(1);
}
export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}
export function ratioPct(made: number, attempted: number): string {
  return attempted === 0 ? '—' : percentOneDecimal(made / attempted);
}

export function trueShootingRate(
  points: number,
  fieldGoalsAttempted: number,
  freeThrowsAttempted: number,
): number | null {
  const denominator = 2 * (fieldGoalsAttempted + 0.44 * freeThrowsAttempted);
  return denominator <= 0 ? null : points / denominator;
}
export function trueShootingPct(
  points: number,
  fieldGoalsAttempted: number,
  freeThrowsAttempted: number,
): string {
  const rate = trueShootingRate(points, fieldGoalsAttempted, freeThrowsAttempted);
  return rate === null ? '—' : percentOneDecimal(rate);
}
export function usagePossessions(
  fieldGoalsAttempted: number,
  freeThrowsAttempted: number,
  turnovers: number,
): number {
  return fieldGoalsAttempted + 0.44 * freeThrowsAttempted + turnovers;
}
export function usagePct(playerPossessions: number, teamPossessions: number): string {
  return teamPossessions <= 0 ? '—' : percentOneDecimal(playerPossessions / teamPossessions);
}
export function perGameText(total: number, games: number): string {
  return oneDecimal(total / Math.max(1, games));
}
