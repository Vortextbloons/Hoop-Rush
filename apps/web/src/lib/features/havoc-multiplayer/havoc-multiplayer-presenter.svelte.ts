import type {
  HavocDraftCard,
  HavocMultiplayerCommand,
  HavocMultiplayerDraftState,
  HavocMultiplayerMemberSnapshot,
  HavocMultiplayerParticipantId,
  HavocMultiplayerPhase,
  HavocMultiplayerRoomCode,
  HavocMultiplayerRoomSnapshot,
  HavocMultiplayerSeriesGame,
  HavocMultiplayerTransientEvent,
  HavocMultiplayerVariant,
  HavocMultiplayerVersionLocks,
  Id,
} from '@hoop-rush/data-contracts';
import type {
  HavocMultiplayerGameOutput,
  HavocMultiplayerSeriesMvp,
  StoredHavocMultiplayerCompleted,
} from '@hoop-rush/persistence';
import type {
  HavocMultiplayerGameVerification,
  HavocMultiplayerSession,
  HavocMultiplayerSessionAssets,
  ReactionKey,
} from '@hoop-rush/application/havoc-multiplayer';
import { createHavocMultiplayerSession } from './havoc-multiplayer-session';
import type { RoomConnection } from '@hoop-rush/application/multiplayer';
import {
  havocMultiplayerFeedLines,
  havocMultiplayerPlaybackItems,
  havocMultiplayerVisibleItemCount,
  havocMultiplayerVisibleState,
  type HavocMultiplayerFeedLine,
  type HavocMultiplayerVisibleState,
} from './havoc-multiplayer-playback';

const CONSIDERATION_CLEAR_MS = 2000;

export interface HavocMultiplayerConsideration {
  displayName: string;
  seasonKey: string | null;
}

export interface HavocMultiplayerReaction {
  participantId: HavocMultiplayerParticipantId;
  reaction: ReactionKey;
  atMs: number;
}

export class HavocMultiplayerPresenter {
  readonly session: HavocMultiplayerSession;

  assets = $state.raw<HavocMultiplayerSessionAssets | null>(null);
  snapshot = $state.raw<HavocMultiplayerRoomSnapshot | null>(null);
  participantId = $state.raw<HavocMultiplayerParticipantId | null>(null);
  draft = $state.raw<HavocMultiplayerDraftState | null>(null);
  outputs = $state.raw<Record<number, HavocMultiplayerGameOutput>>({});
  verification = $state.raw<HavocMultiplayerGameVerification[]>([]);
  mvp = $state.raw<HavocMultiplayerSeriesMvp | null>(null);
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
  consideration = $state<HavocMultiplayerConsideration | null>(null);
  reaction = $state<HavocMultiplayerReaction | null>(null);
  muted = $state(false);
  completedRecap = $state.raw<StoredHavocMultiplayerCompleted | null>(null);
  private commands = $state.raw<HavocMultiplayerCommand[]>([]);
  private errorState = $state<string | null>(null);
  private unsubscribe: (() => void) | null = null;
  private unsubscribeTransient: (() => void) | null = null;
  private rafId: number | null = null;
  private playbackLastFrameMs: number | null = null;
  private considerationTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(session: HavocMultiplayerSession = createHavocMultiplayerSession()) {
    this.session = session;
    this.unsubscribe = session.subscribe(() => {
      this.mirror();
    });
    this.unsubscribeTransient = session.subscribeTransient((event) => {
      this.onTransient(event);
    });
    this.mirror();
  }

  get error(): string | null {
    return this.errorState;
  }

  set error(message: string | null) {
    this.session.setError(message);
  }

  phase = $derived<HavocMultiplayerPhase>(this.snapshot?.phase ?? 'lobby');
  variant = $derived<HavocMultiplayerVariant>(this.snapshot?.settings.variant ?? 'standard');
  members = $derived<readonly HavocMultiplayerMemberSnapshot[]>(this.snapshot?.members ?? []);
  series = $derived(this.snapshot?.series ?? null);
  offer = $derived(this.draft?.offer ?? null);
  deadline = $derived(this.snapshot?.deadline ?? null);
  currentGameNumber = $derived(
    this.series?.games.find((game) => game.status !== 'verified')?.gameNumber ?? null,
  );
  currentOutput = $derived(
    this.currentGameNumber !== null ? (this.outputs[this.currentGameNumber] ?? null) : null,
  );
  currentBroadcast = $derived(this.snapshot?.broadcast ?? null);
  showingBroadcast = $derived(
    this.currentOutput !== null &&
      this.currentBroadcast !== null &&
      (this.phase === 'broadcasting' || (this.phase === 'game-results' && this.progress < 1)),
  );
  playbackItems = $derived(
    this.currentOutput ? havocMultiplayerPlaybackItems(this.currentOutput.tape) : [],
  );
  visibleCount = $derived(
    this.currentOutput ? havocMultiplayerVisibleItemCount(this.playbackItems, this.progress) : 0,
  );
  visible = $derived.by<HavocMultiplayerVisibleState | null>(() =>
    this.currentOutput ? havocMultiplayerVisibleState(this.playbackItems, this.visibleCount) : null,
  );
  feed = $derived.by<HavocMultiplayerFeedLine[]>(() =>
    this.currentOutput
      ? havocMultiplayerFeedLines(this.currentOutput, this.playbackItems, this.visibleCount)
      : [],
  );
  activeTurn = $derived(
    this.phase === 'drafting' &&
      this.draft?.status === 'drafting' &&
      this.draft.activeParticipantId === this.participantId &&
      !this.busy,
  );
  myRematchRequested = $derived.by(() =>
    this.commands.some(
      (command) =>
        command.payload.kind === 'rematch-request' &&
        command.actorParticipantId === this.participantId,
    ),
  );
  rivalRematchRequested = $derived.by(() =>
    this.commands.some(
      (command) =>
        command.payload.kind === 'rematch-request' &&
        command.actorParticipantId !== this.participantId,
    ),
  );
  successorRoomId = $derived(this.snapshot?.successorRoomId ?? null);

