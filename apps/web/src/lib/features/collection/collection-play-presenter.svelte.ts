import type { CollectionGameRecordUnion, CollectionPlayState } from '@hoop-rush/data-contracts';
import {
  CollectionPlaySession,
  type CollectionPlayPhase,
  type CollectionPlaySessionDeps,
  type CollectionPrepareInput,
} from './collection-play-session.ts';

export class CollectionPlayPresenter {
  playState = $state.raw<CollectionPlayState | null>(null);
  rootSeed = $state<string | null>(null);
  phase = $state<CollectionPlayPhase>('idle');
  error = $state<string | null>(null);
  private session: CollectionPlaySession | null = null;
  private unsubscribe: (() => void) | null = null;

  get busy(): 'idle' | 'preparing' | 'playing' | 'committing' {
    if (this.phase === 'preparing' || this.phase === 'abandoning') return 'preparing';
    if (this.phase === 'simulating') return 'playing';
    if (this.phase === 'committing') return 'committing';
    return 'idle';
  }

  get pending() {
    return this.playState?.pendingGame ?? null;
  }

  init(deps: CollectionPlaySessionDeps): void {
    if (this.session !== null) return;
    const session = new CollectionPlaySession(deps);
    this.session = session;
    this.unsubscribe = session.subscribe(() => {
      this.mirror();
    });
    this.mirror();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session?.dispose();
    this.session = null;
  }

  async load(): Promise<void> {
    await this.session?.load();
  }

  async prepare(input: CollectionPrepareInput): Promise<boolean> {
    return (await this.session?.prepare(input)) ?? false;
  }

  async abandon(): Promise<boolean> {
    return (await this.session?.abandon()) ?? false;
  }

  async play(): Promise<CollectionGameRecordUnion | null> {
    const result = await this.session?.play();
    return result?.record ?? null;
  }

  cancel(): void {
    this.session?.cancel();
  }

  private mirror(): void {
    const snapshot = this.session?.getSnapshot();
    if (snapshot === undefined) return;
    this.playState = snapshot.playState;
    this.rootSeed = snapshot.rootSeed;
    this.phase = snapshot.phase;
    this.error = snapshot.error;
  }
}
