import type { GameResult } from '@hoop-rush/data-contracts';
import type { ChallengeClockPort } from './ports.ts';

interface ChallengeResultQueueOptions {
  startGameNumber: number;
  intervalMs: number;
  clock: ChallengeClockPort;
  current(): boolean;
  accept(result: GameResult): Promise<boolean>;
  fail(message: string): void;
}

export class ChallengeResultQueue {
  private results: GameResult[] = [];
  private head = 0;
  private pumping = false;
  private expectedNext: number;
  private nextRevealAt: number;
  private readonly options: ChallengeResultQueueOptions;

  constructor(options: ChallengeResultQueueOptions) {
    this.options = options;
    this.expectedNext = options.startGameNumber;
    this.nextRevealAt = options.clock.now() + options.intervalMs;
  }

  deliver(results: readonly GameResult[]): void {
    if (!this.options.current()) return;
    this.results.push(...results);
    void this.pump();
  }

  clear(): void {
    this.results = [];
    this.head = 0;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const { clock, intervalMs } = this.options;
    try {
      while (this.options.current()) {
        const next = this.results[this.head];
        if (next === undefined) return;
        this.head += 1;
        if (this.head > 64) {
          this.results.splice(0, this.head);
          this.head = 0;
        }
        if (next.gameNumber !== this.expectedNext) {
          this.options.fail(
            `out-of-order result: expected game ${String(this.expectedNext)}, got ${String(next.gameNumber)}`,
          );
          return;
        }
        const wait = this.nextRevealAt - clock.now();
        if (wait > 0) await clock.sleep(wait);
        if (!this.options.current() || !(await this.options.accept(next))) return;
        this.expectedNext += 1;
        this.nextRevealAt += intervalMs;
      }
    } catch (error) {
      if (this.options.current())
        this.options.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.pumping = false;
    }
  }
}
