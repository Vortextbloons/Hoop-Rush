export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface PlaybackAdvanceOutcome {
  progress: number;
  completed: boolean;
}

export class PlaybackProgress {
  private elapsedMs = 0;
  private completedAtMs: number | null = null;
  private approvedGame: number | null = null;

  begin(nowMs: number, startedAtMs: number, durationMs: number): void {
    this.elapsedMs = clamp01((nowMs - startedAtMs) / durationMs) * durationMs;
  }

  advance(deltaMs: number, durationMs: number, nowMs: number): PlaybackAdvanceOutcome {
    this.elapsedMs += deltaMs;
    const progress = clamp01(this.elapsedMs / durationMs);
    let completed = false;
    if (progress >= 1 && this.completedAtMs === null) {
      this.completedAtMs = nowMs;
      this.approvedGame = null;
      completed = true;
    }
    return { progress, completed };
  }

  approve(gameNumber: number): void {
    this.approvedGame = gameNumber;
  }

  continueApproved(gameNumber: number, holdMs: number, nowMs: number): boolean {
    if (this.approvedGame === gameNumber) return true;
    if (this.completedAtMs === null) return true;
    return nowMs - this.completedAtMs >= holdMs;
  }

  reset(): void {
    this.elapsedMs = 0;
    this.completedAtMs = null;
    this.approvedGame = null;
  }
}
