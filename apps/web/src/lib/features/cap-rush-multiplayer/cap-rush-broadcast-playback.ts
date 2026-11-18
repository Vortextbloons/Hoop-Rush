/**
 * Pure timing math for the local Cap Rush broadcast playback.
 *
 * The component feeds real elapsed milliseconds into the shared
 * `PlaybackCadence` and maps the accumulated time onto the integer item
 * cursor with these helpers. A delayed frame therefore delivers its whole
 * elapsed delta and catches up, instead of stretching playback by one fixed
 * step per (possibly throttled) 100ms tick.
 */

/** Items the legacy fixed-step loop revealed per 100ms tick. */
export function broadcastStep(total: number, speed: 2 | 4): number {
  return Math.max(1, Math.ceil((total * speed) / 100));
}

/** Nominal wall-clock duration of a full reveal, in ms (matches the legacy tick rate). */
export function broadcastDurationMs(total: number, speed: 2 | 4): number {
  if (total <= 0) return 0;
  return (total * 100) / broadcastStep(total, speed);
}

/**
 * Map accumulated playback time to a clamped, exact integer cursor. Reaching
 * (or passing) the nominal duration lands exactly on `total`, so completion
 * is exact and never overshoots.
 */
export function broadcastCursor(elapsedMs: number, total: number, speed: 2 | 4): number {
  if (total <= 0) return 0;
  const durationMs = broadcastDurationMs(total, speed);
  if (durationMs <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return total;
  return Math.min(total, Math.floor((elapsedMs / durationMs) * total));
}
