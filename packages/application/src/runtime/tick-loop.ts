export type TickScheduler = (tick: () => void, intervalMs: number) => () => void;

export function intervalTickScheduler(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

export class TickLoop {
  private stop: (() => void) | null = null;
  private readonly scheduler: TickScheduler;
  private readonly intervalMs: number;
  private readonly onTick: () => void;

  constructor(scheduler: TickScheduler, intervalMs: number, onTick: () => void) {
    this.scheduler = scheduler;
    this.intervalMs = intervalMs;
    this.onTick = onTick;
  }

  start(): void {
    if (this.stop !== null) return;
    this.stop = this.scheduler(this.onTick, this.intervalMs);
  }

  dispose(): void {
    if (this.stop === null) return;
    this.stop();
    this.stop = null;
  }
}