  attach(roomId: string): Promise<void> {
    return this.session.attach(roomId);
  }

  refresh(): Promise<void> {
    return this.session.refresh();
  }

  createRoom(
    variant: HavocMultiplayerVariant = 'standard',
  ): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    return this.session.createRoom(variant);
  }

  roomVersions(): Promise<HavocMultiplayerVersionLocks> {
    return this.session.roomVersions();
  }

  joinRoom(code: string): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    return this.session.joinRoom(code);
  }

  setReady(): Promise<void> {
    return this.session.setReady();
  }

  startDraft(): Promise<void> {
    return this.session.startDraft();
  }

  pickCard(card: HavocDraftCard): Promise<boolean> {
    return this.session.pickCard(card);
  }

  rerollOffer(): Promise<boolean> {
    return this.session.rerollOffer();
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

  async leaveRoom(): Promise<void> {
    await this.session.leaveRoom();
    this.stopPlayback();
  }

  async consider(card: HavocDraftCard | null): Promise<void> {
    if (!this.snapshot || !this.participantId || !this.draft) return;
    this.consideration = null;
    if (!card) return;
    await this.session.consider(card);
  }

  async react(reaction: ReactionKey): Promise<void> {
    if (this.muted) return;
    await this.session.react(reaction);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  continueAfterGame(): void {
    this.session.continueAfterGame();
  }

  seriesGameEntries(): HavocMultiplayerSeriesGame[] {
    return this.series?.games ?? [];
  }

  dispose(): void {
    this.disposed = true;
    this.stopPlayback();
    if (this.considerationTimer !== null) {
      clearTimeout(this.considerationTimer);
      this.considerationTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeTransient?.();
    this.unsubscribeTransient = null;
    this.session.dispose();
  }

  private mirror(): void {
    if (this.disposed) return;
    const view = this.session.getSnapshot();
    const previousBroadcastGame = this.snapshot?.broadcast?.gameNumber ?? null;
    this.assets = view.assets;
    this.snapshot = view.snapshot;
    this.participantId = view.localRole;
    this.draft = view.draft;
    this.outputs = view.outputs;
    this.verification = view.verification;
    this.mvp = view.mvp;
    this.commands = view.commands;
    this.completedRecap = view.completedRecap;
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
    const broadcastGame = view.snapshot?.broadcast?.gameNumber ?? null;
    if (broadcastGame !== null && broadcastGame !== previousBroadcastGame) {
      this.startPlayback();
    }
    if (view.snapshot?.broadcast == null && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startPlayback(): void {
    if (this.disposed) return;
    if (!this.currentBroadcast) return;
    this.playbackLastFrameMs = null;
    if (this.rafId !== null) return;
    this.session.beginPlayback();
    const loop = () => {
      if (this.disposed || !this.currentBroadcast) {
        this.rafId = null;
        return;
      }
      const nowMs = Date.now();
      const lastFrameMs = this.playbackLastFrameMs ?? nowMs;
      this.playbackLastFrameMs = nowMs;
      this.session.advancePlayback(nowMs - lastFrameMs);
      if (this.session.getSnapshot().progress >= 1) {
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopPlayback(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private draftCardOf(cardId: string): HavocDraftCard | null {
    const offer = this.draft?.offer ?? null;
    const offered = offer?.cards.find((card) => card.cardId === cardId);
    if (offered !== undefined) return offered;
    const picked = this.draft?.picks.find((pick) => pick.card.cardId === cardId);
    return picked?.card ?? null;
  }

  private onTransient(event: HavocMultiplayerTransientEvent): void {
    if (this.disposed || event.participantId === this.participantId) return;
    if (event.kind === 'consideration') {
      const card = this.draftCardOf(event.cardId);
      if (!card) return;
      const consideration: HavocMultiplayerConsideration = {
        displayName: card.source.displayName,
        seasonKey: card.source.seasonKey,
      };
      this.consideration = consideration;
      if (this.considerationTimer !== null) clearTimeout(this.considerationTimer);
      this.considerationTimer = setTimeout(() => {
        this.considerationTimer = null;
        if (!this.disposed && this.consideration === consideration) {
          this.consideration = null;
        }
      }, CONSIDERATION_CLEAR_MS);
      return;
    }
    if (!this.muted) {
      this.reaction = {
        participantId: event.participantId,
        reaction: event.reaction,
        atMs: event.sentAtMs,
      };
    }
  }
}
