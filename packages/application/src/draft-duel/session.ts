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
  PlaybackProgress,
  SessionEvents,
  TickLoop,
  intervalTickScheduler,
  type TickScheduler,
} from '../runtime/index.ts';

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
  private readonly playback = new PlaybackProgress();
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
  private preparingSinceMs: number | null = null;
  private lastAutoAttemptMs = 0;
  private resultRetryAtMs = 0;
  private proposalSent = new Set<number>();
  private confirmSent = new Set<number>();
  private simulating = new Set<number>();
  private completedPersisted = false;
  private disposed = false;
  private roomId: Id | null = null;

  constructor(deps: DraftDuelSessionDeps) {
    this.deps = deps;
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

  async attach(roomId: string): Promise<void> {
    if (this.disposed) return;
    this.roomId = idSchema.parse(roomId);
    try {
      await this.loadAssets();
      const membership = this.deps.loadMembership(roomId);
      if (!membership) {
        this.error = 'You are not a member of this room. Join from the Draft Duel lobby.';
        this.publish();
        return;
      }
      const resumed = await this.deps.transport.resume(roomId);
      this.participantId = resumed.membership.participantId;
      this.deps.saveMembership(resumed.membership);
      this.applySnapshot(resumed.snapshot);
      const restored = await this.deps.repository.loadActive(roomId);
      if (restored) {
        this.verification = restored.verification;
      }
      const completed = await this.deps.repository.loadCompleted(roomId);
      if (completed) {
        this.completedRecap = completed;
        this.completedPersisted = true;
      }
      const rows = await this.deps.repository.loadResults(roomId);
      if (rows.length > 0) {
        const outputs: Record<number, DraftDuelGameOutput> = {};
        for (const row of rows) outputs[row.gameNumber] = row.output;
        this.outputs = { ...this.outputs, ...outputs };
      }
      this.events.track(
        this.deps.transport.subscribe(roomId, (snapshot) => {
          this.applySnapshot(snapshot);
          void this.syncFromServer();
        }),
      );
      this.events.track(
        this.deps.transport.subscribeTransient(roomId, (event) => {
          this.emitTransient(event);
        }),
      );
      await this.syncFromServer();
      this.startTimers();
      this.publish();
    } catch (error) {
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
    this.playback.begin(this.deps.now(), Date.parse(broadcast.startedAtIso), broadcast.durationMs);
  }

  advancePlayback(deltaMs: number): void {
    if (this.disposed) return;
    const broadcast = this.broadcastOf();
    if (!broadcast) return;
    const outcome = this.playback.advance(deltaMs, broadcast.durationMs, this.deps.now());
    this.progress = outcome.progress;
    this.publish();
    if (outcome.completed) this.maybeProposeOrConfirm();
  }

  continueAfterGame(): void {
    if (this.disposed) return;
    const output = this.currentOutput();
    if (!output) return;
    this.playback.approve(output.gameNumber);
    this.maybeProposeOrConfirm();
  }

  seriesGameEntries(): DraftDuelSeriesGame[] {
    return this.snapshot?.series?.games ?? [];
  }

  dispose(): void {
    this.disposed = true;
    this.tickLoop.dispose();
    this.events.dispose();
    this.deps.runner.dispose();
  }

  private publish(): void {
    this.events.publish();
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
    const me = this.snapshot?.members.find((member) => member.participantId === this.participantId);
    const game = this.currentGameNumber();
    if (!me || game === null) return false;
    return me.nextGameReady === game;
  }

  private opponentReady(): boolean {
    const me = this.participantId;
    const game = this.currentGameNumber();
    if (!me || game === null) return false;
    const rival = otherParticipant(me);
    const member = this.snapshot?.members.find((entry) => entry.participantId === rival);
    return member?.nextGameReady === game;
  }

  private readyCountdownMs(): number | null {
    if (this.phase() !== 'preparing-game') return null;
    if (this.preparingSinceMs === null) return null;
    if (this.opponentReady()) return null;
    return Math.max(0, this.preparingSinceMs + GAME_READY_WINDOW_MS - this.now);
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

  private applySnapshot(snapshot: DraftDuelRoomSnapshot): void {
    if (this.disposed || (this.snapshot && snapshot.revision < this.snapshot.revision)) return;
    const previousPhase = this.snapshot?.phase ?? null;
    const previousBroadcastGame = this.snapshot?.broadcast?.gameNumber ?? null;
    this.snapshot = snapshot;
    if (snapshot.phase === 'preparing-game' && previousPhase !== 'preparing-game') {
      this.preparingSinceMs = this.deps.now();
      this.lastAutoAttemptMs = 0;
    }
    if (snapshot.phase !== 'preparing-game') {
      this.preparingSinceMs = null;
    }
    const broadcastGame = snapshot.broadcast?.gameNumber ?? null;
    if (broadcastGame !== null && broadcastGame !== previousBroadcastGame) {
      this.progress = 0;
      this.playback.reset();
    }
    this.publish();
  }

  private startTimers(): void {
    this.tickLoop.start();
  }

  private tick(): void {
    if (this.disposed || this.busy) return;
    if (this.shouldCreateRematch()) void this.syncFromServer();
    this.maybeProposeOrConfirm();
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
      this.phase() === 'preparing-game' &&
      ((this.localReady() && this.opponentReady()) ||
        (this.readyCountdownMs() === 0 && !this.opponentReady())) &&
      this.now - this.lastAutoAttemptMs >= AUTO_START_RETRY_MS
    ) {
      this.lastAutoAttemptMs = this.now;
      void this.startBroadcast(!(this.localReady() && this.opponentReady()));
    }
  }

  private async resolveDeadline(cursor: string, pickOrdinal: number): Promise<void> {
    if (this.deadlineResolving || !this.roomId || !this.participantId) return;
    if (!this.draft || !this.assets || this.draft.status !== 'drafting') return;
    if (this.draft.pickOrdinal !== pickOrdinal) return;
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
      await this.deps.transport.commitFallback(this.roomId, cursor, payload);
      const receipt = await this.deps.transport.resolveTimeout(this.roomId);
      if (receipt?.accepted) this.resolvedCursor = cursor;
      else this.deadlineRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
      await this.syncFromServer();
    } catch {
      this.deadlineRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
    } finally {
      this.deadlineResolving = false;
    }
  }

  private async submit(payload: DraftDuelCommand['payload']): Promise<boolean> {
    if (!this.roomId || !this.participantId) return false;
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      const receipt = await this.deps.transport.submitCommand({
        schemaVersion: 1,
        roomId: this.roomId,
        commandId: commandIdSchema.parse(this.deps.newCommandId()),
        actorParticipantId: this.participantId,
        payload,
      });
      if (!receipt.accepted) {
        throw new Error(`Draft Duel command rejected: ${receipt.rejectionCode ?? 'unknown'}`);
      }
      await this.syncFromServer();
      return true;
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      return false;
    } finally {
      this.busy = false;
      this.maybeProposeOrConfirm();
      this.publish();
    }
  }

  private syncFromServer(): Promise<void> {
    if (this.disposed || !this.roomId || !this.assets) return Promise.resolve();
    return this.syncTask.request();
  }

  private async runSync(): Promise<void> {
    if (this.disposed || !this.roomId || !this.assets) return;
    const isDisposed = () => this.disposed;
    try {
      const resumed = await this.deps.transport.resume(this.roomId);
      if (isDisposed()) return;
      this.applySnapshot(resumed.snapshot);
      const commands = await this.deps.transport.refetch(this.roomId, -1);
      if (isDisposed()) return;
      this.commands = commands;
      if (this.shouldCreateRematch()) {
        this.rematchRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
        await this.deps.transport.rematch(this.roomId);
        this.applySnapshot((await this.deps.transport.resume(this.roomId)).snapshot);
      }
      await this.deps.repository.appendCommands(this.roomId, commands);
      this.rebuildDraft();
      await this.ensureGamePipeline();
      this.maybeProposeOrConfirm();
      await this.persistActive();
      this.publish();
    } catch (error) {
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
    const snapshot = this.snapshot;
    const series = snapshot?.series;
    if (!snapshot || !series || !this.assets || !this.roomId) return;
    const gameNumber = series.currentGameNumber;
    if (gameNumber === null) return;
    if (snapshot.phase !== 'preparing-game' && snapshot.phase !== 'broadcasting') return;
    if (this.outputs[gameNumber] || this.simulating.has(gameNumber)) return;
    this.simulating.add(gameNumber);
    try {
      const output = await this.simulateGame(gameNumber, series.homeWinner);
      this.outputs = { ...this.outputs, [gameNumber]: output };
      await this.deps.repository.saveResult(output);
      this.publish();
    } catch (error) {
      this.error =
        error instanceof Error
          ? `Game simulation failed: ${error.message.slice(0, 200)}`
          : 'Game simulation failed.';
      this.publish();
    } finally {
      this.simulating.delete(gameNumber);
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
    return this.playback.continueApproved(gameNumber, GAME_RESULTS_HOLD_MS, this.deps.now());
  }

  private awaitingContinue(): boolean {
    const snapshot = this.snapshot;
    const output = this.currentOutput();
    if (!snapshot || !output) return false;
    if (snapshot.phase !== 'game-results') return false;
    const gameNumber = output.gameNumber;
    if (this.confirmSent.has(gameNumber)) return false;
    return !this.continueApproved(gameNumber);
  }

  private maybeProposeOrConfirm(): void {
    if (this.disposed || this.busy || this.deps.now() < this.resultRetryAtMs) return;
    const snapshot = this.snapshot;
    const series = snapshot?.series;
    const output = this.currentOutput();
    if (!snapshot || !series || !output || !this.participantId) return;
    const gameNumber = output.gameNumber;
    if (snapshot.phase !== 'broadcasting' && snapshot.phase !== 'game-results') return;
    if (this.progress < 1 && snapshot.phase === 'broadcasting') return;
    if (!this.proposalSent.has(gameNumber)) {
      this.proposalSent.add(gameNumber);
      void this.submit({
        kind: 'propose-result',
        gameNumber,
        winner: this.winnerOf(output),
        resultDigest: output.resultDigest,
        tapeDigest: output.tapeDigest,
        inputDigest: output.inputDigest,
      }).then((accepted) => {
        if (!accepted) {
          this.proposalSent.delete(gameNumber);
          this.resultRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
        }
      });
      return;
    }
    const { byParticipant } = this.proposalOf(gameNumber);
    if (byParticipant[this.participantId] !== output.resultDigest) return;
    const rivalId = otherParticipant(this.participantId);
    const rivalDigest = byParticipant[rivalId];
    if (rivalDigest === undefined || this.confirmSent.has(gameNumber)) return;
    if (rivalDigest === output.resultDigest && !this.continueApproved(gameNumber)) return;
    this.confirmSent.add(gameNumber);
    if (rivalDigest === output.resultDigest) {
      void this.submit({
        kind: 'confirm-result',
        gameNumber,
        resultDigest: output.resultDigest,
        verified: true,
      }).then((accepted) => {
        if (accepted) {
          this.recordVerification(gameNumber, output.resultDigest, rivalDigest, 'verified');
        } else {
          this.confirmSent.delete(gameNumber);
          this.resultRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
        }
      });
    } else {
      this.recordVerification(gameNumber, output.resultDigest, rivalDigest, 'mismatch');
      this.integrityFailed = true;
      this.publish();
      void this.submit({
        kind: 'confirm-result',
        gameNumber,
        resultDigest: output.resultDigest,
        verified: false,
      }).then(() => {
        if (this.roomId) void this.deps.transport.fail(this.roomId).catch(() => {});
      });
    }
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
