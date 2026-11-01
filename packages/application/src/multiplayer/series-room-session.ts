import {
  canonicalJson,
  commandIdSchema,
  idSchema,
  type CommandId,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  CoalescedTask,
  SessionEvents,
  TickLoop,
  intervalTickScheduler,
  type TickScheduler,
} from '../runtime/index.ts';
import {
  RoomLifecycle,
  shouldCreateRematch,
  type RoomAttachment,
  type RoomSessionRepository,
  type RoomSessionTransport,
} from './room-lifecycle.ts';
import {
  otherSeriesParticipant,
  proposalsForGame,
  SeriesCoordinator,
  withVerificationEntry,
  type SeriesMember,
  type SeriesParticipantId,
} from './series-coordinator.ts';
import {
  CommandRecovery,
  executeMultiplayerCommand,
  type RecoveredCommandReceipt,
} from './command-execution.ts';
import { mergeCommandLog, type CommandLogMerge } from './command-log.ts';
import { PendingReadyCoordinator } from './pending-ready.ts';

const TICK_MS = 250;

export interface SeriesGameOutput {
  gameNumber: number;
  resultDigest: string;
  tapeDigest: string;
  inputDigest: string;
}

export interface SeriesBroadcast {
  gameNumber: number;
  durationMs: number;
  startedAtIso: string;
}

export interface SeriesDeadline {
  cursor: string;
  participantId: SeriesParticipantId;
}

export interface SeriesRoomSnapshotBase {
  roomId: string;
  revision: number;
  commandCount?: number;
  phase: string;
  members: readonly SeriesMember[];
  deadline: (SeriesDeadline & { deadlineAt?: string; at?: string }) | null;
  broadcast?: {
    gameNumber: number;
    durationMs: number;
    startedAtIso?: string;
    startedAt?: string;
  } | null;
  series?: unknown;
  successorRoomId?: string | null;
}

export interface SeriesSessionCommand {
  commandId: string;
  actorParticipantId: SeriesParticipantId;
  payload: { kind: string };
  ordinal?: number;
}

export interface SeriesVerification {
  gameNumber: number;
}

export interface SeriesSyncResult<TSnapshot, TCommand> {
  snapshot: TSnapshot;
  commands: TCommand[];
  commandCount?: number;
}

export interface SeriesRoomTransport<
  TSnapshot,
  TMembership,
  TTransient,
  TPayload,
  TCommand,
> extends RoomSessionTransport<TSnapshot, TMembership, TTransient> {
  sync(roomId: string, afterOrdinal?: number): Promise<SeriesSyncResult<TSnapshot, TCommand>>;
  submitCommand(command: TCommand): Promise<RecoveredCommandReceipt>;
  commitFallback(
    roomId: string,
    cursor: string,
    payload: TPayload,
    revision?: number,
  ): Promise<unknown>;
  resolveTimeout(roomId: string): Promise<{ accepted?: boolean } | null>;
  rematch(roomId: string): Promise<{ snapshot: TSnapshot; code: string }>;
  join(code: string): Promise<{ snapshot: TSnapshot; membership: TMembership }>;
  leave(roomId: string, participantId: SeriesParticipantId): Promise<void>;
  removeGuest(roomId: string, participantId: SeriesParticipantId): Promise<TSnapshot>;
  fail(roomId: string): Promise<unknown>;
}

export interface SeriesRoomSessionDeps<
  TMembership extends { participantId: SeriesParticipantId },
  TSnapshot,
  TTransient,
  TPayload,
  TCommand,
  TStoredVerification,
  TCompleted,
  TResultRow,
> {
  now: () => number;
  newCommandId: () => string;
  friendlyError: (error: unknown) => string;
  loadMembership: (roomId: string) => TMembership | null;
  saveMembership: (membership: TMembership) => void;
  scheduleTick?: TickScheduler;
  transport: SeriesRoomTransport<TSnapshot, TMembership, TTransient, TPayload, TCommand>;
  repository: RoomSessionRepository<TStoredVerification, TCompleted, TResultRow>;
  runner?: { dispose(): void };
}

