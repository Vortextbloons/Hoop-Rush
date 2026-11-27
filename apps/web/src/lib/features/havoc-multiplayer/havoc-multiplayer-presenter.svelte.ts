import type {
  HavocDraftCard,
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
  HavocMultiplayerCompletionRecap,
  HavocMultiplayerGameOutput,
  HavocMultiplayerSeriesMvp,
} from '@hoop-rush/persistence';
import type {
  HavocMultiplayerGameVerification,
  HavocMultiplayerSession,
  HavocMultiplayerSessionAssets,
  HavocMultiplayerSessionView,
  ReactionKey,
} from '@hoop-rush/application/havoc-multiplayer';
import { createHavocMultiplayerSession } from './havoc-multiplayer-session';
import {
  gamecastBattleFeedCursor,
  gamecastBattlePlaybackFold,
  gamecastBattlePlaybackItems,
  gamecastBattleVisibleItemCount,
  type GamecastBattleFeedCursor,
  type GamecastBattleFeedLine,
  type GamecastBattlePlaybackItem,
  type GamecastBattleVisibleState,
} from '#lib/gamecast/gamecast-battle-playback.js';
import {
  reactionFromTransient,
  RoomConsiderationTimer,
} from '#lib/features/multiplayer/room-presenter-plumbing.js';
import { RoomPresenterCore } from '#lib/features/multiplayer/room-presenter-core.svelte.js';

export interface HavocMultiplayerConsideration {
  displayName: string;
  seasonKey: string | null;
}

export interface HavocMultiplayerReaction {
  participantId: HavocMultiplayerParticipantId;
  reaction: ReactionKey;
  atMs: number;
}

export class HavocMultiplayerPresenter extends RoomPresenterCore<
  HavocMultiplayerParticipantId,
  HavocMultiplayerTransientEvent,
  HavocMultiplayerSessionView,
  HavocMultiplayerSession
> {
  assets = $state.raw<HavocMultiplayerSessionAssets | null>(null);
  snapshot = $state.raw<HavocMultiplayerRoomSnapshot | null>(null);
  draft = $state.raw<HavocMultiplayerDraftState | null>(null);
  outputs = $state.raw<Record<number, HavocMultiplayerGameOutput>>({});
  verification = $state.raw<HavocMultiplayerGameVerification[]>([]);
  mvp = $state.raw<HavocMultiplayerSeriesMvp | null>(null);
  consideration = $state<HavocMultiplayerConsideration | null>(null);
  reaction = $state<HavocMultiplayerReaction | null>(null);
  muted = $state(false);
  completedRecap = $state.raw<HavocMultiplayerCompletionRecap | null>(null);
  private readonly considerationTimer = new RoomConsiderationTimer<HavocMultiplayerConsideration>(
    (value) => {
      this.consideration = value;
    },
    () => this.consideration,
  );

  constructor(session: HavocMultiplayerSession = createHavocMultiplayerSession()) {
    super(session);
    this.connect();
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
    this.currentOutput ? gamecastBattlePlaybackItems(this.currentOutput.tape) : [],
  );
  visibleCount = $derived(
    this.currentOutput ? gamecastBattleVisibleItemCount(this.playbackItems, this.progress) : 0,
  );
  private foldItems: readonly GamecastBattlePlaybackItem[] | null = null;
  private visibleFold = gamecastBattlePlaybackFold([]);
  visible = $derived.by<GamecastBattleVisibleState | null>(() => {
    if (!this.currentOutput) return null;
    if (this.foldItems !== this.playbackItems) {
      this.foldItems = this.playbackItems;
      this.visibleFold = gamecastBattlePlaybackFold(this.playbackItems);
    }
    return this.visibleFold.visibleAt(this.visibleCount);
  });
  private feedItems: readonly GamecastBattlePlaybackItem[] | null = null;
  private feedCursor: GamecastBattleFeedCursor | null = null;
  feed = $derived.by<GamecastBattleFeedLine[]>(() => {
    if (!this.currentOutput) return [];
    if (this.feedItems !== this.playbackItems) {
      this.feedItems = this.playbackItems;
      this.feedCursor = gamecastBattleFeedCursor(this.currentOutput, this.playbackItems);
    }
    return this.feedCursor?.linesAt(this.visibleCount) ?? [];
  });
  activeTurn = $derived(
    this.phase === 'drafting' &&
      this.draft?.status === 'drafting' &&
      this.draft.activeParticipantId === this.participantId &&
      !this.busy,
  );
  successorRoomId = $derived(this.snapshot?.successorRoomId ?? null);

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

  seriesGameEntries(): HavocMultiplayerSeriesGame[] {
    return this.series?.games ?? [];
  }

  protected participantIdOf(
    view: HavocMultiplayerSessionView,
  ): HavocMultiplayerParticipantId | null {
    return view.localRole;
  }

  protected mirrorView(view: HavocMultiplayerSessionView): void {
    this.assets = view.assets;
    this.snapshot = view.snapshot;
    this.draft = view.draft;
    this.outputs = view.outputs;
    this.verification = view.verification;
    this.mvp = view.mvp;
    this.completedRecap = view.completedRecap;
  }

  protected onDispose(): void {
    this.considerationTimer.clear();
  }

  private draftCardOf(cardId: string): HavocDraftCard | null {
    const offer = this.draft?.offer ?? null;
    const offered = offer?.cards.find((card) => card.cardId === cardId);
    if (offered !== undefined) return offered;
    const picked = this.draft?.picks.find((pick) => pick.card.cardId === cardId);
    return picked?.card ?? null;
  }

  protected onTransient(event: HavocMultiplayerTransientEvent): void {
    if (this.disposed || event.participantId === this.participantId) return;
    if (event.kind === 'consideration') {
      const card = this.draftCardOf(event.cardId);
      if (!card) return;
      this.considerationTimer.show({
        displayName: card.source.displayName,
        seasonKey: card.source.seasonKey,
      });
      return;
    }
    const reaction = reactionFromTransient(event, {
      muted: this.muted,
      participantId: this.participantId,
    });
    if (reaction) this.reaction = reaction;
  }
}
