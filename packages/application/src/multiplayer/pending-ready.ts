export class PendingReadyCoordinator {
  private target: number | null = null;
  private retryAtMs = 0;
  private readonly retryMs: number;
  private readonly ready: () => void;

  constructor(retryMs: number, ready: () => void) {
    this.retryMs = retryMs;
    this.ready = ready;
  }

  schedule(gameNumber: number): void {
    this.target = gameNumber;
    this.retryAtMs = 0;
  }

  reset(): void {
    this.target = null;
    this.retryAtMs = 0;
  }

  tick(input: {
    disposed: boolean;
    busy: boolean;
    phase: string;
    currentGameNumber: number | null;
    localReady: boolean;
    now: number;
  }): void {
    const target = this.target;
    if (target === null || input.disposed || input.busy) return;
    if (
      input.phase === 'championship' ||
      input.phase === 'integrity-failed' ||
      input.phase === 'expired'
    ) {
      this.reset();
      return;
    }
    if (input.phase !== 'preparing-game') return;
    if (input.currentGameNumber === null) {
      this.reset();
      return;
    }
    if (input.currentGameNumber !== target) {
      if (input.currentGameNumber > target) this.reset();
      return;
    }
    if (input.localReady) {
      this.reset();
      return;
    }
    if (input.now < this.retryAtMs) return;
    this.retryAtMs = input.now + this.retryMs;
    this.ready();
  }
}
