import type { Id } from '@hoop-rush/data-contracts';
import type { RoomConnection } from '@hoop-rush/application/multiplayer';
import { rematchRequested, RoomPlaybackLoop } from './room-presenter-plumbing.js';

/** The room command fields rematch selectors need, shared by both modes. */
export interface RoomPresenterCommand {
  readonly payload: { readonly kind: string };
  readonly actorParticipantId: string;
}

/** The session-view fields both room presenters mirror unchanged. */
export interface RoomPresenterView {
  connection: RoomConnection;
  snapshot: { readonly broadcast: { readonly gameNumber: number } | null } | null;
  commands: readonly RoomPresenterCommand[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  integrityFailed: boolean;
  progress: number;
  awaitingContinue: boolean;
  localReady: boolean;
  opponentReady: boolean;
  readyCountdownMs: number | null;
  deadlineMsLeft: number | null;
}

/** The room-session surface both presenters drive identically. */
export interface RoomPresenterSession<TView extends RoomPresenterView, TTransient> {
  getSnapshot(): TView;
  subscribe(listener: () => void): () => void;
  subscribeTransient(listener: (event: TTransient) => void): () => void;
  setError(message: string | null): void;
  dispose(): void;
  attach(roomId: string): Promise<void>;
  retryAttach(): Promise<void>;
  refresh(): Promise<void>;
  leaveRoom(): Promise<void>;
  readyForNextGame(): Promise<void>;
  startBroadcast(auto?: boolean): Promise<void>;
  requestRematch(): Promise<void>;
  confirmRematch(): Promise<void>;
  followRematch(): Promise<Id | null>;
  removeGuest(): Promise<void>;
  continueAfterGame(): void;
  beginPlayback(): void;
  advancePlayback(advanceMs: number): void;
}

/**
 * Reactive owner for the session-to-view state, subscriptions, ready/rematch
 * commands, and replay playback shared by the room presenters. Modes keep
 * their own selectors, gamecast folds, and transient handlers, and map their
 * mode-specific fields in `mirrorView`.
 */
export abstract class RoomPresenterCore<
  TParticipantId extends string,
  TTransient,
  TView extends RoomPresenterView,
  TSession extends RoomPresenterSession<TView, TTransient>,
> {
  readonly session: TSession;

  participantId = $state<TParticipantId | null>(null);
  busy = $state(false);
  connection = $state<RoomConnection>('idle');
  notice = $state<string | null>(null);
  integrityFailed = $state(false);
  progress = $state(0);
  awaitingContinue = $state(false);
  localReady = $state(false);
  opponentReady = $state(false);
  readyCountdownMs = $state<number | null>(null);
  deadlineMsLeft = $state<number | null>(null);
  private commands = $state.raw<readonly RoomPresenterCommand[]>([]);
  private errorState = $state<string | null>(null);
  private unsubscribe: (() => void) | null = null;
  private unsubscribeTransient: (() => void) | null = null;
  private readonly playback = new RoomPlaybackLoop();
  private previousBroadcastGame: number | null = null;
  protected disposed = false;
  myRematchRequested = $derived(rematchRequested(this.commands, this.participantId, true));
  rivalRematchRequested = $derived(rematchRequested(this.commands, this.participantId, false));

  constructor(session: TSession) {
    this.session = session;
  }

  get error(): string | null {
    return this.errorState;
  }

  set error(message: string | null) {
    this.session.setError(message);
  }

  attach(roomId: string): Promise<void> {
    return this.session.attach(roomId);
  }

  /** Retry the whole room attachment after a failed load. */
  retryAttach(): Promise<void> {
    return this.session.retryAttach();
  }

  refresh(): Promise<void> {
    return this.session.refresh();
  }

  readyForNextGame(): Promise<void> {
    return this.session.readyForNextGame();
  }

  startBroadcast(auto = false): Promise<void> {
    return this.session.startBroadcast(auto);
  }

  requestRematch(): Promise<void> {
    return this.session.requestRematch();
  }

  confirmRematch(): Promise<void> {
    return this.session.confirmRematch();
  }

  followRematch(): Promise<Id | null> {
    return this.session.followRematch();
  }

  removeGuest(): Promise<void> {
    return this.session.removeGuest();
  }

  continueAfterGame(): void {
    this.session.continueAfterGame();
  }

  async leaveRoom(): Promise<void> {
    await this.session.leaveRoom();
    this.stopPlayback();
  }

  dispose(): void {
    this.disposed = true;
    this.stopPlayback();
    this.onDispose();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeTransient?.();
    this.unsubscribeTransient = null;
    this.session.dispose();
  }

  /** Called once at the end of each mode presenter's constructor. */
  protected connect(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.session.subscribe(() => {
      this.mirror();
    });
    this.unsubscribeTransient = this.session.subscribeTransient((event) => {
      this.onTransient(event);
    });
    this.mirror();
  }

  protected abstract participantIdOf(view: TView): TParticipantId | null;
  protected abstract mirrorView(view: TView): void;
  protected abstract onTransient(event: TTransient): void;
  protected abstract onDispose(): void;

  private mirror(): void {
    if (this.disposed) return;
    const view = this.session.getSnapshot();
    this.participantId = this.participantIdOf(view);
    this.commands = view.commands;
    this.busy = view.busy;
    this.connection = view.connection;
    this.errorState = view.error;
    this.notice = view.notice;
    this.integrityFailed = view.integrityFailed;
    this.progress = view.progress;
    this.awaitingContinue = view.awaitingContinue;
    this.localReady = view.localReady;
    this.opponentReady = view.opponentReady;
    this.readyCountdownMs = view.readyCountdownMs;
    this.deadlineMsLeft = view.deadlineMsLeft;
    this.mirrorView(view);
    const broadcastGame = view.snapshot?.broadcast?.gameNumber ?? null;
    const broadcastChanged = broadcastGame !== null && broadcastGame !== this.previousBroadcastGame;
    // Record the game before starting: begin/advance publish synchronously, and
    // the reentrant mirror must not start a second frame loop.
    this.previousBroadcastGame = broadcastGame;
    if (broadcastChanged) this.startPlayback();
    if (view.snapshot?.broadcast == null && this.playback.active) {
      this.stopPlayback();
    }
  }

  private stopPlayback(): void {
    this.playback.stop();
  }

  private startPlayback(): void {
    this.playback.start({
      isDisposed: () => this.disposed,
      hasBroadcast: () => this.previousBroadcastGame !== null,
      beginPlayback: () => {
        this.session.beginPlayback();
      },
      advancePlayback: (advanceMs) => {
        this.session.advancePlayback(advanceMs);
      },
      progress: () => this.session.getSnapshot().progress,
    });
  }
}
