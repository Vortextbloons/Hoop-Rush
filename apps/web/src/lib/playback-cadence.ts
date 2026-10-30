export const DEFAULT_PRESENTATION_HZ = 60;
export const LITE_PRESENTATION_HZ = 30;

export function presentationIntervalMs(lite: boolean): number {
  return 1000 / (lite ? LITE_PRESENTATION_HZ : DEFAULT_PRESENTATION_HZ);
}

export class PlaybackCadence {
  private pendingMs = 0;

  constructor(private readonly intervalMs: number) {}

  add(deltaMs: number): number | null {
    if (Number.isFinite(deltaMs) && deltaMs > 0) this.pendingMs += deltaMs;
    if (this.pendingMs < this.intervalMs) return null;
    const advancedMs = this.pendingMs;
    this.pendingMs = 0;
    return advancedMs;
  }

  reset(): void {
    this.pendingMs = 0;
  }
}
