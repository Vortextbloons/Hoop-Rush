import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  DRAFT_DUEL_MULTIPLAYER_VERSION,
  commandIdSchema,
  defaultDraftDuelVersionLocks,
  idSchema,
  type DraftDuelBroadcast,
  type DraftDuelCard,
  type DraftDuelCommand,
  type DraftDuelDraft,
  type DraftDuelGameOutput,
  type DraftDuelMultiplayerTransport,
  type DraftDuelOfferedPick,
  type DraftDuelParticipantId,
  type DraftDuelPartiallyVerified,
  type DraftDuelRoomCode,
  type DraftDuelRoomMembership,
  type DraftDuelRoomSnapshot,
  type DraftDuelSeriesGame,
  type DraftDuelSeriesMvp,
  type DraftDuelSeriesSnapshot,
  type DraftDuelStandout,
  type DraftDuelTransientEvent,
  type DraftDuelVersionLocks,
  type EraSimulationProfile,
  type GameSimulationInput,
  type HoopRushManifest,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  draftDuelCurrentPicker,
  draftDuelGameSeed,
  draftDuelHomeForGame,
  draftDuelRoster,
  draftDuelSeriesMvp,
  draftDuelSimulationTeam,
  draftDuelStandouts,
  draftDuelTimeoutPick,
  replayDraftDuelLog,
  type DraftDuelCatalog,
  type DraftDuelPlayedGame,
  type DraftDuelSeriesRosters,
  type EngineContext,
} from '@hoop-rush/engine';
import type {
  DraftDuelActiveState,
  DraftDuelCompletionRecap,
  StoredDraftDuelActive,
  StoredDraftDuelCompleted,
  StoredDraftDuelResultRow,
} from '@hoop-rush/persistence';
import {
  CoalescedTask,
  SessionEvents,
  TickLoop,
  intervalTickScheduler,
  type TickScheduler,
} from '../runtime/index.ts';
import {
  RoomLifecycle,
  type RoomAttachment,
  type RoomConnection,
} from '../multiplayer/room-lifecycle.ts';
import { SeriesCoordinator } from '../multiplayer/series-coordinator.ts';
import { CommandRecovery, executeMultiplayerCommand } from '../multiplayer/command-execution.ts';

const TICK_MS = 250;
const AUTO_START_RETRY_MS = 5000;
const GAME_READY_WINDOW_MS = 60_000;
const GAME_RESULTS_HOLD_MS = 60_000;

export type ReactionKey = 'hype' | 'clap' | 'cold' | 'wow';

export interface DraftDuelSessionAssets {
  catalog: DraftDuelCatalog;
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  context: EngineContext;
}

export interface DraftDuelRunnerPort {
  runDraftDuelGame(request: {
    roomId: string;
    input: GameSimulationInput;
  }): Promise<DraftDuelGameOutput>;
  dispose(): void;
}

export interface DraftDuelSeriesFacts {
  catalog: DraftDuelCatalog | null;
  draft: DraftDuelDraft | null;
  series: DraftDuelSeriesSnapshot | null;
  playedGames: readonly DraftDuelPlayedGame[];
  completedRecap: StoredDraftDuelCompleted | null;
}

