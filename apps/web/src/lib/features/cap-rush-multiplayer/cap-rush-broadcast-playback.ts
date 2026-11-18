export const BROADCAST_TICK_MS = 100;

export function broadcastCursor(elapsedMs: number, total: number, speed: 2 | 4): number {
  const step = Math.max(1, Math.ceil((total * speed) / 100));
  return Math.min(total, Math.floor(elapsedMs / BROADCAST_TICK_MS) * step);
}
