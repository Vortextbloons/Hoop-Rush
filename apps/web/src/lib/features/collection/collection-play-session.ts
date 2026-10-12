import type {
  CollectionDifficultyId,
  CollectionGameEvent,
  CollectionGameRecordUnion,
  CollectionGameResultUnion,
  CollectionGameResultV3,
  CollectionGameWorkerCompleteMessage,
  CollectionObjectiveId,
  CollectionPlayState,
  CollectionPreparedGameUnion,
} from '@hoop-rush/data-contracts';

export type CollectionPlayPhase =
  'idle' | 'preparing' | 'abandoning' | 'simulating' | 'committing' | 'error';

export interface CollectionPlaySnapshot {
  playState: CollectionPlayState | null;
  rootSeed: string | null;
  phase: CollectionPlayPhase;
  error: string | null;
}

export interface CollectionPrepareInput {
  mode: 'standard' | 'challenges';
  difficultyId: CollectionDifficultyId;
  objectiveId: CollectionObjectiveId | null;
  challengeId: string | null;
}

export interface CollectionPlayResult {
  record: CollectionGameRecordUnion;
}

export interface CollectionPlaySessionDeps {
  ensurePlayState(nowIso: string): Promise<{ playState: CollectionPlayState; rootSeed: string }>;
  prepareBasicGame(
    nowIso: string,
    setup: { difficultyId: CollectionDifficultyId; objectiveId: CollectionObjectiveId | null },
  ): Promise<{ playState: CollectionPlayState }>;
  prepareChallengeGame(
    challengeId: string,
    objectiveId: CollectionObjectiveId | null,
    nowIso: string,
  ): Promise<{ playState: CollectionPlayState }>;
  abandonBasicGame(nowIso: string): Promise<CollectionPlayState>;
  abandonChallengeGame(nowIso: string): Promise<CollectionPlayState>;
  runGame(prepared: CollectionPreparedGameUnion): Promise<CollectionGameWorkerCompleteMessage>;
  acceptBasicGameResult(input: {
    result: CollectionGameResultUnion;
    events: CollectionGameEvent[];
    completedAtIso: string;
    recordedAtIso: string;
  }): Promise<{ playState: CollectionPlayState; record: CollectionGameRecordUnion }>;
  acceptChallengeGameResult(input: {
    result: CollectionGameResultV3;
    events: CollectionGameEvent[];
    completedAtIso: string;
    recordedAtIso: string;
  }): Promise<{ playState: CollectionPlayState; record: CollectionGameRecordUnion }>;
  loadCommittedGame(gameId: string): Promise<CollectionGameRecordUnion | null>;
  reloadCollection(): Promise<void>;
  clock: {
    nowIso(): string;
    sleep(ms: number): Promise<void>;
  };
  anticipationMs(): number;
  errorMessage(error: unknown, fallback: string): string;
}

export class CollectionPlaySession {
  private readonly deps: CollectionPlaySessionDeps;
  private readonly listeners = new Set<() => void>();
  private playState: CollectionPlayState | null = null;
  private rootSeed: string | null = null;
  private phase: CollectionPlayPhase = 'idle';
  private error: string | null = null;
  private token = 0;
  private disposed = false;

  constructor(deps: CollectionPlaySessionDeps) {
    this.deps = deps;
  }

