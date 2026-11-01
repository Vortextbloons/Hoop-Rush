import { ChallengeResultQueue } from './result-queue.ts';
import {
  challengeRunSchema,
  SAVE_SCHEMA_VERSION,
  seedSchema,
  type ChallengeRun,
  type EraSimulationProfile,
  type GameResult,
} from '@hoop-rush/data-contracts';
import { acceptGameResult, challengeRunProgressDigest } from '@hoop-rush/engine';
import type { CompletedRunIndex, StoredRunRecord } from '@hoop-rush/data-contracts';
import type {
  ChallengeAssetPort,
  ChallengeClockPort,
  ChallengeJobEvents,
  ChallengeJobPort,
  ChallengeRunRepositoryPort,
} from './ports.ts';

export const REVEAL_INTERVAL_MS = 36;
export type ChallengePhase =
  'idle' | 'loading' | 'starting' | 'running' | 'paused' | 'completing' | 'finished' | 'error';
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
interface ChallengeExecution {
  token: number;
  intervalMs: number;
  awaitingSeed: boolean;
  reveal: ChallengeResultQueue | null;
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
  private execution: ChallengeExecution | null = null;
  private runToken = 0;
  private commit: Promise<void> | null = null;
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
  async load(): Promise<void> {
    if (this.isDisposed()) return;
    if (this.phase === 'running' || this.phase === 'starting' || this.phase === 'completing')
      return;
    const token = this.invalidate();
    this.phase = 'loading';
    this.run = null;
    this.profile = null;
    this.error = null;
    this.loadError = null;
    this.emit();
    try {
      if (this.commit !== null) await this.commit;
      if (this.abandoned(token)) return;
      const record = await this.repo.loadActiveRun();
      if (this.abandoned(token)) return;
      if (record === null) {
        this.loadError = 'No active challenge. Start one from the draft.';
        this.phase = 'idle';
        this.emit();
        return;
      }
      const run = record.run;
      if (run.status === 'finished') {
        this.run = run;
        await this.complete(run, token);
        return;
      }
      if (run.status !== 'active') {
        this.loadError = 'This challenge is no longer active.';
        this.phase = 'idle';
        this.emit();
        return;
      }
      try {
        const profile = await this.assets.loadEraSimulationProfile(run.eraId);
        if (this.abandoned(token)) return;
        this.run = run;
        this.profile = profile;
      } catch {
        if (this.abandoned(token)) return;
        this.run = null;
        this.loadError = 'The decade simulation profile is unavailable.';
        this.phase = 'idle';
        this.emit();
        return;
      }
      if (this.abandoned(token)) return;
      this.phase = 'idle';
      this.emit();
    } catch (error) {
      if (this.abandoned(token)) return;
      this.run = null;
      this.profile = null;
      this.loadError = error instanceof Error ? error.message : String(error);
      this.phase = 'idle';
      this.emit();
    }
  }
  start(options: { reducedMotion: boolean }): void {
    if (
      this.disposed ||
      this.phase === 'loading' ||
      this.phase === 'starting' ||
      this.phase === 'running' ||
      this.phase === 'completing' ||
      this.phase === 'finished' ||
      this.run === null
    )
      return;
    const execution: ChallengeExecution = {
      token: this.invalidate(),
      intervalMs: options.reducedMotion ? 0 : REVEAL_INTERVAL_MS,
      reveal: null,
      awaitingSeed: true,
    };
    this.execution = execution;
    this.error = null;
    this.phase = 'starting';
    this.emit();
    if (this.commit !== null) {
      void this.commit.then(
        () => {
          this.beginExecution(execution);
        },
        () => {
          this.beginExecution(execution);
        },
      );
    } else this.beginExecution(execution);
  }
  private beginExecution(execution: ChallengeExecution): void {
    if (this.abandoned(execution.token)) return;
    const run = this.run;
    if (run === null) return;
    if (run.status === 'finished') {
      void this.complete(run, execution.token);
      return;
    }
    if (this.profile === null) {
      this.fail('The decade simulation profile is unavailable.');
      return;
    }
    try {
      if (run.games.length === 0) {
        this.job.startAttempt({ run, profile: this.profile }, this.jobEvents(execution));
      } else this.beginReveal(run, execution);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }
  private async save(operation: () => Promise<void>, committed: () => void): Promise<void> {
    const commit = (async () => {
      await operation();
      if (!this.disposed) committed();
    })();
    this.commit = commit;
    try {
      await commit;
    } finally {
      if (this.commit === commit) this.commit = null;
    }
  }
  cancel(): void {
    if (this.phase !== 'running' && this.phase !== 'starting') return;
    this.invalidate();
    this.job.cancel();
    this.phase = 'paused';
    this.error = null;
    this.emit();
  }
  dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.job.dispose();
    this.listeners.clear();
  }
  private invalidate(): number {
    this.execution?.reveal?.clear();
    this.execution = null;
    return ++this.runToken;
  }
  private abandoned(token: number): boolean {
    return this.disposed || token !== this.runToken;
  }
  private jobEvents(execution: ChallengeExecution): ChallengeJobEvents {
    const token = execution.token;
    return {
      onStartResult: (chosenRunSeed) => {
        void this.onStartResult(chosenRunSeed, execution);
      },
      onResults: (results) => {
        if (this.abandoned(token)) return;
        execution.reveal?.deliver(results);
      },
      onError: (message) => {
        if (this.abandoned(token)) return;
        this.fail(message);
      },
    };
  }
  private async onStartResult(chosenRunSeed: string, execution: ChallengeExecution): Promise<void> {
    const token = execution.token;
    if (this.abandoned(token) || this.phase !== 'starting' || !execution.awaitingSeed) return;
    execution.awaitingSeed = false;
    const run = this.run;
    if (run === null) return;
    const parsedSeed = seedSchema.safeParse(chosenRunSeed);
    if (!parsedSeed.success) {
      this.fail('invalid attempt seed');
      return;
    }
    const chosenSeed = parsedSeed.data;
    const updatedRun =
      chosenSeed === run.runSeed ? run : challengeRunSchema.parse({ ...run, runSeed: chosenSeed });
    if (updatedRun !== run) {
      try {
        await this.save(
          () =>
            this.repo.saveActiveRun({
              recordId: ACTIVE_RECORD_ID,
              saveSchemaVersion: SAVE_SCHEMA_VERSION,
              run: updatedRun,
            }),
          () => {
            this.run = updatedRun;
          },
        );
      } catch (error) {
        if (this.abandoned(token)) return;
        this.fail(
          `could not save the chosen attempt seed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (this.abandoned(token)) return;
    }
    if (this.abandoned(token)) return;
    try {
      this.beginReveal(updatedRun, execution);
    } catch (error) {
      if (!this.abandoned(token)) this.fail(error instanceof Error ? error.message : String(error));
    }
  }
  private beginReveal(run: ChallengeRun, execution: ChallengeExecution): void {
    const profile = this.profile;
    if (profile === null) return;
    const token = execution.token;
    const startGameNumber = run.games.length + 1;
    execution.reveal = new ChallengeResultQueue({
      startGameNumber,
      intervalMs: execution.intervalMs,
      clock: this.clock,
      current: () => !this.abandoned(token) && this.phase === 'running',
      accept: (result) => this.acceptResult(result, token),
      fail: (message) => {
        if (!this.abandoned(token)) this.fail(message);
      },
    });
    this.phase = 'running';
    this.emit();
    if (this.abandoned(token)) return;
    this.job.startSimulation({ run, profile, startGameNumber }, this.jobEvents(execution));
  }
  private async acceptResult(result: GameResult, token: number): Promise<boolean> {
    const run = this.run;
    if (run === null || this.abandoned(token)) return false;
    let accepted: ChallengeRun;
    try {
      accepted = acceptGameResult(run, result);
    } catch (error) {
      this.fail(`invalid game result: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    try {
      await this.save(
        () =>
          this.repo.appendActiveGame({
            runId: run.runId,
            gameNumber: result.gameNumber,
            result,
            aggregates: accepted.aggregates,
            status: accepted.status === 'finished' ? 'finished' : 'active',
            firstLossGameNumber: accepted.firstLossGameNumber,
          }),
        () => {
          this.run = accepted;
        },
      );
    } catch (error) {
      if (!this.abandoned(token))
        this.fail(
          `could not save the game: ${error instanceof Error ? error.message : String(error)}`,
        );
      return false;
    }
    if (this.abandoned(token)) return false;
    if (accepted.status === 'finished') {
      this.job.dispose();
      await this.complete(accepted, token);
      return false;
    }
    this.emit();
    return true;
  }
  private async complete(run: ChallengeRun, token: number): Promise<void> {
    if (this.abandoned(token)) return;
    this.phase = 'completing';
    this.emit();
    if (this.abandoned(token)) return;
    try {
      await this.save(
        () => this.promote(run),
        () => {},
      );
    } catch (error) {
      if (this.abandoned(token)) return;
      this.fail(
        `could not save the completed run: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (this.abandoned(token)) return;
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
    this.invalidate();
    this.job.dispose();
    this.phase = 'error';
    this.error = message;
    this.emit();
  }
}