export interface DraftDuelSessionView {
  connection: RoomConnection;
  assets: DraftDuelSessionAssets | null;
  snapshot: DraftDuelRoomSnapshot | null;
  participantId: DraftDuelParticipantId | null;
  draft: DraftDuelDraft | null;
  outputs: Record<number, DraftDuelGameOutput>;
  verification: DraftDuelPartiallyVerified[];
  commands: DraftDuelCommand[];
  completedRecap: StoredDraftDuelCompleted | null;
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

export interface DraftDuelSessionRepository {
  loadActive(roomId: string): Promise<StoredDraftDuelActive | null>;
  loadCompleted(roomId: string): Promise<StoredDraftDuelCompleted | null>;
  loadResults(roomId: string): Promise<StoredDraftDuelResultRow[]>;
  appendCommands(roomId: string, commands: readonly DraftDuelCommand[]): Promise<void>;
  saveResult(output: DraftDuelGameOutput): Promise<void>;
  saveVerification(roomId: string, entries: readonly DraftDuelPartiallyVerified[]): Promise<void>;
  saveActive(state: DraftDuelActiveState): Promise<void>;
  complete(recap: DraftDuelCompletionRecap): Promise<void>;
}

export interface DraftDuelSessionDeps {
  transport: DraftDuelMultiplayerTransport;
  repository: DraftDuelSessionRepository;
  runner: DraftDuelRunnerPort;
  loadAssets: () => Promise<DraftDuelSessionAssets>;
  now: () => number;
  newCommandId: () => string;
  friendlyError: (error: unknown) => string;
  loadMembership: (roomId: string) => DraftDuelRoomMembership | null;
  saveMembership: (membership: DraftDuelRoomMembership) => void;
  scheduleTick?: TickScheduler;
}

export function draftDuelPlayedGames(
  series: DraftDuelSeriesSnapshot | null,
  outputs: Record<number, DraftDuelGameOutput>,
): DraftDuelPlayedGame[] {
  if (!series) return [];
  const played: DraftDuelPlayedGame[] = [];
  for (const game of series.games) {
    const output = outputs[game.gameNumber];
    if (!output) continue;
    played.push({
      gameNumber: game.gameNumber,
      homeParticipantId: game.homeParticipantId,
      awayParticipantId: game.awayParticipantId,
      result: output.result,
    });
  }
  return played;
}

function draftDuelCompletedRosters(
  draft: DraftDuelDraft | null,
  catalog: DraftDuelCatalog | null,
): DraftDuelSeriesRosters | null {
  if (!draft || !catalog) return null;
  if (draft.status !== 'complete') return null;
  try {
    return {
      p1: draftDuelRoster(draft, catalog, 'p1'),
      p2: draftDuelRoster(draft, catalog, 'p2'),
    };
  } catch {
    return null;
  }
}

export function draftDuelSeriesMvpOf(facts: DraftDuelSeriesFacts): DraftDuelSeriesMvp | null {
  const series = facts.series;
  if (!series?.champion) return null;
  if (facts.catalog) {
    const rosters = draftDuelCompletedRosters(facts.draft, facts.catalog);
    if (rosters && series.games.length > 0 && facts.playedGames.length === series.games.length) {
      return draftDuelSeriesMvp(facts.catalog, rosters, facts.playedGames, series.champion);
    }
  }
  return facts.completedRecap?.mvp ?? null;
}

export function draftDuelSeriesStandoutsOf(facts: DraftDuelSeriesFacts): DraftDuelStandout[] {
  if (facts.catalog && facts.playedGames.length > 0) {
    const rosters = draftDuelCompletedRosters(facts.draft, facts.catalog);
    if (rosters) {
      return draftDuelStandouts(facts.catalog, rosters, facts.playedGames);
    }
  }
  return facts.completedRecap?.standouts ?? [];
}

function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export class DraftDuelSession {
  private readonly deps: DraftDuelSessionDeps;
  private readonly events = new SessionEvents<DraftDuelTransientEvent>();
  private readonly lifecycle = new RoomLifecycle(() => {
    this.publish();
  });
  private attachment: RoomAttachment | null = null;
  private readonly seriesFlow: SeriesCoordinator;
  private readonly commandRecovery = new CommandRecovery();
  private readonly syncTask: CoalescedTask;
  private readonly tickLoop: TickLoop;
  private assets: DraftDuelSessionAssets | null = null;
  private snapshot: DraftDuelRoomSnapshot | null = null;
  private participantId: DraftDuelParticipantId | null = null;
  private draft: DraftDuelDraft | null = null;
  private outputs: Record<number, DraftDuelGameOutput> = {};
  private verification: DraftDuelPartiallyVerified[] = [];
  private completedRecap: StoredDraftDuelCompleted | null = null;
  private commands: DraftDuelCommand[] = [];
  private busy = false;
  private error: string | null = null;
  private notice: string | null = null;
  private integrityFailed = false;
  private progress = 0;
  private now: number;
  private resolvedCursor: string | null = null;
  private deadlineResolving = false;
  private deadlineRetryAtMs = 0;
  private rematchRetryAtMs = 0;
  private pendingReadyGame: number | null = null;
  private pendingReadyRetryAtMs = 0;
  private seenBroadcastGame: number | null = null;
  private completedPersisted = false;
  private disposed = false;
  private roomId: Id | null = null;

  constructor(deps: DraftDuelSessionDeps) {
    this.deps = deps;
    this.seriesFlow = new SeriesCoordinator(deps.now, AUTO_START_RETRY_MS);
    this.seriesFlow.holdMs = GAME_RESULTS_HOLD_MS;
    this.now = deps.now();
    this.syncTask = new CoalescedTask(() => this.runSync());
    this.tickLoop = new TickLoop(deps.scheduleTick ?? intervalTickScheduler, TICK_MS, () => {
      this.now = this.deps.now();
      this.publish();
      this.tick();
    });
  }

  getSnapshot(): DraftDuelSessionView {
    return {
      connection: this.lifecycle.getConnection(),
      assets: this.assets,
      snapshot: this.snapshot,
      participantId: this.participantId,
      draft: this.draft,
      outputs: this.outputs,
      verification: this.verification,
      commands: this.commands,
      completedRecap: this.completedRecap,
      busy: this.busy,
      error: this.error,
      notice: this.notice,
      integrityFailed: this.integrityFailed,
      progress: this.progress,
      awaitingContinue: this.awaitingContinue(),
      localReady: this.localReady(),
      opponentReady: this.opponentReady(),
      readyCountdownMs: this.readyCountdownMs(),
      deadlineMsLeft: this.deadlineMsLeft(),
    };
  }

  subscribe(listener: () => void): () => void {
    return this.events.subscribe(listener);
  }

  subscribeTransient(listener: (event: DraftDuelTransientEvent) => void): () => void {
    return this.events.subscribeTransient(listener);
  }

  refresh(): Promise<void> {
    return this.lifecycle.reconnect();
  }

  async attach(roomId: string): Promise<void> {
    if (this.disposed) return;
    if (this.attachment?.roomId === roomId && this.attachment.current()) return;
    const attachment = this.lifecycle.begin(roomId);
    this.attachment = attachment;
    this.tickLoop.dispose();
    this.seriesFlow.reset();
    this.commandRecovery.reset();
    this.snapshot = null;
    this.participantId = null;
    this.draft = null;
    this.outputs = {};
    this.verification = [];
    this.commands = [];
    this.completedRecap = null;
    this.completedPersisted = false;
    this.progress = 0;
    this.busy = false;
    this.error = null;
    this.notice = null;
    this.integrityFailed = false;
    this.resolvedCursor = null;
    this.deadlineResolving = false;
    this.deadlineRetryAtMs = 0;
    this.rematchRetryAtMs = 0;
    this.pendingReadyGame = null;
    this.pendingReadyRetryAtMs = 0;
    this.seenBroadcastGame = null;
    this.roomId = idSchema.parse(roomId);
    try {
      await this.loadAssets();
      if (!attachment.current()) return;
      const membership = this.deps.loadMembership(roomId);
      if (!membership) {
        this.error = 'You are not a member of this room. Join from the Draft Duel lobby.';
        this.publish();
        return;
      }
      const resumed = await this.deps.transport.resume(roomId);
      if (!attachment.current()) return;
      this.participantId = resumed.membership.participantId;
      this.deps.saveMembership(resumed.membership);
      this.applySnapshot(resumed.snapshot);
      const restored = await this.deps.repository.loadActive(roomId);
      if (!attachment.current()) return;
      if (restored) {
        this.verification = restored.verification;
      }
      const completed = await this.deps.repository.loadCompleted(roomId);
      if (!attachment.current()) return;
      if (completed) {
        this.completedRecap = completed;
        this.completedPersisted = true;
      }
      const rows = await this.deps.repository.loadResults(roomId);
      if (!attachment.current()) return;
      if (rows.length > 0) {
        const outputs: Record<number, DraftDuelGameOutput> = {};
        for (const row of rows) outputs[row.gameNumber] = row.output;
        this.outputs = { ...this.outputs, ...outputs };
      }
      this.lifecycle.track(
        attachment,
        this.deps.transport.subscribe(roomId, () => {
          if (!attachment.current()) return;
          void this.syncFromServer();
        }).unsubscribe,
      );
      this.lifecycle.track(
        attachment,
        this.deps.transport.subscribeTransient(roomId, (event) => {
          if (!attachment.current()) return;
          this.emitTransient(event);
        }).unsubscribe,
      );
      await this.syncFromServer();
      if (!attachment.current()) return;
      this.lifecycle.connected(attachment);
      this.lifecycle.configureRefresh(
        attachment,
        () => this.syncFromServer(),
        this.deps.scheduleTick ?? intervalTickScheduler,
        15_000,
      );
      this.startTimers();
      this.publish();
    } catch (error) {
      if (!attachment.current()) return;
      this.lifecycle.failed(attachment);
      this.error = this.deps.friendlyError(error);
      this.publish();
    }
  }

  async createRoom(
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      await this.loadAssets();
      const versions = this.versionLocks();
      const created = await this.deps.transport.create({
        fairness,
        presentation,
        timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
        versions,
      });
      this.deps.saveMembership(created.membership);
      return { roomId: created.snapshot.roomId, code: created.code };
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      return null;
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  async roomVersions(): Promise<DraftDuelVersionLocks> {
    await this.loadAssets();
    return this.versionLocks();
  }

  async joinRoom(code: string): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      await this.loadAssets();
      const joined = await this.deps.transport.join(code);
      this.deps.saveMembership(joined.membership);
      return {
        roomId: joined.snapshot.roomId,
        code: joined.snapshot.code ?? joined.membership.code,
      };
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      return null;
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  async updateSettings(
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<void> {
    await this.submit({ kind: 'settings', fairness, presentation });
  }

  async setReady(ready: boolean): Promise<void> {
    await this.submit({ kind: 'ready', ready });
  }

  async startDraft(): Promise<void> {
    await this.submit({ kind: 'start' });
  }

  async pickOffer(pick: DraftDuelOfferedPick, slotIndex: number): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.status !== 'drafting') return;
    if (!this.activeTurn()) {
      this.notice = 'It is not your turn.';
      this.publish();
      return;
    }
    if (!pick.available) {
      this.notice = 'That card cannot be picked right now.';
      this.publish();
      return;
    }
    if (slotIndex < 0 || slotIndex > 4 || !Number.isInteger(slotIndex)) {
      this.notice = 'Choose a position for this player.';
      this.publish();
      return;
    }
    await this.submit({
      kind: 'pick',
      pickOrdinal: draft.pickOrdinal,
      playerId: pick.card.playerId,
      playerVersionId: pick.card.playerVersionId,
      slotIndex,
    });
  }

  async repositionCard(card: DraftDuelCard, slotIndex: number): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.status !== 'drafting') return;
    if (this.snapshot?.settings.versions.multiplayerVersion !== DRAFT_DUEL_MULTIPLAYER_VERSION) {
      this.notice = 'This room does not support moving drafted players.';
      this.publish();
      return;
    }
    if (slotIndex < 0 || slotIndex > 4 || !Number.isInteger(slotIndex)) {
      this.notice = 'Choose a position for this player.';
      this.publish();
      return;
    }
    await this.submit({
      kind: 'reposition',
      playerId: card.playerId,
      playerVersionId: card.playerVersionId,
      slotIndex,
    });
  }

  async readyForNextGame(): Promise<void> {
    if (this.phase() !== 'lineup-showdown' && this.phase() !== 'preparing-game') return;
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    await this.submit({ kind: 'ready-next-game', gameNumber, ready: true });
  }

  async startBroadcast(auto = false): Promise<void> {
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    await this.submit({ kind: 'broadcast-start', gameNumber, ...(auto ? { auto: true } : {}) });
  }

  async requestRematch(): Promise<void> {
    await this.submit({ kind: 'rematch-request' });
  }

  async confirmRematch(): Promise<void> {
    await this.submit({ kind: 'rematch-confirm' });
  }

  async followRematch(): Promise<Id | null> {
    if (!this.roomId) return null;
    try {
      const rematch = await this.deps.transport.rematch(this.roomId);
      const joined = await this.deps.transport.join(rematch.code);
      this.deps.saveMembership(joined.membership);
      return joined.snapshot.roomId;
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      this.publish();
      return null;
    }
  }

  async removeGuest(): Promise<void> {
    if (!this.roomId || this.participantId !== 'p1') return;
    try {
      const next = await this.deps.transport.removeGuest(
        this.roomId,
        otherParticipant(this.participantId),
      );
      this.applySnapshot(next);
      await this.syncFromServer();
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      this.publish();
    }
  }

  async leaveRoom(): Promise<void> {
    if (!this.roomId || !this.participantId) return;
    const roomId = this.roomId;
    const participantId = this.participantId;
    try {
      await this.deps.transport.leave(roomId, participantId);
    } catch {}
    this.dispose();
  }

  async consider(card: DraftDuelCard | null): Promise<void> {
    if (!this.roomId || !this.participantId || !this.draft) return;
    if (!card) return;
    await this.deps.transport.publishTransient(this.roomId, {
      kind: 'consideration',
      roomId: this.roomId,
      participantId: this.participantId,
      pickOrdinal: this.draft.pickOrdinal,
      playerId: card.playerId,
      playerVersionId: card.playerVersionId,
      sentAtMs: this.deps.now(),
    });
  }

  async react(reaction: ReactionKey): Promise<void> {
    if (!this.roomId || !this.participantId || !this.draft) return;
    await this.deps.transport.publishTransient(this.roomId, {
      kind: 'reaction',
      roomId: this.roomId,
      participantId: this.participantId,
      pickOrdinal: this.draft.pickOrdinal,
      reaction,
      sentAtMs: this.deps.now(),
    });
  }

  setError(message: string | null): void {
    this.error = message;
    this.publish();
  }

  beginPlayback(): void {
    if (this.disposed) return;
    const broadcast = this.broadcastOf();
    if (!broadcast) return;
    this.seriesFlow.playback.begin(
      this.deps.now(),
      Date.parse(broadcast.startedAtIso),
      broadcast.durationMs,
    );
  }

  advancePlayback(deltaMs: number): void {
    if (this.disposed) return;
    const broadcast = this.broadcastOf();
    if (!broadcast) return;
    const outcome = this.seriesFlow.playback.advance(
      deltaMs,
      broadcast.durationMs,
      this.deps.now(),
    );
    this.progress = outcome.progress;
    this.publish();
    if (outcome.completed) this.maybeProposeOrConfirm();
  }

  continueAfterGame(): void {
    if (this.disposed) return;
    const output = this.currentOutput();
    if (!output) return;
    this.seriesFlow.playback.approve(output.gameNumber);
    this.pendingReadyGame = output.gameNumber + 1;
    this.pendingReadyRetryAtMs = 0;
    this.maybeReadyNextGame();
    this.maybeProposeOrConfirm();
  }

  seriesGameEntries(): DraftDuelSeriesGame[] {
    return this.snapshot?.series?.games ?? [];
  }

  dispose(): void {
    this.disposed = true;
    this.lifecycle.dispose();
    this.tickLoop.dispose();
    this.events.dispose();
    this.deps.runner.dispose();
  }

  private publish(): void {
    if (!this.disposed) this.events.publish();
  }

  private emitTransient(event: DraftDuelTransientEvent): void {
    this.events.emitTransient(event);
  }

  private phase(): DraftDuelRoomSnapshot['phase'] {
    return this.snapshot?.phase ?? 'lobby';
  }

  private currentGameNumber(): number | null {
    return this.snapshot?.series?.currentGameNumber ?? null;
  }

  private currentOutput(): DraftDuelGameOutput | null {
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return null;
    return this.outputs[gameNumber] ?? null;
  }

  private broadcastOf(): DraftDuelBroadcast | null {
    return this.snapshot?.broadcast ?? null;
  }

  private localReady(): boolean {
    return this.seriesFlow.memberReady(
      this.snapshot?.members ?? [],
      this.participantId,
      this.currentGameNumber(),
    );
  }

  private opponentReady(): boolean {
    return this.seriesFlow.memberReady(
      this.snapshot?.members ?? [],
      this.participantId ? otherParticipant(this.participantId) : null,
      this.currentGameNumber(),
    );
  }

  private readyCountdownMs(): number | null {
    return this.seriesFlow.readyCountdown(this.opponentReady(), GAME_READY_WINDOW_MS, this.now);
  }

  private deadlineMsLeft(): number | null {
    const deadline = this.snapshot?.deadline;
    if (!deadline) return null;
    return Math.max(0, Date.parse(deadline.deadlineAt) - this.now);
  }

  private activeTurn(): boolean {
    const draft = this.draft;
    if (this.phase() !== 'drafting' || !draft || draft.status !== 'drafting') return false;
    return draftDuelCurrentPicker(draft) === this.participantId && !this.busy;
  }

  private async loadAssets(): Promise<void> {
    this.assets ??= await this.deps.loadAssets();
    this.publish();
  }

  private versionLocks(): DraftDuelVersionLocks {
    const assets = this.assets;
    if (!assets) throw new Error('Draft Duel assets are unavailable.');
    return defaultDraftDuelVersionLocks({
      dataVersion: assets.catalog.dataVersion,
      ratingsVersion: assets.catalog.ratingsVersion,
      catalogVersion: assets.catalog.catalogVersion,
      catalogHash: assets.catalog.catalogHash,
      playerVersionIdVersion: assets.catalog.playerVersionIdVersion,
      positionNormalizationVersion: assets.catalog.positionNormalizationVersion,
      engineVersion: 'draft-duel-web-v1',
      profileVersion: assets.profile.profileVersion,
    });
  }

  private rosters(): DraftDuelSeriesRosters | null {
    if (!this.assets || !this.draft) return null;
    if (this.draft.status !== 'complete') return null;
    try {
      return {
        p1: draftDuelRoster(this.draft, this.assets.catalog, 'p1'),
        p2: draftDuelRoster(this.draft, this.assets.catalog, 'p2'),
      };
    } catch {
      return null;
    }
  }

  private applySnapshot(snapshot: DraftDuelRoomSnapshot, publish = true): void {
    if (
      this.disposed ||
      snapshot.roomId !== this.roomId ||
      (this.snapshot && snapshot.revision < this.snapshot.revision)
    )
      return;
    const broadcastGame = snapshot.broadcast?.gameNumber ?? null;
    const resumedAtResults =
      snapshot.phase === 'game-results' &&
      broadcastGame !== null &&
      this.seenBroadcastGame !== broadcastGame;
    this.snapshot = snapshot;
    if (this.seriesFlow.observe(snapshot.phase, broadcastGame)) {
      this.progress = 0;
    }
    if (broadcastGame !== null) this.seenBroadcastGame = broadcastGame;
    if (resumedAtResults) {
      this.seriesFlow.playback.resumeReview(this.deps.now());
    }
    if (publish) this.publish();
  }

  private startTimers(): void {
    this.tickLoop.start();
  }

  private tick(): void {
    if (this.disposed || this.busy) return;
    if (this.shouldCreateRematch()) void this.syncFromServer();
    this.maybeProposeOrConfirm();
    this.maybeReadyNextGame();
    const deadline = this.snapshot?.deadline;
    if (
      this.phase() === 'drafting' &&
      deadline &&
      this.now >= Date.parse(deadline.deadlineAt) &&
      this.now >= this.deadlineRetryAtMs &&
      this.resolvedCursor !== deadline.cursor
    ) {
      void this.resolveDeadline(deadline.cursor, deadline.pickOrdinal);
    }
    if (
      this.seriesFlow.shouldAutoStart(
        this.localReady(),
        this.opponentReady(),
        GAME_READY_WINDOW_MS,
        this.now,
      )
    ) {
      void this.startBroadcast(!(this.localReady() && this.opponentReady()));
    }
  }

  private async resolveDeadline(cursor: string, pickOrdinal: number): Promise<void> {
    if (this.deadlineResolving || !this.roomId || !this.participantId) return;
    if (!this.draft || !this.assets || this.draft.status !== 'drafting') return;
    if (this.draft.pickOrdinal !== pickOrdinal) return;
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const roomId = attachment.roomId;
    this.deadlineResolving = true;
    try {
      const timeoutPick = draftDuelTimeoutPick(this.draft, this.assets.catalog);
      const payload = {
        kind: 'timeout-autopick' as const,
        pickOrdinal: timeoutPick.pickOrdinal,
        playerId: timeoutPick.playerId,
        playerVersionId: timeoutPick.playerVersionId,
        slotIndex: timeoutPick.slotIndex,
        seedPath: timeoutPick.seedPath,
      };
      await this.deps.transport.commitFallback(roomId, cursor, payload);
      if (!attachment.current()) return;
      const receipt = await this.deps.transport.resolveTimeout(roomId);
      if (!attachment.current()) return;
      if (receipt?.accepted) this.resolvedCursor = cursor;
      else this.deadlineRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
      await this.syncFromServer();
    } catch {
      if (!attachment.current()) return;
      this.deadlineRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
    } finally {
      if (attachment.current()) this.deadlineResolving = false;
    }
  }

  private async submit(payload: DraftDuelCommand['payload']): Promise<boolean> {
    const attachment = this.attachment;
    if (!attachment?.current() || !this.roomId || !this.participantId) return false;
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      const report = await executeMultiplayerCommand(
        {
          schemaVersion: 1,
          roomId: this.roomId,
          commandId: commandIdSchema.parse(
            this.commandRecovery.id(payload, () => this.deps.newCommandId()),
          ),
          actorParticipantId: this.participantId,
          payload,
        },
        {
          submit: (command) => this.deps.transport.submitCommand(command),
          classify: (receipt) =>
            receipt.accepted
              ? 'accepted'
              : receipt.rejectionCode === 'stale-revision'
                ? 'stale'
                : 'rejected',
        },
      );
      if (!attachment.current()) return false;
      const receipt = report.receipt;
      if (receipt) this.commandRecovery.settled(payload);
      if (!receipt?.accepted) {
        throw new Error(`Draft Duel command rejected: ${receipt?.rejectionCode ?? 'unknown'}`);
      }
      await this.syncFromServer();
      return true;
    } catch (error) {
      if (!attachment.current()) return false;
      this.error = this.deps.friendlyError(error);
      return false;
    } finally {
      if (attachment.current()) {
        this.busy = false;
        this.maybeProposeOrConfirm();
        this.maybeReadyNextGame();
        this.publish();
      }
    }
  }

  private syncFromServer(): Promise<void> {
    if (this.disposed || !this.roomId || !this.assets) return Promise.resolve();
    return this.syncTask.request();
  }

  private async runSync(): Promise<void> {
    if (this.disposed || !this.roomId || !this.assets) return;
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const roomId = attachment.roomId;
    const isDisposed = () => !attachment.current();
    try {
      const resumed = await this.deps.transport.resume(roomId);
      if (isDisposed()) return;
      this.lifecycle.connected(attachment);
      this.error = null;
      const commands = await this.deps.transport.refetch(roomId, -1);
      if (isDisposed()) return;
      if (commands.length > resumed.snapshot.commandCount) {
        void this.syncFromServer();
        return;
      }
      if (this.snapshot && resumed.snapshot.revision < this.snapshot.revision) {
        void this.syncFromServer();
        return;
      }
      this.commands = commands;
      this.applySnapshot(resumed.snapshot, false);
      this.rebuildDraft();
      if (this.shouldCreateRematch()) {
        this.rematchRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
        await this.deps.transport.rematch(roomId);
        const rematched = await this.deps.transport.resume(roomId);
        if (isDisposed()) return;
        this.applySnapshot(rematched.snapshot);
      }
      await this.deps.repository.appendCommands(roomId, commands);
      if (isDisposed()) return;
      await this.ensureGamePipeline();
      if (isDisposed()) return;
      this.maybeProposeOrConfirm();
      this.maybeReadyNextGame();
      await this.persistActive();
      this.publish();
    } catch (error) {
      if (isDisposed()) return;
      this.lifecycle.failed(attachment);
      this.error = this.deps.friendlyError(error);
      this.publish();
    }
  }

  private shouldCreateRematch(): boolean {
    return (
      this.participantId === 'p1' &&
      this.phase() === 'championship' &&
      !(this.snapshot?.successorRoomId ?? null) &&
      this.deps.now() >= this.rematchRetryAtMs &&
      this.commands.some((command) => command.payload.kind === 'rematch-confirm')
    );
  }

  private rebuildDraft(): void {
    const snapshot = this.snapshot;
    const assets = this.assets;
    if (!snapshot || !assets) return;
    const rootSeed = snapshot.rootSeed;
    if (!rootSeed) {
      this.draft = null;
      this.publish();
      return;
    }
    try {
      this.draft = replayDraftDuelLog({
        rootSeed,
        fairness: snapshot.settings.fairness,
        catalog: assets.catalog,
        commands: this.commands,
        multiplayerVersion: snapshot.settings.versions.multiplayerVersion,
      });
      this.publish();
    } catch (error) {
      this.error =
        error instanceof Error
          ? `Draft sync failed: ${error.message.slice(0, 200)}`
          : 'Draft sync failed.';
      this.publish();
    }
  }

  private async ensureGamePipeline(): Promise<void> {
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const snapshot = this.snapshot;
    const series = snapshot?.series;
    if (!snapshot || !series || !this.assets || !this.roomId) return;
    const gameNumber = series.currentGameNumber;
    if (gameNumber === null) return;
    if (
      snapshot.phase !== 'preparing-game' &&
      snapshot.phase !== 'broadcasting' &&
      snapshot.phase !== 'game-results'
    ) {
      return;
    }
    if (this.outputs[gameNumber] || this.seriesFlow.jobs.has(gameNumber)) return;
    try {
      await this.seriesFlow.runGame(
        gameNumber,
        attachment.current,
        () => this.simulateGame(gameNumber, series.homeWinner),
        async (output) => {
          this.outputs = { ...this.outputs, [gameNumber]: output };
          await this.deps.repository.saveResult(output);
          if (attachment.current()) this.publish();
        },
      );
    } catch (error) {
      if (!attachment.current()) return;
      this.error =
        error instanceof Error
          ? `Game simulation failed: ${error.message.slice(0, 200)}`
          : 'Game simulation failed.';
      this.publish();
    }
  }

  private async simulateGame(
    gameNumber: number,
    homeWinner: DraftDuelParticipantId,
  ): Promise<DraftDuelGameOutput> {
    const snapshot = this.snapshot;
    const assets = this.assets;
    const rosters = this.rosters();
    if (!snapshot || !assets || !rosters || !this.roomId || !this.participantId) {
      throw new Error('Draft Duel game inputs are incomplete.');
    }
    const rootSeed = snapshot.rootSeed;
    if (!rootSeed) throw new Error('Draft Duel root seed is missing.');
    const homeParticipantId = draftDuelHomeForGame(homeWinner, gameNumber);
    const awayParticipantId = otherParticipant(homeParticipantId);
    const homeTeam = draftDuelSimulationTeam(
      assets.catalog,
      rosters[homeParticipantId],
      homeParticipantId,
    );
    const awayTeam = draftDuelSimulationTeam(
      assets.catalog,
      rosters[awayParticipantId],
      awayParticipantId,
    );
    const seed = draftDuelGameSeed(rootSeed, gameNumber);
    return this.deps.runner.runDraftDuelGame({
      roomId: this.roomId,
      input: {
        schemaVersion: 2,
        seed,
        gameNumber,
        dataVersion: snapshot.settings.versions.dataVersion,
        profile: assets.profile,
        home: homeTeam,
        away: awayTeam,
      },
    });
  }

  private proposalOf(gameNumber: number): {
    byParticipant: Partial<Record<DraftDuelParticipantId, string>>;
  } {
    const byParticipant: Partial<Record<DraftDuelParticipantId, string>> = {};
    for (const command of this.commands) {
      if (command.payload.kind !== 'propose-result') continue;
      if (command.payload.gameNumber !== gameNumber) continue;
      byParticipant[command.actorParticipantId] = command.payload.resultDigest;
    }
    return { byParticipant };
  }

  private continueApproved(gameNumber: number): boolean {
    return this.seriesFlow.playback.continueApproved(
      gameNumber,
      GAME_RESULTS_HOLD_MS,
      this.deps.now(),
    );
  }

  private awaitingContinue(): boolean {
    const snapshot = this.snapshot;
    const output = this.currentOutput();
    if (!snapshot || !output) return false;
    if (snapshot.phase !== 'game-results') return false;
    const gameNumber = output.gameNumber;
    if (this.seriesFlow.confirmations.has(gameNumber)) return false;
    return !this.continueApproved(gameNumber);
  }

  private maybeReadyNextGame(): void {
    const target = this.pendingReadyGame;
    if (target === null || this.disposed || this.busy) return;
    const phase = this.phase();
    if (phase === 'championship' || phase === 'integrity-failed' || phase === 'expired') {
      this.pendingReadyGame = null;
      return;
    }
    if (phase !== 'preparing-game') return;
    const current = this.currentGameNumber();
    if (current === null) {
      this.pendingReadyGame = null;
      return;
    }
    if (current !== target) {
      if (current > target) this.pendingReadyGame = null;
      return;
    }
    if (this.localReady()) {
      this.pendingReadyGame = null;
      return;
    }
    if (this.deps.now() < this.pendingReadyRetryAtMs) return;
    this.pendingReadyRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
    void this.readyForNextGame();
  }

  private maybeProposeOrConfirm(): void {
    const attachment = this.attachment;
    if (!attachment?.current() || this.busy) return;
    const snapshot = this.snapshot;
    const output = this.currentOutput();
    if (!snapshot || !output || !this.participantId) return;
    if (snapshot.phase !== 'broadcasting' && snapshot.phase !== 'game-results') return;
    if (this.progress < 1) return;
    const gameNumber = output.gameNumber;
    const { byParticipant } = this.proposalOf(gameNumber);
    const roomId = attachment.roomId;
    this.seriesFlow.coordinate({
      gameNumber,
      localDigest: output.resultDigest,
      ownProposal: byParticipant[this.participantId],
      peerProposal: byParticipant[otherParticipant(this.participantId)],
      current: attachment.current,
      propose: () =>
        this.submit({
          kind: 'propose-result',
          gameNumber,
          winner: this.winnerOf(output),
          resultDigest: output.resultDigest,
          tapeDigest: output.tapeDigest,
          inputDigest: output.inputDigest,
        }),
      confirm: (verified) =>
        this.submit({
          kind: 'confirm-result',
          gameNumber,
          resultDigest: output.resultDigest,
          verified,
        }),
      verification: (verified, peerDigest) => {
        this.recordVerification(
          gameNumber,
          output.resultDigest,
          peerDigest,
          verified ? 'verified' : 'mismatch',
        );
        if (!verified) {
          this.integrityFailed = true;
          this.publish();
        }
      },
      mismatch: () => {
        void this.deps.transport.fail(roomId).catch(() => {});
      },
    });
  }

  private winnerOf(output: DraftDuelGameOutput): DraftDuelParticipantId {
    const series = this.snapshot?.series ?? null;
    const game = series?.games.find((entry) => entry.gameNumber === output.gameNumber);
    const home =
      game?.homeParticipantId ??
      (series
        ? draftDuelHomeForGame(series.homeWinner, output.gameNumber)
        : output.homeParticipantId);
    return output.result.winner === 'home' ? home : otherParticipant(home);
  }

  private recordVerification(
    gameNumber: number,
    localDigest: string,
    peerDigest: string | null,
    status: DraftDuelPartiallyVerified['status'],
  ): void {
    const next = this.verification.filter((entry) => entry.gameNumber !== gameNumber);
    next.push({
      gameNumber,
      localResultDigest: localDigest,
      peerResultDigest: peerDigest,
      status,
    } as DraftDuelPartiallyVerified);
    this.verification = next.sort((a, b) => a.gameNumber - b.gameNumber);
    this.publish();
    if (this.roomId) void this.deps.repository.saveVerification(this.roomId, this.verification);
  }

  private seriesMvpFact(): DraftDuelSeriesMvp | null {
    return draftDuelSeriesMvpOf({
      catalog: this.assets?.catalog ?? null,
      draft: this.draft,
      series: this.snapshot?.series ?? null,
      playedGames: draftDuelPlayedGames(this.snapshot?.series ?? null, this.outputs),
      completedRecap: this.completedRecap,
    });
  }

  private seriesStandoutsFact(): DraftDuelStandout[] {
    return draftDuelSeriesStandoutsOf({
      catalog: this.assets?.catalog ?? null,
      draft: this.draft,
      series: this.snapshot?.series ?? null,
      playedGames: draftDuelPlayedGames(this.snapshot?.series ?? null, this.outputs),
      completedRecap: this.completedRecap,
    });
  }

  private async persistActive(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.roomId || !this.participantId) return;
    await this.deps.repository.saveActive({
      roomId: this.roomId,
      localParticipantId: this.participantId,
      settings: snapshot.settings,
      rootSeed: snapshot.rootSeed,
      phase: snapshot.phase,
      draft: this.draft,
      series: snapshot.series,
      broadcast: snapshot.broadcast,
      verification: this.verification,
    });
    const series = snapshot.series;
    const champion = series?.champion ?? null;
    if (snapshot.phase === 'championship' && champion && series && !this.completedPersisted) {
      this.completedPersisted = true;
      const recap: DraftDuelCompletionRecap = {
        roomId: this.roomId,
        champion,
        series,
        mvp: this.seriesMvpFact(),
        standouts: this.seriesStandoutsFact(),
        games: series.games.length,
      };
      if (recap.games >= 1) await this.deps.repository.complete(recap);
    }
  }
}
