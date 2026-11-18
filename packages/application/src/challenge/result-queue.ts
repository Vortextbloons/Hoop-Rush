import type { GameResult } from '@hoop-rush/data-contracts';
import type { ChallengeClockPort } from './ports.ts';

interface ChallengeResultQueueOptions {
  startGameNumber: number;
  intervalMs: number;
  fast: boolean;
  clock: ChallengeClockPort;
  current(): boolean;
  accept(results: GameResult[]): Promise<boolean>;
  fail(message: string): void;
}

export class ChallengeResultQueue {
  private results: GameResult[] = [];
  private head = 0;
  private pumping = false;
  private expectedNext: number;
  private nextRevealAt: number;
  private fast: boolean;
  private readonly options: ChallengeResultQueueOptions;

  constructor(options: ChallengeResultQueueOptions) {
    this.options = options;
    this.fast = options.fast;
    this.expectedNext = options.startGameNumber;
    this.nextRevealAt = options.clock.now() + options.intervalMs;
  }

  deliver(results: readonly GameResult[]): void {
    if (!this.options.current()) return;
    this.results.push(...results);
    void this.pump();
  }

  setFast(fast: boolean): void {
    if (this.fast === fast) return;
    this.fast = fast;
    this.nextRevealAt = this.options.clock.now() + (fast ? 0 : this.options.intervalMs);
    void this.pump();
  }

  clear(): void {
    this.results = [];
    this.head = 0;
  }

  private compact(): void {
    if (this.head > 64) {
      this.results.splice(0, this.head);
      this.head = 0;
    }
  }

  /**
   * Takes every buffered result that continues the accepted order, or reports an
   * out-of-order gap and returns null. Fast path callers persist the whole batch in
   * one commit.
   */
  private takeBatch(): GameResult[] | null {
    const batch: GameResult[] = [];
    let next = this.results[this.head];
    while (next !== undefined) {
      const expected = this.expectedNext + batch.length;
      if (next.gameNumber !== expected) {
        this.options.fail(
          `out-of-order result: expected game ${String(expected)}, got ${String(next.gameNumber)}`,
        );
        return null;
      }
      batch.push(next);
      this.head += 1;
      next = this.results[this.head];
    }
    this.compact();
    return batch;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const { clock, intervalMs } = this.options;
    try {
      while (this.options.current()) {
        if (this.fast) {
          const batch = this.takeBatch();
          if (batch === null || batch.length === 0) return;
          if (!(await this.options.accept(batch))) return;
          this.expectedNext += batch.length;
          continue;
        }
        const next = this.results[this.head];
        if (next === undefined) return;
        if (next.gameNumber !== this.expectedNext) {
          this.options.fail(
            `out-of-order result: expected game ${String(this.expectedNext)}, got ${String(next.gameNumber)}`,
          );
          return;
        }
        this.head += 1;
        this.compact();
        const wait = this.nextRevealAt - clock.now();
        if (wait > 0) await clock.sleep(wait);
        if (!this.options.current() || !(await this.options.accept([next]))) return;
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
