import type {
  DraftDuelCard,
  DraftDuelCommand,
  DraftDuelDraft,
  DraftDuelGameOutput,
  DraftDuelOfferedPick,
  DraftDuelParticipantId,
  DraftDuelPartiallyVerified,
  DraftDuelRoomCode,
  DraftDuelRoomSnapshot,
  DraftDuelSeriesGame,
  DraftDuelTransientEvent,
  DraftDuelVersionLocks,
  Id,
} from '@hoop-rush/data-contracts';
import { DRAFT_DUEL_MULTIPLAYER_VERSION } from '@hoop-rush/data-contracts';
import {
  draftDuelCurrentPicker,
  draftDuelLegalPicks,
  draftDuelRepositionPlan,
  draftDuelRepositionSlots,
  draftDuelRoster,
} from '@hoop-rush/engine';
import type { StoredDraftDuelCompleted } from '@hoop-rush/persistence';
import {
  draftDuelPlayedGames,
  draftDuelSeriesMvpOf,
  draftDuelSeriesStandoutsOf,
  type DraftDuelSession,
  type DraftDuelSessionAssets,
  type ReactionKey,
} from '@hoop-rush/application/draft-duel';
import { createDraftDuelSession } from './draft-duel-session';
import type { RoomConnection } from '@hoop-rush/application/multiplayer';
import {
  gamecastVisibleEventCount,
  gamecastVisibleState,
  type GamecastVisibleState,
} from '#lib/gamecast/gamecast-playback.js';
import { draftDuelFeedLines, type DraftDuelFeedLine } from './draft-duel-broadcast-view';
import { isLiteMode } from '#lib/device-capabilities.js';
import { PlaybackCadence, presentationIntervalMs } from '#lib/playback-cadence.js';

const CONSIDERATION_CLEAR_MS = 2000;

