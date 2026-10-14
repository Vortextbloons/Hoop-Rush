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
export function perGameText(total: number, games: number): string {
  return oneDecimal(total / Math.max(1, games));
}