/**
 * Shared Draft Duel / Havoc room mechanics: attach, coalesced sync, deadline
 * recovery, playback, negotiate-and-confirm, readiness, and rematch/leave
 * actions. Mode subclasses own their draft/result rules and command payloads;
 * everything here is derived from the same room/job/playback contract.
 */
export abstract class SeriesRoomSession<
  TSnapshot extends SeriesRoomSnapshotBase,
  TPhase extends string,
  TOutput extends SeriesGameOutput,
  TResultRow,
  TPayload,
  TCommand extends SeriesSessionCommand,
  TVerification extends SeriesVerification,
  TStoredVerification,
  TCompleted,
  TMembership extends { participantId: SeriesParticipantId },
  TTransient,
  TDeps extends SeriesRoomSessionDeps<
    TMembership,
    TSnapshot,
    TTransient,
    TPayload,
    TCommand,
    TStoredVerification,
    TCompleted,
    TResultRow
  >,
> {
  protected readonly deps: TDeps;
  protected readonly events: SessionEvents<TTransient>;
  protected readonly lifecycle: RoomLifecycle;
  protected attachment: RoomAttachment | null = null;
  protected readonly seriesFlow: SeriesCoordinator;
  protected readonly commandRecovery = new CommandRecovery();
  protected readonly syncTask: CoalescedTask;
  protected readonly tickLoop: TickLoop;
  protected snapshot: TSnapshot | null = null;
  protected participantId: SeriesParticipantId | null = null;
  protected commands: TCommand[] = [];
  protected persistedCommandCount = 0;
  protected savedActiveKey: string | null = null;
  protected verification: TVerification[] = [];
  protected busy = false;
  protected error: string | null = null;
  protected notice: string | null = null;
  protected integrityFailed = false;
  protected progress = 0;
  /**
   * Outputs keyed by game number.
   *
   * Shared because both series modes store, read, and reset it identically; only
   * the per-game simulation differs. Recording here is what lets
   * `runGamePipeline` own persistence and publication for both.
   */
  protected outputs: Record<number, TOutput> = {};
  protected now: number;
  protected resolvedCursor: string | null = null;
  protected deadlineResolving = false;
  protected deadlineRetryAtMs = 0;
  protected rematchRetryAtMs = 0;
  protected readonly pendingReady: PendingReadyCoordinator;
  protected seenBroadcastGame: number | null = null;
  protected completedPersisted = false;
  protected disposed = false;
  protected roomId: Id | null = null;

  private readonly retryMs: number;
  private readonly readyWindowMs: number;

  protected constructor(
    deps: TDeps,
    config: { retryMs: number; holdMs: number; readyWindowMs: number },
  ) {
    this.deps = deps;
    this.retryMs = config.retryMs;
    this.readyWindowMs = config.readyWindowMs;
    this.events = new SessionEvents<TTransient>();
    this.lifecycle = new RoomLifecycle(() => {
      this.publish();
    });
    this.seriesFlow = new SeriesCoordinator(deps.now, config.retryMs);
    this.seriesFlow.holdMs = config.holdMs;
    this.now = deps.now();
    this.pendingReady = new PendingReadyCoordinator(config.retryMs, () => {
      void this.readyForNextGame();
    });
    this.syncTask = new CoalescedTask(() => this.runSync());
    this.tickLoop = new TickLoop(deps.scheduleTick ?? intervalTickScheduler, TICK_MS, () => {
      this.now = this.deps.now();
      this.publish();
      this.tick();
    });
  }

  protected abstract readonly missingMembershipMessage: string;
  protected abstract readonly rejectedLabel: string;

  protected abstract loadAssets(): Promise<void>;
  protected abstract hasAssets(): boolean;
  protected abstract resetModeState(): void;
  protected abstract setVerification(verification: TStoredVerification): void;
  protected abstract setCompleted(completed: TCompleted): void;
  protected abstract mergeOutputs(rows: readonly TResultRow[]): void;
  protected abstract currentGameNumber(): number | null;
  protected abstract currentOutput(): TOutput | null;
  protected abstract dueDeadline(): { cursor: string } | null;
  protected abstract deadlineFallback(cursor: string): TPayload | null;

  protected abstract buildCommand(
    commandId: CommandId,
    payload: TPayload,
    roomId: Id,
    participantId: SeriesParticipantId,
  ): TCommand;
  protected abstract shouldRebuildDraft(commandsChanged: boolean): boolean;
  protected abstract appendCommands(roomId: string, commands: readonly TCommand[]): Promise<void>;
  protected abstract persistActive(): Promise<void>;
  protected abstract rebuildDraft(): void;
  protected abstract saveVerification(entries: readonly TVerification[]): void;
  protected abstract readyNextPayload(gameNumber: number): TPayload;
  protected abstract confirmPayload(output: TOutput, verified: boolean): TPayload;
  protected abstract proposeWinner(output: TOutput): SeriesParticipantId;

  /**
   * Produce one game's output for a game number.
   *
   * Milestone 5: this is the only part of the simulation pipeline that differs
   * between series modes. Draft Duel resolves home court from the series and
   * simulates from rosters; Havoc builds both teams from the draft. Everything
   * around it — attachment checks, phase gating, job de-duplication, persistence
   * before publication, cancellation, and error reporting — is identical and
   * lives here in `runGamePipeline`.
   */
  protected abstract simulateGame(gameNumber: number): Promise<TOutput>;

  /** Persist a freshly simulated output before it may be published. */
  protected abstract persistOutput(output: TOutput): Promise<void>;

  /**
   * Run, persist, and publish the current game exactly once.
   *
   * Order matters and is enforced here rather than repeated per mode: output is
   * persisted before publication, publication is gated on the attachment still
   * being current, and a failure never publishes a partial result. Cancellation
   * (`attachment.current()` becoming false) abandons the job without undoing an
   * already committed game — resume re-reads the durable cursor to decide
   * whether another job is needed.
   */
  protected async runGamePipeline(): Promise<void> {
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const snapshot = this.snapshot;
    if (!snapshot || !this.roomId) return;
    // `currentGameNumber` already encodes the series check for each mode.
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    if (
      snapshot.phase !== 'preparing-game' &&
      snapshot.phase !== 'broadcasting' &&
      snapshot.phase !== 'game-results'
    ) {
      return;
    }
    if (this.currentOutput() || this.seriesFlow.jobs.has(gameNumber)) return;
    try {
      await this.seriesFlow.runGame(
        gameNumber,
        attachment.current,
        () => this.simulateGame(gameNumber),
        async (output) => {
          this.outputs = { ...this.outputs, [output.gameNumber]: output };
          await this.persistOutput(output);
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

  protected ordinalOf?: (command: TCommand) => number;
  protected onSnapshot?: (snapshot: TSnapshot) => void;

  subscribe(listener: () => void): () => void {
    return this.events.subscribe(listener);
  }

  subscribeTransient(listener: (event: TTransient) => void): () => void {
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
    this.resetForAttach();
    this.roomId = idSchema.parse(roomId);
    const transport = this.deps.transport;
    const repository = this.deps.repository;
    try {
      await this.loadAssets();
      if (!attachment.current()) return;
      const membership = this.deps.loadMembership(roomId);
      if (!membership) {
        this.error = this.missingMembershipMessage;
        this.publish();
        return;
      }
      const resumed = await transport.resume(roomId);
      if (!attachment.current()) return;
      this.participantId = resumed.membership.participantId;
      this.deps.saveMembership(resumed.membership);
      this.applySnapshot(resumed.snapshot);
      if (!this.afterResume()) {
        this.publish();
        return;
      }
      const restored = await repository.loadActive(roomId);
      if (!attachment.current()) return;
      if (restored) this.setVerification(restored);
      const completed = await repository.loadCompleted(roomId);
      if (!attachment.current()) return;
      if (completed) this.setCompleted(completed);
      const rows = await repository.loadResults(roomId);
      if (!attachment.current()) return;
      if (rows.length > 0) this.mergeOutputs(rows);
      this.lifecycle.track(
        attachment,
        transport.subscribe(
          roomId,
          () => {
            if (!attachment.current()) return;
            void this.syncFromServer();
          },
          (error) => {
            if (!attachment.current()) return;
            this.lifecycle.failed(attachment);
            this.error = this.deps.friendlyError(error);
            this.publish();
          },
        ).unsubscribe,
      );
      this.lifecycle.track(
        attachment,
        transport.subscribeTransient(roomId, (event) => {
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

  setError(message: string | null): void {
    this.error = message;
    this.publish();
  }

  protected async runBusy<T>(action: () => Promise<T>): Promise<T | null> {
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      return await action();
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      return null;
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  protected shouldPersistActive(): boolean {
    return true;
  }

  protected deadlineOutcome(cursor: string, accepted: boolean): void {
    if (accepted) this.resolvedCursor = cursor;
    else this.deadlineRetryAtMs = this.deps.now() + this.retryMs;
  }

  protected broadcastStartPayload(gameNumber: number, auto: boolean): TPayload {
    return {
      kind: 'broadcast-start',
      gameNumber,
      ...(auto ? { auto: true } : {}),
    } as TPayload;
  }

  protected rematchRequestPayload(): TPayload {
    return { kind: 'rematch-request' } as TPayload;
  }

  protected rematchConfirmPayload(): TPayload {
    return { kind: 'rematch-confirm' } as TPayload;
  }

  protected proposePayload(output: TOutput): TPayload {
    return {
      kind: 'propose-result',
      gameNumber: output.gameNumber,
      winner: this.proposeWinner(output),
      resultDigest: output.resultDigest,
      tapeDigest: output.tapeDigest,
      inputDigest: output.inputDigest,
    } as TPayload;
  }

  protected async rematchAndResume(roomId: string): Promise<void> {
    await this.deps.transport.rematch(roomId);
    const rematched = await this.deps.transport.resume(roomId);
    if (this.attachment?.current()) this.applySnapshot(rematched.snapshot);
  }

  protected onDispose(): void {
    this.deps.runner?.dispose();
  }

  async readyForNextGame(): Promise<void> {
    if (this.phase() !== 'lineup-showdown' && this.phase() !== 'preparing-game') return;
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    await this.submitPayload(this.readyNextPayload(gameNumber));
  }

  async startBroadcast(auto = false): Promise<void> {
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    await this.submitPayload(this.broadcastStartPayload(gameNumber, auto));
  }

  async requestRematch(): Promise<void> {
    await this.submitPayload(this.rematchRequestPayload());
  }

  async confirmRematch(): Promise<void> {
    await this.submitPayload(this.rematchConfirmPayload());
  }

  async followRematch(): Promise<Id | null> {
    if (!this.roomId) return null;
    try {
      const rematch = await this.deps.transport.rematch(this.roomId);
      const joined = await this.deps.transport.join(rematch.code);
      this.deps.saveMembership(joined.membership);
      return idSchema.parse(joined.snapshot.roomId);
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
        otherSeriesParticipant(this.participantId),
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
    try {
      await this.deps.transport.leave(this.roomId, this.participantId);
    } catch {}
    this.dispose();
  }

  beginPlayback(): void {
    if (this.disposed) return;
    const broadcast = this.currentBroadcast();
    if (!broadcast) return;
    this.progress = this.seriesFlow.beginBroadcast(broadcast.startedAtIso, broadcast.durationMs);
  }

  advancePlayback(deltaMs: number): void {
    if (this.disposed) return;
    const broadcast = this.currentBroadcast();
    if (!broadcast) return;
    const outcome = this.seriesFlow.advanceBroadcast(deltaMs, broadcast.durationMs);
    this.progress = outcome.progress;
    this.publish();
    if (outcome.completed) this.maybeProposeOrConfirm();
  }

  continueAfterGame(): void {
    if (this.disposed) return;
    const output = this.currentOutput();
    if (!output) return;
    this.seriesFlow.playback.approve(output.gameNumber);
    this.pendingReady.schedule(output.gameNumber + 1);
    this.maybeReadyNextGame();
    this.maybeProposeOrConfirm();
  }

  dispose(): void {
    this.disposed = true;
    this.lifecycle.dispose();
    this.tickLoop.dispose();
    this.events.dispose();
    this.onDispose();
  }

  protected publish(): void {
    if (!this.disposed) this.events.publish();
  }

  protected emitTransient(event: TTransient): void {
    this.events.emitTransient(event);
  }

  protected phase(): TPhase {
    return (this.snapshot?.phase ?? 'lobby') as TPhase;
  }

  protected viewBase() {
    return {
      connection: this.lifecycle.getConnection(),
      snapshot: this.snapshot,
      commands: this.commands,
      verification: this.verification,
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

  protected currentBroadcast(): SeriesBroadcast | null {
    const broadcast = this.snapshot?.broadcast;
    if (!broadcast) return null;
    const startedAtIso = broadcast.startedAtIso ?? broadcast.startedAt;
    if (startedAtIso === undefined) return null;
    return {
      gameNumber: broadcast.gameNumber,
      durationMs: broadcast.durationMs,
      startedAtIso,
    };
  }

  protected deadlineMsLeft(): number | null {
    const deadline = this.snapshot?.deadline;
    const at = deadline?.deadlineAt ?? deadline?.at;
    if (!at) return null;
    return Math.max(0, Date.parse(at) - this.now);
  }

  protected localReady(): boolean {
    return this.seriesFlow.memberReady(
      this.snapshot?.members ?? [],
      this.participantId,
      this.currentGameNumber(),
    );
  }

  protected opponentReady(): boolean {
    return this.seriesFlow.memberReady(
      this.snapshot?.members ?? [],
      this.participantId ? otherSeriesParticipant(this.participantId) : null,
      this.currentGameNumber(),
    );
  }

  protected readyCountdownMs(): number | null {
    return this.seriesFlow.readyCountdown(this.opponentReady(), this.readyWindowMs, this.now);
  }

  protected continueApproved(gameNumber: number): boolean {
    return this.seriesFlow.continueApproved(gameNumber, this.seriesFlow.holdMs);
  }

  protected awaitingContinue(): boolean {
    const output = this.currentOutput();
    return this.seriesFlow.awaitingContinue({
      phase: this.phase(),
      gameNumber: output?.gameNumber ?? null,
      approved: output !== null && this.continueApproved(output.gameNumber),
    });
  }

  protected applySnapshot(snapshot: TSnapshot, publish = true): void {
    if (
      this.disposed ||
      snapshot.roomId !== this.roomId ||
      (this.snapshot && snapshot.revision < this.snapshot.revision)
    ) {
      return;
    }
    const broadcastGame = snapshot.broadcast?.gameNumber ?? null;
    const resumedAtResults =
      snapshot.phase === 'game-results' &&
      broadcastGame !== null &&
      this.seenBroadcastGame !== broadcastGame;
    this.snapshot =
      this.snapshot && canonicalJson(this.snapshot.series) === canonicalJson(snapshot.series)
        ? { ...snapshot, series: this.snapshot.series }
        : snapshot;
    if (this.seriesFlow.observe(snapshot.phase, broadcastGame)) {
      this.progress = 0;
    }
    if (broadcastGame !== null) this.seenBroadcastGame = broadcastGame;
    if (resumedAtResults) {
      this.seriesFlow.playback.resumeReview(this.deps.now());
    }
    this.onSnapshot?.(snapshot);
    if (publish) this.publish();
  }

  protected startTimers(): void {
    this.tickLoop.start();
  }

  protected syncFromServer(): Promise<void> {
    if (this.disposed || !this.roomId || !this.hasAssets()) return Promise.resolve();
    return this.syncTask.request();
  }

  protected recordVerification(
    gameNumber: number,
    localDigest: string,
    peerDigest: string | null,
    status: 'verified' | 'mismatch',
  ): void {
    this.verification = withVerificationEntry(this.verification, {
      gameNumber,
      localResultDigest: localDigest,
      peerResultDigest: peerDigest,
      status,
    } as unknown as TVerification);
    this.publish();
    this.saveVerification(this.verification);
  }

  protected maybeReadyNextGame(): void {
    this.pendingReady.tick({
      disposed: this.disposed,
      busy: this.busy,
      phase: this.phase(),
      currentGameNumber: this.currentGameNumber(),
      localReady: this.localReady(),
      now: this.deps.now(),
    });
  }

  protected maybeProposeOrConfirm(): void {
    const attachment = this.attachment;
    const output = this.currentOutput();
    if (!attachment?.current() || !this.participantId) return;
    const gameNumber = output?.gameNumber ?? null;
    this.seriesFlow.coordinateGame({
      phase: this.phase(),
      progress: this.progress,
      busy: this.busy,
      selfId: this.participantId,
      output,
      proposals: gameNumber === null ? {} : proposalsForGame(this.commands, gameNumber),
      current: attachment.current,
      propose: (gameOutput) => this.submitPayload(this.proposePayload(gameOutput)),
      confirm: (gameOutput, verified) =>
        this.submitPayload(this.confirmPayload(gameOutput, verified)),
      verification: (gameOutput, verified, peerDigest) => {
        this.recordVerification(
          gameOutput.gameNumber,
          gameOutput.resultDigest,
          peerDigest,
          verified ? 'verified' : 'mismatch',
        );
        if (!verified) {
          this.integrityFailed = true;
          this.publish();
        }
      },
      mismatch: () => {
        if (this.roomId) void this.deps.transport.fail(this.roomId).catch(() => {});
      },
    });
  }

  protected shouldCreateRematchNow(): boolean {
    return shouldCreateRematch({
      participantId: this.participantId,
      phase: this.phase(),
      successorRoomId: this.snapshot?.successorRoomId,
      now: this.deps.now(),
      retryAtMs: this.rematchRetryAtMs,
      commands: this.commands,
    });
  }

  protected async submitPayload(payload: TPayload): Promise<boolean> {
    const attachment = this.attachment;
    if (!attachment?.current() || !this.roomId || !this.participantId) return false;
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.publish();
    const roomId = this.roomId;
    const participantId = this.participantId;
    try {
      const commandId = commandIdSchema.parse(
        this.commandRecovery.id(payload, this.deps.newCommandId),
      );
      const report = await executeMultiplayerCommand(
        this.buildCommand(commandId, payload, roomId, participantId),
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
      if (report.receipt) this.commandRecovery.settled(payload);
      if (!report.receipt?.accepted) {
        throw new Error(`${this.rejectedLabel}: ${report.receipt?.rejectionCode ?? 'unknown'}`);
      }
      if (!attachment.current()) return false;
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

  private resetForAttach(): void {
    this.tickLoop.dispose();
    this.seriesFlow.reset();
    this.commandRecovery.reset();
    this.snapshot = null;
    this.participantId = null;
    this.commands = [];
    this.persistedCommandCount = 0;
    this.verification = [];
    this.savedActiveKey = null;
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
    this.pendingReady.reset();
    this.seenBroadcastGame = null;
    this.resetModeState();
  }

  private tick(): void {
    if (this.disposed || this.busy) return;
    if (this.shouldCreateRematchNow()) void this.syncFromServer();
    this.maybeProposeOrConfirm();
    this.maybeReadyNextGame();
    const due = this.dueDeadline();
    if (due) void this.resolveDeadline(due.cursor);
    if (
      this.seriesFlow.shouldAutoStart(
        this.localReady(),
        this.opponentReady(),
        this.readyWindowMs,
        this.now,
      )
    ) {
      void this.startBroadcast(!(this.localReady() && this.opponentReady()));
    }
  }

  private async resolveDeadline(cursor: string): Promise<void> {
    if (this.deadlineResolving || !this.roomId || !this.participantId) return;
    const payload = this.deadlineFallback(cursor);
    if (payload === null) return;
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    this.deadlineResolving = true;
    try {
      await this.deps.transport.commitFallback(attachment.roomId, cursor, payload);
      if (!attachment.current()) return;
      const receipt = await this.deps.transport.resolveTimeout(attachment.roomId);
      if (!attachment.current()) return;
      this.deadlineOutcome(cursor, receipt?.accepted === true);
      await this.syncFromServer();
    } catch {
      if (attachment.current()) this.deadlineOutcome(cursor, false);
    } finally {
      if (attachment.current()) this.deadlineResolving = false;
    }
  }

  private mergeLog(
    local: readonly TCommand[],
    fetched: readonly TCommand[],
    expectedCount: number,
  ): CommandLogMerge<TCommand> {
    return mergeCommandLog({
      local,
      fetched,
      expectedCount,
      ordinalOf: this.ordinalOf,
    });
  }

  private async runSync(): Promise<void> {
    if (this.disposed || !this.roomId || !this.hasAssets()) return;
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const roomId = attachment.roomId;
    const isDisposed = () => !attachment.current();
    try {
      let resumed = await this.deps.transport.sync(roomId, this.commands.length - 1);
      if (isDisposed()) return;
      this.lifecycle.connected(attachment);
      this.error = null;
      let merged = this.mergeLog(
        this.commands,
        resumed.commands,
        resumed.commandCount ?? resumed.snapshot.commandCount ?? this.commands.length,
      );
      if (!merged.complete) {
        resumed = await this.deps.transport.sync(roomId, -1);
        if (isDisposed()) return;
        merged = this.mergeLog(
          [],
          resumed.commands,
          resumed.commandCount ?? resumed.snapshot.commandCount ?? 0,
        );
        if (!merged.complete) throw new Error('room sync returned an incomplete command log');
      }
      if (isDisposed()) return;
      if (this.snapshot && resumed.snapshot.revision < this.snapshot.revision) {
        void this.syncFromServer();
        return;
      }
      const commandsChanged = merged.commands.length !== this.commands.length;
      this.commands = merged.commands;
      this.applySnapshot(resumed.snapshot, false);
      if (!this.afterSnapshotCompatible()) return;
      if (this.shouldRebuildDraft(commandsChanged)) this.rebuildDraft();
      if (this.shouldCreateRematchNow()) {
        this.rematchRetryAtMs = this.deps.now() + this.retryMs;
        await this.rematchAndResume(roomId);
        if (isDisposed()) return;
      }
      if (this.shouldPersistActive()) {
        if (this.commands.length > this.persistedCommandCount) {
          await this.appendCommands(roomId, this.commands.slice(this.persistedCommandCount));
          if (isDisposed()) return;
          this.persistedCommandCount = this.commands.length;
        }
        await this.runGamePipeline();
        if (isDisposed()) return;
        await this.persistActive();
      }
      if (isDisposed()) return;
      this.maybeProposeOrConfirm();
      this.maybeReadyNextGame();
      this.publish();
    } catch (error) {
      if (isDisposed()) return;
      this.lifecycle.failed(attachment);
      this.error = this.deps.friendlyError(error);
      this.publish();
    }
  }

  protected afterResume(): boolean {
    return true;
  }

  protected afterSnapshotCompatible(): boolean {
    return true;
  }
}