function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export class DraftDuelPresenter {
  readonly session: DraftDuelSession;

  assets = $state.raw<DraftDuelSessionAssets | null>(null);
  snapshot = $state.raw<DraftDuelRoomSnapshot | null>(null);
  participantId = $state<DraftDuelParticipantId | null>(null);
  draft = $state.raw<DraftDuelDraft | null>(null);
  outputs = $state.raw<Record<number, DraftDuelGameOutput>>({});
  verification = $state.raw<DraftDuelPartiallyVerified[]>([]);
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
  consideration = $state<{ displayName: string; seasonKey: string } | null>(null);
  reaction = $state<{
    participantId: DraftDuelParticipantId;
    reaction: ReactionKey;
    atMs: number;
  } | null>(null);
  muted = $state(false);
  private commands = $state.raw<DraftDuelCommand[]>([]);
  private completedRecap = $state.raw<StoredDraftDuelCompleted | null>(null);
  private errorState = $state<string | null>(null);
  private unsubscribe: (() => void) | null = null;
  private unsubscribeTransient: (() => void) | null = null;
  private rafId: number | null = null;
  private playbackLastFrameMs: number | null = null;
  private playbackCadence: PlaybackCadence | null = null;
  private considerationTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(session: DraftDuelSession = createDraftDuelSession()) {
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

  phase = $derived(this.snapshot?.phase ?? 'lobby');
  series = $derived(this.snapshot?.series ?? null);
  currentGameNumber = $derived(this.series?.currentGameNumber ?? null);
  currentOutput = $derived(
    this.currentGameNumber !== null ? (this.outputs[this.currentGameNumber] ?? null) : null,
  );
  currentBroadcast = $derived(this.snapshot?.broadcast ?? null);
  showingBroadcast = $derived(
    this.currentOutput !== null &&
      this.currentBroadcast !== null &&
      (this.phase === 'broadcasting' || (this.phase === 'game-results' && this.progress < 1)),
  );
  roundIndex = $derived(this.draft ? Math.min(4, Math.floor(this.draft.pickOrdinal / 2)) : 0);
  currentPicker = $derived(
    this.draft && this.draft.status === 'drafting' ? draftDuelCurrentPicker(this.draft) : null,
  );
  localRoster = $derived(
    this.draft && this.assets && this.participantId
      ? draftDuelRoster(this.draft, this.assets.catalog, this.participantId)
      : null,
  );
  rivalRoster = $derived(
    this.draft && this.assets && this.participantId
      ? draftDuelRoster(this.draft, this.assets.catalog, otherParticipant(this.participantId))
      : null,
  );
  localPicks = $derived.by<DraftDuelOfferedPick[]>(() => {
    if (!this.draft || !this.assets || !this.participantId || this.draft.status !== 'drafting') {
      return [];
    }
    if (this.currentPicker === this.participantId) {
      return draftDuelLegalPicks(this.draft, this.assets.catalog);
    }
    const round = this.draft.rounds[this.roundIndex];
    const pool = round?.offers[this.participantId] ?? [];
    return pool.map((card, slot) => ({
      slot,
      card,
      available: false,
      reason: 'turn',
    }));
  });
  allowDisplacement = $derived(
    this.snapshot?.settings.versions.multiplayerVersion === DRAFT_DUEL_MULTIPLAYER_VERSION,
  );
  visiblePicks = $derived.by<DraftDuelOfferedPick[]>(() => {
    if (!this.draft || !this.assets || !this.currentPicker) return [];
    return draftDuelLegalPicks(this.draft, this.assets.catalog, {
      allowDisplacement: this.allowDisplacement,
    });
  });
  rivalPool = $derived.by<DraftDuelCard[]>(() => {
    if (!this.draft || !this.participantId) return [];
    const round = this.draft.rounds[this.roundIndex];
    return [...(round?.offers[otherParticipant(this.participantId)] ?? [])];
  });
  activeTurn = $derived(
    this.phase === 'drafting' &&
      this.draft?.status === 'drafting' &&
      this.currentPicker === this.participantId &&
      !this.busy,
  );
  visibleCount = $derived(
    this.currentOutput ? gamecastVisibleEventCount(this.currentOutput.tape, this.progress) : 0,
  );
  visible = $derived.by<GamecastVisibleState | null>(() =>
    this.currentOutput ? gamecastVisibleState(this.currentOutput, this.visibleCount) : null,
  );
  feed = $derived.by<DraftDuelFeedLine[]>(() =>
    this.currentOutput ? draftDuelFeedLines(this.currentOutput, this.visibleCount) : [],
  );
  playedGames = $derived(draftDuelPlayedGames(this.series, this.outputs));
  seriesMvp = $derived(
    draftDuelSeriesMvpOf({
      catalog: this.assets?.catalog ?? null,
      draft: this.draft,
      series: this.series,
      playedGames: this.playedGames,
      completedRecap: this.completedRecap,
    }),
  );
  seriesStandouts = $derived(
    draftDuelSeriesStandoutsOf({
      catalog: this.assets?.catalog ?? null,
      draft: this.draft,
      series: this.series,
      playedGames: this.playedGames,
      completedRecap: this.completedRecap,
    }),
  );
  rivalRematchRequested = $derived.by(() =>
    this.commands.some(
      (command) =>
        command.payload.kind === 'rematch-request' &&
        command.actorParticipantId !== this.participantId,
    ),
  );
  myRematchRequested = $derived.by(() =>
    this.commands.some(
      (command) =>
        command.payload.kind === 'rematch-request' &&
        command.actorParticipantId === this.participantId,
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
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    return this.session.createRoom(fairness, presentation);
  }

  roomVersions(): Promise<DraftDuelVersionLocks> {
    return this.session.roomVersions();
  }

  joinRoom(code: string): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    return this.session.joinRoom(code);
  }

  updateSettings(
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<void> {
    return this.session.updateSettings(fairness, presentation);
  }

  setReady(ready: boolean): Promise<void> {
    return this.session.setReady(ready);
  }

  startDraft(): Promise<void> {
    return this.session.startDraft();
  }

  pickOffer(pick: DraftDuelOfferedPick, slotIndex: number): Promise<void> {
    return this.session.pickOffer(pick, slotIndex);
  }

  repositionCard(card: DraftDuelCard, slotIndex: number): Promise<void> {
    return this.session.repositionCard(card, slotIndex);
  }

  repositionSlots(card: DraftDuelCard): number[] {
    if (!this.draft || !this.assets || !this.participantId) return [];
    if (this.draft.status !== 'drafting') return [];
    try {
      return draftDuelRepositionSlots(
        this.draft,
        this.assets.catalog,
        this.participantId,
        card.playerVersionId,
      );
    } catch {
      return [];
    }
  }

  repositionMoves(
    card: DraftDuelCard,
    slotIndex: number,
  ): Array<{ displayName: string; toSlot: number }> {
    if (!this.draft || !this.assets || !this.participantId) return [];
    try {
      const roster = draftDuelRoster(this.draft, this.assets.catalog, this.participantId);
      const plan = draftDuelRepositionPlan(roster.slots, card, slotIndex);
      return (
        plan
          ?.filter((placement) => placement.card.playerVersionId !== card.playerVersionId)
          .map((placement) => ({
            displayName: placement.card.displayName,
            toSlot: placement.slotIndex,
          })) ?? []
      );
    } catch {
      return [];
    }
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

  async consider(card: DraftDuelCard | null): Promise<void> {
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

  seriesGameEntries(): DraftDuelSeriesGame[] {
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
    this.participantId = view.participantId;
    this.draft = view.draft;
    this.outputs = view.outputs;
    this.verification = view.verification;
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
    if (!this.snapshot?.broadcast) return;
    this.playbackLastFrameMs = null;
    this.playbackCadence = new PlaybackCadence(presentationIntervalMs(isLiteMode()));
    if (this.rafId !== null) return;
    this.session.beginPlayback();
    this.session.advancePlayback(0);
    const loop = () => {
      if (this.disposed || !this.snapshot?.broadcast) {
        this.rafId = null;
        return;
      }
      const nowMs = Date.now();
      const lastFrameMs = this.playbackLastFrameMs ?? nowMs;
      this.playbackLastFrameMs = nowMs;
      const advanceMs = this.playbackCadence?.add(nowMs - lastFrameMs) ?? null;
      if (advanceMs === null) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }
      this.session.advancePlayback(advanceMs);
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
    this.playbackCadence = null;
  }

  private onTransient(event: DraftDuelTransientEvent): void {
    if (this.disposed || event.participantId === this.participantId) return;
    if (event.kind === 'consideration') {
      const assets = this.assets;
      if (!assets) return;
      const entry = assets.catalog.byVersionId.get(event.playerVersionId);
      if (!entry) return;
      const consideration = {
        displayName: entry.card.displayName,
        seasonKey: entry.card.seasonKey,
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