  getSnapshot(): CollectionPlaySnapshot {
    return {
      playState: this.playState,
      rootSeed: this.rootSeed,
      phase: this.phase,
      error: this.error,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async load(): Promise<void> {
    if (this.isDisposed()) return;
    const snapshot = await this.deps.ensurePlayState(this.deps.clock.nowIso());
    if (this.isDisposed()) return;
    this.playState = snapshot.playState;
    this.rootSeed = snapshot.rootSeed;
    this.publish();
  }

  async prepare(input: CollectionPrepareInput): Promise<boolean> {
    if (this.isDisposed() || this.phase !== 'idle') return false;
    if (input.mode === 'challenges' && input.challengeId === null) return false;
    const token = this.begin();
    this.phase = 'preparing';
    this.error = null;
    this.publish();
    try {
      const nowIso = this.deps.clock.nowIso();
      const anticipation = this.deps.clock.sleep(this.deps.anticipationMs());
      const outcome =
        input.mode === 'challenges'
          ? await this.deps.prepareChallengeGame(
              input.challengeId as string,
              input.objectiveId,
              nowIso,
            )
          : await this.deps.prepareBasicGame(nowIso, {
              difficultyId: input.difficultyId,
              objectiveId: input.objectiveId,
            });
      await anticipation;
      if (this.abandoned(token)) return false;
      this.playState = outcome.playState;
      this.phase = 'idle';
      this.publish();
      return true;
    } catch (error) {
      if (this.abandoned(token)) return false;
      this.phase = 'error';
      this.error = this.deps.errorMessage(error, 'Preparing failed.');
      this.publish();
      return false;
    }
  }

  async abandon(): Promise<boolean> {
    if (this.isDisposed() || this.phase !== 'idle') return false;
    const token = this.begin();
    this.phase = 'abandoning';
    this.error = null;
    this.publish();
    try {
      const nowIso = this.deps.clock.nowIso();
      const pending = this.playState?.pendingGame ?? null;
      const next =
        pending !== null && pending.gameVersion === 'collection-game-v3'
          ? await this.deps.abandonChallengeGame(nowIso)
          : await this.deps.abandonBasicGame(nowIso);
      if (this.abandoned(token)) return false;
      this.playState = next;
      this.phase = 'idle';
      this.publish();
      return true;
    } catch (error) {
      if (this.abandoned(token)) return false;
      this.phase = 'error';
      this.error = this.deps.errorMessage(error, 'Abandoning failed.');
      this.publish();
      return false;
    }
  }

  async play(): Promise<CollectionPlayResult | null> {
    const matchup = this.playState?.pendingGame ?? null;
    if (this.isDisposed() || matchup === null || this.phase !== 'idle') return null;
    const token = this.begin();
    this.phase = 'simulating';
    this.error = null;
    this.publish();
    try {
      const completed = await this.deps.runGame(matchup);
      if (this.abandoned(token)) return null;
      this.phase = 'committing';
      this.publish();
      const completedAtIso = this.deps.clock.nowIso();
      try {
        const accepted =
          matchup.gameVersion === 'collection-game-v3'
            ? await this.acceptChallenge(completed, completedAtIso)
            : await this.acceptBasic(completed, completedAtIso);
        if (this.abandoned(token)) return null;
        this.playState = accepted.playState;
        this.phase = 'idle';
        this.publish();
        await this.deps.reloadCollection();
        if (this.abandoned(token)) return null;
        return { record: accepted.record };
      } catch (acceptError) {
        const recovered = await this.deps.loadCommittedGame(matchup.gameId).catch(() => null);
        if (this.abandoned(token)) return null;
        if (recovered === null) throw acceptError;
        await this.load();
        if (this.abandoned(token)) return null;
        await this.deps.reloadCollection();
        if (this.abandoned(token)) return null;
        this.phase = 'idle';
        this.publish();
        return { record: recovered };
      }
    } catch (error) {
      if (this.abandoned(token)) return null;
      this.phase = 'error';
      this.error = this.deps.errorMessage(error, 'The game failed. Try again.');
      this.publish();
      await this.load().catch(() => undefined);
      return null;
    }
  }

  cancel(): void {
    if (this.phase === 'idle') return;
    this.token += 1;
    this.phase = 'idle';
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
    this.token += 1;
    this.listeners.clear();
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private begin(): number {
    this.token += 1;
    return this.token;
  }

  private abandoned(token: number): boolean {
    return this.isDisposed() || token !== this.token;
  }

  private async acceptBasic(
    completed: CollectionGameWorkerCompleteMessage,
    completedAtIso: string,
  ): Promise<{ playState: CollectionPlayState; record: CollectionGameRecordUnion }> {
    return this.deps.acceptBasicGameResult({
      result: completed.result,
      events: completed.events,
      completedAtIso,
      recordedAtIso: this.deps.clock.nowIso(),
    });
  }

  private async acceptChallenge(
    completed: CollectionGameWorkerCompleteMessage,
    completedAtIso: string,
  ): Promise<{ playState: CollectionPlayState; record: CollectionGameRecordUnion }> {
    if (completed.result.gameVersion !== 'collection-game-v3') {
      throw new Error('The worker returned a result for a different game version.');
    }
    return this.deps.acceptChallengeGameResult({
      result: completed.result,
      events: completed.events,
      completedAtIso,
      recordedAtIso: this.deps.clock.nowIso(),
    });
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
