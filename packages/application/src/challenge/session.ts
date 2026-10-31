import {
  challengeRunSchema,
  SAVE_SCHEMA_VERSION,
  seedSchema,
  type ChallengeRun,
  type EraSimulationProfile,
  type GameResult,
} from '@hoop-rush/data-contracts';
import { acceptGameResult, challengeRunProgressDigest } from '@hoop-rush/engine';
import type { CompletedRunIndex, StoredRunRecord } from '@hoop-rush/persistence';
import type {
  ChallengeAssetPort,
  ChallengeClockPort,
  ChallengeJobEvents,
  ChallengeJobPort,
  ChallengeRunRepositoryPort,
} from './ports.ts';

export const REVEAL_INTERVAL_MS = 36;
export type ChallengePhase = 'idle' | 'starting' | 'running' | 'paused' | 'finished' | 'error';
export interface ChallengeSessionSnapshot {
  run: ChallengeRun | null;
  phase: ChallengePhase;
  error: string | null;
  loadError: string | null;
}
export interface ChallengeSessionOptions {
  repository: ChallengeRunRepositoryPort;
  job: ChallengeJobPort;
  assets: ChallengeAssetPort;
  clock: ChallengeClockPort;
}
interface QueuedResult {
  gameNumber: number;
  result: GameResult;
}
const ACTIVE_RECORD_ID = 'active';
export class ChallengeSession {
  private readonly repo: ChallengeRunRepositoryPort;
  private readonly job: ChallengeJobPort;
  private readonly assets: ChallengeAssetPort;
  private readonly clock: ChallengeClockPort;
  private readonly listeners = new Set<() => void>();
  private run: ChallengeRun | null = null;
  private profile: EraSimulationProfile | null = null;
  private phase: ChallengePhase = 'idle';
  private error: string | null = null;
  private loadError: string | null = null;
  private queue: QueuedResult[] = [];
  private queueHead = 0;
  private expectedNext = 1;
  private nextRevealAt = 0;
  private reducedMotion = false;
  private runToken = 0;
  private pumping = false;
  private disposed = false;
  constructor(options: ChallengeSessionOptions) {
    this.repo = options.repository;
    this.job = options.job;
    this.assets = options.assets;
    this.clock = options.clock;
  }
  getSnapshot(): ChallengeSessionSnapshot {
    return {
      run: this.run,
      phase: this.phase,
      error: this.error,
      loadError: this.loadError,
    };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  private isDisposed(): boolean {
    return this.disposed;
  }
  private revealIntervalMs(): number {
    return this.reducedMotion ? 0 : REVEAL_INTERVAL_MS;
  }
  async load(): Promise<void> {
    if (this.isDisposed()) return;
    if (this.phase === 'running' || this.phase === 'starting') return;
    this.runToken += 1;
    this.queue = [];
    this.queueHead = 0;
    this.run = null;
    this.profile = null;
    this.error = null;
    this.loadError = null;
    try {
      const record = await this.repo.loadActiveRun();
      if (this.isDisposed()) return;
      if (record === null) {
        this.loadError = 'No active challenge. Start one from the draft.';
        this.phase = 'idle';
        this.emit();
        return;
      }
      const run = record.run;
      if (run.status === 'finished') {
        this.run = run;
        this.phase = 'finished';
        this.emit();
        return;
      }
      if (run.status !== 'active') {
        this.loadError = 'This challenge is no longer active.';
        this.phase = 'idle';
        this.emit();
        return;
      }
      this.run = run;
      try {
        this.profile = await this.assets.loadEraSimulationProfile(run.eraId);
      } catch {
        if (this.isDisposed()) return;
        this.run = null;
        this.loadError = 'The decade simulation profile is unavailable.';
        this.phase = 'idle';
        this.emit();
        return;
      }
      if (this.isDisposed()) return;
      this.phase = 'idle';
      this.emit();
    } catch (error) {
      if (this.isDisposed()) return;
      this.run = null;
      this.profile = null;
      this.loadError = error instanceof Error ? error.message : String(error);
      this.phase = 'idle';
      this.emit();
    }
  }
  start(options: { reducedMotion: boolean }): void {
    if (this.isDisposed()) return;
    if (this.phase === 'running' || this.phase === 'starting') return;
    this.reducedMotion = options.reducedMotion;
    this.error = null;
    const run = this.run;
    if (run === null) return;
    if (run.status !== 'active') {
      void this.retryPromotion(run);
      return;
    }
    if (this.profile === null) {
      this.loadError = 'The decade simulation profile is unavailable.';
      this.emit();
      return;
    }
    const token = ++this.runToken;
    this.queue = [];
    this.queueHead = 0;
    if (run.games.length === 0) {
      this.phase = 'starting';
      this.emit();
      this.job.startAttempt({ run, profile: this.profile }, this.jobEvents(token));
      return;
    }
    this.beginReveal(run, token);
  }
  cancel(): void {
    if (this.phase !== 'running' && this.phase !== 'starting') return;
    this.runToken += 1;
    this.queue = [];
    this.queueHead = 0;
    this.job.cancel();
    this.phase = 'paused';
    this.error = null;
    this.emit();
  }
  dispose(): void {
    this.disposed = true;
    this.runToken += 1;
    this.queue = [];
    this.queueHead = 0;
    this.job.dispose();
    this.listeners.clear();
  }
  private abandoned(token: number): boolean {
    return this.disposed || token !== this.runToken;
  }
  private jobEvents(token: number): ChallengeJobEvents {
    return {
      onStartResult: (chosenRunSeed) => {
        void this.onStartResult(chosenRunSeed, token);
      },
      onResults: (results) => {
        if (this.abandoned(token)) return;
        for (const result of results) {
          this.queue.push({ gameNumber: result.gameNumber, result });
        }
        void this.pump(token);
      },
      onError: (message) => {
        if (this.abandoned(token)) return;
        this.fail(message);
      },
    };
  }
  private async onStartResult(chosenRunSeed: string, token: number): Promise<void> {
    if (this.abandoned(token) || this.phase !== 'starting') return;
    const run = this.run;
    if (run === null) return;
    const chosenSeed = seedSchema.parse(chosenRunSeed);
    const updatedRun =
      chosenSeed === run.runSeed ? run : challengeRunSchema.parse({ ...run, runSeed: chosenSeed });
    if (updatedRun !== run) {
      try {
        await this.repo.saveActiveRun({
          recordId: ACTIVE_RECORD_ID,
          saveSchemaVersion: SAVE_SCHEMA_VERSION,
          run: updatedRun,
        });
      } catch (error) {
        this.fail(
          `could not save the chosen attempt seed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (this.abandoned(token)) return;
      this.run = updatedRun;
    }
    this.beginReveal(updatedRun, token);
  }
  private beginReveal(run: ChallengeRun, token: number): void {
    const profile = this.profile;
    if (profile === null) return;
    this.expectedNext = run.games.length + 1;
    this.nextRevealAt = this.clock.now() + this.revealIntervalMs();
    this.phase = 'running';
    this.emit();
    this.job.startSimulation(
      { run, profile, startGameNumber: this.expectedNext },
      this.jobEvents(token),
    );
    void this.pump(token);
  }
  private async pump(token: number): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.abandoned(token) || this.phase !== 'running') return;
        const next = this.queue[this.queueHead];
        if (next === undefined) return;
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
        const wait = this.nextRevealAt - this.clock.now();
        if (wait > 0) {
          await this.clock.sleep(wait);
          if (this.abandoned(token)) return;
        }
        const run = this.run;
        if (run === null) return;
        let accepted: ChallengeRun;
        try {
          accepted = acceptGameResult(run, next.result);
        } catch (error) {
          this.fail(
            `invalid game result: ${error instanceof Error ? error.message : String(error)}`,
          );
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
        if (this.abandoned(token)) return;
        this.run = accepted;
        this.expectedNext += 1;
        this.nextRevealAt += this.revealIntervalMs();
        if (accepted.status === 'finished') {
          this.phase = 'finished';
          this.emit();
          this.job.dispose();
          try {
            await this.promote(accepted);
          } catch (error) {
            this.phase = 'error';
            this.error = `could not save the completed run: ${error instanceof Error ? error.message : String(error)}`;
            this.emit();
            return;
          }
          if (this.abandoned(token)) return;
          this.emit();
          return;
        }
        this.emit();
      }
    } finally {
      this.pumping = false;
    }
  }
  private async retryPromotion(run: ChallengeRun): Promise<void> {
    if (run.status !== 'finished') return;
    try {
      await this.promote(run);
    } catch (error) {
      this.phase = 'error';
      this.error = `could not save the completed run: ${error instanceof Error ? error.message : String(error)}`;
      this.emit();
      return;
    }
    if (this.disposed) return;
    this.phase = 'finished';
    this.emit();
  }
  private async promote(run: ChallengeRun): Promise<void> {
    const completedAtIso = this.clock.nowIso();
    const completed: StoredRunRecord = {
      recordId: run.runId,
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      run,
      updatedAtIso: completedAtIso,
    };
    const index: CompletedRunIndex = {
      recordId: run.runId,
      runId: run.runId,
      mode: run.mode,
      variant: run.variant,
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
    await this.repo.promoteActiveToCompleted(completed, index, {
      expectedGamesPlayed: run.games.length,
      expectedRunDigest: challengeRunProgressDigest(run),
    });
  }
  private fail(message: string): void {
    if (this.disposed || this.phase === 'error') return;
    this.runToken += 1;
    this.queue = [];
    this.queueHead = 0;
    this.job.dispose();
    this.phase = 'error';
    this.error = message;
    this.emit();
  }
}
