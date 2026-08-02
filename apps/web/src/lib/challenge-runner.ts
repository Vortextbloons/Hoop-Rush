import { acceptGameResult } from '@hoop-rush/engine';
import {
  workerRequestSchema,
  workerMessageSchema,
  type ChallengeRun,
  type EraSimulationProfile,
  type GameResult,
} from '@hoop-rush/data-contracts';
import {
  type ChallengeRepository,
  type CompletedRunIndex,
  type StoredRunRecord,
} from '@hoop-rush/persistence';

/**
 * Main-thread challenge orchestration (spec/04 state ownership). The worker
 * computes ahead and posts results in batches; this runner owns the accepted
 * run, queues results for the paced presentation, validates every result
 * through the challenge command, appends each accepted game to the active run
 * (one game row plus the updated checkpoint) before exposing it as accepted
 * UI state, and discards buffered results after cancellation. A worker crash,
 * invalid result, or persistence failure stops presentation without advancing
 * beyond the last successfully saved game.
 */

/** Minimum presentation duration: one committed reveal roughly every 36 ms. */
export const REVEAL_INTERVAL_MS = 36;

/** Target minimum presentation duration for a full 82-game reveal. */
export const MIN_PRESENTATION_MS = 82 * REVEAL_INTERVAL_MS;

export type RunnerPhase = 'idle' | 'running' | 'paused' | 'finished' | 'error';

export interface RunnerCallbacks {
  /** A game was accepted, persisted, and is now revealed as UI state. */
  onReveal(result: GameResult, run: ChallengeRun): void;
  /** The full run finished and was promoted to completed history. */
  onFinished(run: ChallengeRun): void;
  /** Cancellation stopped presentation at the last persisted prefix. */
  onPaused(): void;
  /** A worker, validation, or persistence failure stopped the run. */
  onError(message: string): void;
}

export interface RunnerOptions {
  /** Under reduced motion, remove artificial pacing (spec/08). */
  reducedMotion: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ChallengeRunner {
  private worker: Worker | null = null;
  private requestId: string | null = null;
  private phase: RunnerPhase = 'idle';
  private run: ChallengeRun | null = null;
  private profile: EraSimulationProfile | null = null;
  private queue: Array<{ gameNumber: number; result: GameResult }> = [];
  /** Index of the next unconsumed queue entry; compaction avoids shift(). */
  private queueHead = 0;
  private expectedNext = 1;
  private nextRevealAt = 0;
  private reducedMotion = false;
  private disposed = false;
  private pumpToken = 0;
  private lastError: string | null = null;

  constructor(
    private readonly repo: ChallengeRepository,
    private readonly callbacks: RunnerCallbacks,
  ) {}

  get status(): RunnerPhase {
    return this.phase;
  }

  get acceptedRun(): ChallengeRun | null {
    return this.run;
  }

  /** Error message for the retry action; null unless phase is 'error'. */
  get errorMessage(): string | null {
    return this.lastError;
  }

  /** Starts (or resumes) a run from its next unplayed game. */
  start(run: ChallengeRun, profile: EraSimulationProfile, options: RunnerOptions): void {
    if (this.phase === 'running') return;
    if (run.status !== 'active') {
      this.fail(`cannot run a challenge in status ${run.status}`);
      return;
    }
    this.disposed = false;
    this.run = run;
    this.profile = profile;
    this.reducedMotion = options.reducedMotion;
    this.expectedNext = run.games.length + 1;
    this.queue = [];
    this.queueHead = 0;
    this.lastError = null;
    this.requestId = crypto.randomUUID();
    this.phase = 'running';

    this.worker = new Worker(new URL('../workers/challenge-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = () => {
      this.fail('the simulation worker crashed');
    };

    this.nextRevealAt = performance.now() + (this.reducedMotion ? 0 : REVEAL_INTERVAL_MS);
    const request = workerRequestSchema.parse({
      schemaVersion: 1,
      type: 'simulate',
      requestId: this.requestId,
      // Games are stripped from the worker copy: inputs derive from the
      // schedule, seed, and versions, never from recorded results.
      run: { ...run, games: [] },
      startGameNumber: this.expectedNext,
      profile,
      engineVersion: run.versions.engineVersion,
    });
    this.worker.postMessage(request);
    void this.pump();
  }

  /** Cancels the worker, discards buffered results, keeps the persisted prefix. */
  cancel(): void {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    this.pumpToken += 1;
    this.queue = [];
    this.queueHead = 0;
    if (this.worker && this.requestId) {
      this.worker.postMessage(
        workerRequestSchema.parse({
          schemaVersion: 1,
          type: 'cancel',
          requestId: this.requestId,
        }),
      );
    }
    this.teardownWorker();
    this.callbacks.onPaused();
  }

  /** Releases the worker; navigation leaves the last persisted prefix active. */
  dispose(): void {
    this.disposed = true;
    this.pumpToken += 1;
    this.queue = [];
    this.queueHead = 0;
    this.teardownWorker();
  }

  private teardownWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private handleMessage(raw: unknown): void {
    const parsed = workerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.fail('the simulation worker returned an invalid message');
      return;
    }
    const message = parsed.data;
    if (this.requestId === null || message.requestId !== this.requestId) return; // stale
    switch (message.type) {
      case 'results':
        for (const result of message.results) {
          this.queue.push({ gameNumber: result.gameNumber, result });
        }
        break;
      case 'error':
        this.fail(message.message);
        break;
    }
  }

  /** True when this pump generation was superseded (cancel/dispose/fail). */
  private isStale(token: number): boolean {
    return this.disposed || token !== this.pumpToken;
  }

  /** Accepts, persists, and reveals queued results at the paced interval. */
  private async pump(): Promise<void> {
    const token = ++this.pumpToken;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      if (this.isStale(token)) return;
      const phaseNow = this.phase;
      if (phaseNow !== 'running') {
        await sleep(20);
        continue;
      }
      const next = this.queue[this.queueHead];
      if (!next) {
        await sleep(10);
        continue;
      }
      this.queueHead += 1;
      if (this.queueHead > 64) {
        this.queue.splice(0, this.queueHead);
        this.queueHead = 0;
      }
      if (next.gameNumber !== this.expectedNext) {
        this.fail(
          `out-of-order result: expected game ${String(this.expectedNext)}, got ${String(next.gameNumber)}`,
        );
        return;
      }
      const wait = this.nextRevealAt - performance.now();
      if (wait > 0) {
        await sleep(wait);
        if (this.isStale(token)) return;
      }
      const runningNow = this.phase;
      if (runningNow !== 'running') return;
      const run = this.run;
      if (!run) return;

      let accepted: ChallengeRun;
      try {
        accepted = acceptGameResult(run, next.result);
      } catch (error) {
        this.fail(`invalid game result: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      try {
        await this.repo.appendActiveGame({
          runId: run.runId,
          gameNumber: next.result.gameNumber,
          result: next.result,
          aggregates: accepted.aggregates,
          status: accepted.status === 'finished' ? 'finished' : 'active',
          firstLossGameNumber: accepted.firstLossGameNumber,
        });
      } catch (error) {
        this.fail(
          `could not save the game: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (this.isStale(token)) return;
      this.run = accepted;
      this.expectedNext += 1;
      this.nextRevealAt += REVEAL_INTERVAL_MS;
      this.callbacks.onReveal(next.result, accepted);

      if (accepted.status === 'finished') {
        this.phase = 'finished';
        this.teardownWorker();
        try {
          await this.promote(accepted);
        } catch (error) {
          this.fail(
            `could not save the completed run: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        if (this.isStale(token)) return;
        this.callbacks.onFinished(accepted);
        return;
      }
    }
  }

  /** Moves the finished run from active into completed history atomically. */
  private async promote(run: ChallengeRun): Promise<void> {
    const completedAtIso = new Date().toISOString();
    const completed: StoredRunRecord = {
      recordId: run.runId,
      saveSchemaVersion: 2,
      run,
      updatedAtIso: completedAtIso,
    };
    const index: CompletedRunIndex = {
      recordId: run.runId,
      runId: run.runId,
      mode: run.mode,
      franchiseId: run.franchiseId,
      eraId: run.eraId,
      playerIds: run.playerIds,
      runSeed: run.runSeed,
      wins: run.aggregates.team.wins,
      losses: run.aggregates.team.losses,
      gamesPlayed: run.aggregates.team.gamesPlayed,
      outcome: run.outcome ?? 'eliminated',
      completedAtIso,
    };
    await this.repo.promoteActiveToCompleted(completed, index);
  }

  private fail(message: string): void {
    if (this.phase === 'error' || this.phase === 'finished') return;
    this.phase = 'error';
    this.lastError = message;
    this.pumpToken += 1;
    this.teardownWorker();
    this.callbacks.onError(message);
  }
}
