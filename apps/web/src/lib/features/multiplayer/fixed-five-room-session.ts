import {
  commandIdSchema,
  contentHashSchema,
  idSchema,
  playerVersionId,
  type CommandId,
  type ContentHash,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCompetitionResult,
  type FixedFiveCompetitionRun,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomPhase,
  type FixedFiveRoomSnapshot,
  type FixedFiveVerificationReceipt,
  type FixedFiveWorkerResultEntry,
  type FixedFiveWorkerTeam,
  type Id,
  type PlayersIndexEntry,
  type Seed,
  type SimulationPlayer,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import { z } from 'zod';
import { submitFixedFiveCommand } from './fixed-five-command-submit';
import { friendlyFixedFiveJoinError, type StoredFixedFiveMembership } from './fixed-five-identity';
import type { FixedFiveRunner, FixedFiveRunnerEvent } from './fixed-five-runner';
import {
  FixedFiveSimulationGate,
  type FixedFiveSimulationReason,
} from './fixed-five-simulation-gate';
import {
  assembleCompetitionRun,
  buildFixedFiveVerificationInput,
  buildSimulationTeam,
  computeCompetitionDigest,
  computeDueAutopick,
  deriveEffectivePhase,
  isFixedFiveDraftTurn,
  mergeFixedFiveCommands,
  refsForParticipant,
  replayFixedFiveLog,
  restoreFixedFiveCommandSyncState,
  roomLogFacts,
  summarizeWorkerEntries,
  type DraftReplay,
  type FixedFiveAssets,
  type PickRef,
  type RoomLogFacts,
} from './fixed-five-room-state';

const SIM_SHOWDOWN_MIN_MS = 7000;
const SIM_SHOWDOWN_REDUCED_MS = 400;
const RESYNC_INTERVAL_MS = 15_000;
const CLOCK_INTERVAL_MS = 1_000;
const VERIFY_GUARD_PREFIX = 'hoop-rush:fixed-five:verify:';

export interface FixedFiveLocalResult {
  result: FixedFiveCompetitionResult;
  digest: ContentHash;
  p1: {
    refs: PickRef[];
    players: SimulationPlayer[];
  };
  p2: {
    refs: PickRef[];
    players: SimulationPlayer[];
  };
  weakestReplacedOpponentId: string | null;
}

export interface FixedFiveRoomSessionSnapshot {
  roomId: string;
  loading: boolean;
  error: string | null;
  notice: string | null;
  draftError: string | null;
  reconnecting: boolean;
  syncing: boolean;
  room: FixedFiveRoomSnapshot | null;
  commands: FixedFiveCommand[];
  replay: DraftReplay | null;
  assets: FixedFiveAssets | null;
  assetsError: string | null;
  selfId: FixedFiveParticipantId;
  lobbyId: string | null;
  phase: FixedFiveRoomPhase;
  canRematch: boolean;
  simStarted: boolean;
  simDone: boolean;
  simError: string | null;
  progress: {
    completed: number;
    total: number;
  } | null;
  simEntries: FixedFiveWorkerResultEntry[];
  statsEntries: FixedFiveWorkerResultEntry[];
  statsBuilding: boolean;
  localResult: FixedFiveLocalResult | null;
  receiptsUnsupported: boolean;
  verificationReceipt: FixedFiveVerificationReceipt | null;
  verificationError: string | null;
  verificationInFlight: boolean;
  submittedReceipt: string | null;
  submittedPropose: ContentHash | null;
  confirmedFor: ContentHash | null;
  reranMismatch: boolean;
  mismatchReported: boolean;
  completeNotReady: boolean;
  busyAction: string | null;
  leaveBusy: boolean;
  rematchBusy: boolean;
}

export type FixedFiveRunnerLike = Pick<
  FixedFiveRunner,
  'runShared82' | 'runDuel' | 'verify' | 'dispose'
>;

export interface FixedFiveRoomRepositoryPort {
  listCommands(roomId: string): Promise<FixedFiveCommand[]>;
  appendCommand(command: FixedFiveCommand): Promise<void>;
  saveActiveSnapshot(snapshot: FixedFiveRoomSnapshot, commandCursor: number): Promise<void>;
  loadPendingResult(roomId: string): Promise<{ run: FixedFiveCompetitionRun } | null>;
  savePendingResult(
    roomId: string,
    run: FixedFiveCompetitionRun,
    proposer: FixedFiveParticipantId,
  ): Promise<void>;
  clearPendingResult(roomId: string): Promise<void>;
}

export interface FixedFiveRoomSessionDeps {
  roomId: string;
  transport: FixedFiveMultiplayerTransport;
  repository: FixedFiveRoomRepositoryPort;
  createRunner: (onEvent: (event: FixedFiveRunnerEvent) => void) => FixedFiveRunnerLike;
  loadAssets: () => Promise<FixedFiveAssets | null>;
  loadMembership: (roomId: string) => StoredFixedFiveMembership | null;
  saveMembership: (membership: StoredFixedFiveMembership) => void;
  loadLobbyId: (roomId: string) => string | null;
  removeLobbyGuest: (lobbyId: string) => Promise<unknown>;
  now: () => number;
  loadActivityAt: (roomId: string) => number | null;
  saveActivityNow: (roomId: string) => void;
  prefersReducedMotion: () => boolean;
}

interface VerificationOutcome {
  ok: boolean;
  receipt: FixedFiveVerificationReceipt | null;
  failures: string[];
}

interface SimulationContext {
  p1Refs: PickRef[];
  p2Refs: PickRef[];
  p1Team: FixedFiveWorkerTeam;
  p2Team: FixedFiveWorkerTeam;
}

const verifyGuardSchema = z.object({
  submittedPropose: contentHashSchema.nullable().optional(),
  confirmedFor: contentHashSchema.nullable().optional(),
  reranMismatch: z.boolean().optional(),
  mismatchReported: z.boolean().optional(),
  receiptsUnsupported: z.boolean().optional(),
});

function isMissingFunctionError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  if (/schema cache|PGRST202|404/.test(message)) return true;
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : null;
  return code === 'PGRST202';
}

export class FixedFiveRoomSession {
  private readonly deps: FixedFiveRoomSessionDeps;
  private readonly roomId: string;
  private readonly listeners = new Set<(snapshot: FixedFiveRoomSessionSnapshot) => void>();
  private readonly simulationGate = new FixedFiveSimulationGate();
  private readonly submittedTimeouts = new Set<string>();

  private disposed = false;
  private loading = true;
  private error: string | null = null;
  private notice: string | null = null;
  private draftError: string | null = null;
  private reconnecting = false;
  private syncing = false;
  private room: FixedFiveRoomSnapshot | null = null;
  private commands: FixedFiveCommand[] = [];
  private replay: DraftReplay | null = null;
  private facts: RoomLogFacts = roomLogFacts([]);
  private assets: FixedFiveAssets | null = null;
  private assetsError: string | null = null;
  private selfId: FixedFiveParticipantId = 'p1';
  private lobbyId: string | null = null;
  private phase: FixedFiveRoomPhase = 'lobby';
  private lastOrdinal = -1;

  private simulationReason: FixedFiveSimulationReason = 'initial';
  private simStarted = false;
  private simStartAt = 0;
  private simDone = false;
  private simError: string | null = null;
  private progress: { completed: number; total: number } | null = null;
  private simEntries: FixedFiveWorkerResultEntry[] = [];
  private statsEntries: FixedFiveWorkerResultEntry[] = [];
  private statsBuilding = false;
  private statsRebuildStarted = false;
  private localResult: FixedFiveLocalResult | null = null;
  private runner: FixedFiveRunnerLike | null = null;
  private statsRunner: FixedFiveRunnerLike | null = null;
  private verificationRunner: FixedFiveRunnerLike | null = null;

  private submittedPropose: ContentHash | null = null;
  private confirmedFor: ContentHash | null = null;
  private reranMismatch = false;
  private mismatchReported = false;
  private completedPairKey: string | null = null;
  private completeNotReady = false;
  private completeInFlight = false;
  private failSent = false;
  private verificationReceipt: FixedFiveVerificationReceipt | null = null;
  private verificationError: string | null = null;
  private verificationInFlight = false;
  private submittedReceipt: string | null = null;
  private receiptSubmitInFlight = false;
  private receiptRebuilds = 0;
  private receiptsUnsupported = false;

  private busyAction: string | null = null;
  private leaveBusy = false;
  private rematchBusy = false;

  private unsubscribeTransport: (() => void) | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private readonly wakeHandler = (): void => {
    this.wake();
  };

  constructor(deps: FixedFiveRoomSessionDeps) {
    this.deps = deps;
    this.roomId = deps.roomId;
  }

  getSnapshot(): FixedFiveRoomSessionSnapshot {
    return {
      roomId: this.roomId,
      loading: this.loading,
      error: this.error,
      notice: this.notice,
      draftError: this.draftError,
      reconnecting: this.reconnecting,
      syncing: this.syncing,
      room: this.room,
      commands: this.commands,
      replay: this.replay,
      assets: this.assets,
      assetsError: this.assetsError,
      selfId: this.selfId,
      lobbyId: this.lobbyId,
      phase: this.phase,
      canRematch: this.canRematchNow(),
      simStarted: this.simStarted,
      simDone: this.simDone,
      simError: this.simError,
      progress: this.progress,
      simEntries: this.simEntries,
      statsEntries: this.statsEntries,
      statsBuilding: this.statsBuilding,
      localResult: this.localResult,
      receiptsUnsupported: this.receiptsUnsupported,
      verificationReceipt: this.verificationReceipt,
      verificationError: this.verificationError,
      verificationInFlight: this.verificationInFlight,
      submittedReceipt: this.submittedReceipt,
      submittedPropose: this.submittedPropose,
      confirmedFor: this.confirmedFor,
      reranMismatch: this.reranMismatch,
      mismatchReported: this.mismatchReported,
      completeNotReady: this.completeNotReady,
      busyAction: this.busyAction,
      leaveBusy: this.leaveBusy,
      rematchBusy: this.rematchBusy,
    };
  }

  subscribe(listener: (snapshot: FixedFiveRoomSessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.isDisposed()) return;
    this.lobbyId = this.deps.loadLobbyId(this.roomId);
    this.restoreVerifyGuards();
    const membership = this.deps.loadMembership(this.roomId);
    if (membership) this.selfId = membership.participantId;
    this.attachWakeHandlers();
    this.resyncTimer = setInterval(() => {
      void this.deps.transport
        .resolveTimeout(this.roomId)
        .then(() => this.sync(this.lastOrdinal))
        .catch(() => {});
    }, RESYNC_INTERVAL_MS);
    this.clockTimer = setInterval(() => {
      void this.resolveOverdue();
    }, CLOCK_INTERVAL_MS);
    await this.boot();
  }

  dispose(): void {
    if (this.isDisposed()) return;
    this.disposed = true;
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    this.runner?.dispose();
    this.runner = null;
    this.statsRunner?.dispose();
    this.statsRunner = null;
    this.verificationRunner?.dispose();
    this.verificationRunner = null;
    this.detachWakeHandlers();
    if (this.resyncTimer !== null) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    this.listeners.clear();
  }

  async refresh(): Promise<void> {
    await this.sync(this.lastOrdinal);
  }

  async startDraft(): Promise<void> {
    if (this.selfId !== 'p1' || this.busyAction !== null) return;
    this.busyAction = 'start';
    this.publish();
    try {
      await this.sendCommand({ kind: 'start' });
    } finally {
      if (!this.isDisposed()) {
        this.busyAction = null;
        this.publish();
      }
    }
  }

  async pickPlayer(player: PlayersIndexEntry, slot: SlotIndex): Promise<void> {
    this.draftError = null;
    this.publish();
    if (!this.room || !this.replay) return;
    try {
      const playerId = player.playerId;
      const playerVersion = playerVersionId(
        player.playerId,
        player.franchiseId,
        player.eraId,
        player.seasonKey,
      );
      const mode = this.room.settings.mode;
      const replay = this.replay;
      if (mode === 'sandbox-shared-82') {
        if (replay.mode !== 'sandbox-shared-82') {
          this.draftError = 'The draft is still syncing — try again in a moment.';
          this.publish();
          return;
        }
        if (replay.draftStyle === 'snake') {
          if (!isFixedFiveDraftTurn(replay, this.selfId)) {
            this.draftError = 'Wait for your opponent to finish this pick.';
            this.publish();
            return;
          }
          await this.sendCommand({
            kind: 'sandbox-place',
            playerId,
            playerVersionId: playerVersion,
            slotIndex: slot,
          });
          return;
        }
        const builder = this.selfId === 'p1' ? replay.p1 : replay.p2;
        const incumbent = builder.placements.find((p) => p.slotIndex === slot) ?? null;
        const subjectPlaced = builder.placements.some((p) => p.playerId === playerId);
        if (!incumbent && !subjectPlaced) {
          await this.sendCommand({
            kind: 'sandbox-place',
            playerId,
            playerVersionId: playerVersion,
            slotIndex: slot,
          });
          return;
        }
        const repositioned = await this.sendCommand({
          kind: 'sandbox-reposition',
          playerId,
          slotIndex: slot,
        });
        if (!repositioned) {
          this.draftError = 'That rearrangement is no longer legal — resync and try again.';
          this.publish();
        }
        return;
      }
      if (mode === 'duel') {
        if (replay.mode === 'sandbox-duel') {
          if (!isFixedFiveDraftTurn(replay, this.selfId)) {
            this.draftError = 'Wait for your opponent to finish this pick.';
            this.publish();
            return;
          }
          await this.sendCommand({
            kind: 'sandbox-place',
            playerId,
            playerVersionId: playerVersion,
            slotIndex: slot,
          });
          return;
        }
        if (replay.mode !== 'duel' || !replay.state.currentRoll) {
          this.draftError = 'No active duel roll.';
          this.publish();
          return;
        }
        if (!isFixedFiveDraftTurn(replay, this.selfId)) {
          this.draftError = 'Wait for your opponent to finish this pick.';
          this.publish();
          return;
        }
        const roll = replay.state.currentRoll;
        await this.sendCommand({
          kind: 'duel-claim',
          playerId,
          slotIndex: slot,
          franchiseId: roll.franchiseId,
          eraId: roll.eraId,
        });
        return;
      }
      if (replay.mode !== 'classic-shared-82') {
        await this.sendCommand({ kind: 'classic-pick', playerId, slotIndex: slot });
        return;
      }
      const draft = this.selfId === 'p1' ? replay.p1 : replay.p2;
      if (draft.picks.some((pick) => pick.playerId === playerId)) {
        await this.sendCommand({ kind: 'classic-reposition', playerId, slotIndex: slot });
        return;
      }
      await this.sendCommand({ kind: 'classic-pick', playerId, slotIndex: slot });
    } catch (e) {
      this.draftError = e instanceof Error ? e.message : String(e);
      this.publish();
    }
  }

  async reroll(axis: 'franchise' | 'era'): Promise<void> {
    this.draftError = null;
    this.publish();
    const ok = await this.sendCommand({ kind: 'reroll', axis });
    if (!ok && !this.isDisposed()) {
      this.draftError = 'Reroll was rejected — it may already be spent.';
      this.publish();
    }
  }

  async removeSlot(slot: SlotIndex): Promise<void> {
    await this.sendCommand({ kind: 'sandbox-remove', slotIndex: slot });
  }

  async lockLineup(): Promise<void> {
    await this.sendCommand({ kind: 'sandbox-lock' }, { retry: false });
  }

  retrySimulation(): void {
    if (this.isDisposed()) return;
    this.simStarted = false;
    this.simError = null;
    this.publish();
    this.maybeAutoStartSimulation();
  }

  requestStatsRebuild(): void {
    this.statsRebuildStarted = true;
    void this.rebuildStatsEntries();
  }

  retryVerification(): void {
    if (this.isDisposed()) return;
    this.verificationError = null;
    this.publish();
    this.maybePrepareReceipt();
  }

  async retryFinishing(): Promise<void> {
    if (this.isDisposed()) return;
    try {
      await this.deps.transport.verificationChallenge(this.roomId);
      if (this.isDisposed()) return;
      this.receiptsUnsupported = false;
      this.completedPairKey = null;
      this.completeNotReady = false;
      this.saveVerifyGuards();
      this.notice = 'Server verification is available — continuing with receipt flow.';
    } catch (e) {
      if (!isMissingFunctionError(e) && !this.isDisposed()) {
        this.error = friendlyFixedFiveJoinError(e);
      }
      this.completedPairKey = null;
      this.completeNotReady = false;
    }
    if (this.isDisposed()) return;
    this.publish();
    this.runAutoFlows();
    await this.sync(this.lastOrdinal);
  }

  async leaveRoom(): Promise<boolean> {
    if (this.isDisposed()) return false;
    this.leaveBusy = true;
    this.publish();
    try {
      this.runner?.dispose();
      this.runner = null;
      await this.deps.transport.leave(this.roomId, this.selfId);
      return true;
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
      return false;
    } finally {
      if (!this.isDisposed()) {
        this.leaveBusy = false;
        this.publish();
      }
    }
  }

  async removeGuest(): Promise<void> {
    if (this.busyAction !== null || this.selfId !== 'p1' || this.phase !== 'lobby') return;
    this.busyAction = 'remove';
    this.error = null;
    this.publish();
    try {
      if (this.lobbyId) {
        await this.deps.removeLobbyGuest(this.lobbyId);
        const resumed = await this.deps.transport.resume(this.roomId);
        if (this.isDisposed()) return;
        this.room = resumed.snapshot;
        this.recomputePhase();
        this.publish();
        return;
      }
      const next = await this.deps.transport.removeGuest(this.roomId, 'p2');
      if (this.isDisposed()) return;
      this.room = next;
      this.recomputePhase();
      this.publish();
    } catch (e) {
      if (!this.isDisposed()) {
        this.error = friendlyFixedFiveJoinError(e);
      }
    } finally {
      if (!this.isDisposed()) {
        this.busyAction = null;
        this.publish();
      }
    }
  }

  async rematchAction(): Promise<{ roomId: string } | null> {
    if (this.rematchBusy) return null;
    this.rematchBusy = true;
    this.error = null;
    this.publish();
    try {
      const other = this.selfId === 'p1' ? 'p2' : 'p1';
      if (!this.facts.rematchRequested[this.selfId]) {
        await this.sendCommand({ kind: 'rematch-request' });
      }
      if (this.facts.rematchRequested[other] && !this.facts.rematchConfirmed[this.selfId]) {
        await this.sendCommand({ kind: 'rematch-confirm' });
      }
      if (this.canRematchNow()) {
        return await this.createRematch();
      }
      this.notice = 'Rematch requested — it starts once your opponent hits rematch too.';
      this.publish();
      return null;
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
      this.publish();
      return null;
    } finally {
      if (!this.isDisposed()) {
        this.rematchBusy = false;
        this.publish();
      }
    }
  }

  private async createRematch(): Promise<{ roomId: string } | null> {
    try {
      const { snapshot: next, code } = await this.deps.transport.rematch(this.roomId);
      this.deps.saveMembership({ roomId: next.roomId, participantId: this.selfId, code });
      return { roomId: next.roomId };
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
      this.publish();
      return null;
    }
  }

  private canRematchNow(): boolean {
    return (
      this.facts.rematchRequested.p1 &&
      this.facts.rematchRequested.p2 &&
      this.facts.rematchConfirmed.p1 &&
      this.facts.rematchConfirmed.p2 &&
      this.room?.phase === 'completed'
    );
  }

  private attachWakeHandlers(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('focus', this.wakeHandler);
    window.addEventListener('online', this.wakeHandler);
  }

  private detachWakeHandlers(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('focus', this.wakeHandler);
    window.removeEventListener('online', this.wakeHandler);
  }

  private wake(): void {
    if (this.isDisposed()) return;
    this.reconnecting = true;
    this.publish();
    void this.sync(this.lastOrdinal).finally(() => {
      if (this.isDisposed()) return;
      this.reconnecting = false;
      this.publish();
    });
  }

  private async boot(): Promise<void> {
    if (this.isDisposed()) return;
    this.loading = true;
    this.publish();
    try {
      const transport = this.deps.transport;
      const resumed = await transport.resume(this.roomId);
      if (this.isDisposed()) return;
      const room = resumed.snapshot;
      this.room = room;
      this.selfId = resumed.membership.participantId;
      this.deps.saveMembership({
        ...resumed.membership,
        code: room.code ?? resumed.membership.code,
      });
      const [storedCommands, loadedAssets] = await Promise.all([
        this.deps.repository.listCommands(this.roomId).catch(() => []),
        this.deps.loadAssets().catch((e: unknown) => {
          this.assetsError = e instanceof Error ? e.message : String(e);
          return null;
        }),
      ]);
      if (this.isDisposed()) return;
      this.assets = loadedAssets;
      const restored = restoreFixedFiveCommandSyncState(storedCommands);
      this.commands = restored.commands;
      this.lastOrdinal = restored.lastOrdinal;
      this.refreshDerived();
      if (!room.rootSeed) {
        this.error = 'Room is missing its server seed — it cannot be simulated.';
      }
      await this.deps.repository.saveActiveSnapshot(room, this.lastOrdinal + 1).catch(() => {});
      if (this.isDisposed()) return;
      this.publish();
      this.unsubscribeTransport = transport.subscribe(this.roomId, (next) => {
        if (this.isDisposed()) return;
        this.room = next;
        this.reconnecting = false;
        this.recomputePhase();
        this.publish();
        void this.sync(this.lastOrdinal);
      }).unsubscribe;
      await this.sync(this.lastOrdinal);
      if (this.receiptsUnsupported) {
        try {
          await transport.verificationChallenge(this.roomId);
          if (this.isDisposed()) return;
          this.receiptsUnsupported = false;
          this.completedPairKey = null;
          this.completeNotReady = false;
          this.saveVerifyGuards();
          this.notice = 'Server verification is available — continuing with receipt flow.';
          await this.sync(this.lastOrdinal);
        } catch (e) {
          if (!isMissingFunctionError(e) && !this.isDisposed()) {
            this.error = friendlyFixedFiveJoinError(e);
          }
        }
      }
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
    } finally {
      if (!this.isDisposed()) {
        this.loading = false;
        this.publish();
      }
    }
  }

  private publish(): void {
    if (this.isDisposed()) return;
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private currentLocalResult(): FixedFiveLocalResult | null {
    return this.localResult;
  }

  private refreshDerived(): void {
    this.replay = this.computeReplay();
    this.facts = roomLogFacts(this.commands);
    this.recomputePhase();
  }

  private computeReplay(): DraftReplay | null {
    const room = this.room;
    const assets = this.assets;
    if (!room || !assets || !room.rootSeed) return null;
    try {
      return replayFixedFiveLog(
        room.settings.mode,
        room.roomId,
        room.rootSeed,
        room.settings.versions.dataVersion,
        room.settings.variant,
        assets,
        this.commands,
        room.settings.sourceMode,
        room.settings.versions.multiplayerVersion,
      );
    } catch {
      return null;
    }
  }

  private recomputePhase(): void {
    this.phase =
      this.room && this.replay
        ? deriveEffectivePhase(this.room.phase, this.replay, this.simDone)
        : (this.room?.phase ?? 'lobby');
  }

  private async sync(afterOrdinal: number): Promise<void> {
    if (this.isDisposed() || !this.room) return;
    this.syncing = true;
    this.publish();
    try {
      const fresh = await this.deps.transport.refetch(this.roomId, afterOrdinal);
      if (this.isDisposed()) return;
      if (fresh.length > 0) {
        const merged = mergeFixedFiveCommands(this.commands, fresh);
        const addedCount = merged.length - this.commands.length;
        this.commands = merged;
        const byOrdinal = new Map(merged.map((c) => [c.ordinal, c] as const));
        let contiguous = this.lastOrdinal;
        while (byOrdinal.has(contiguous + 1)) contiguous += 1;
        this.lastOrdinal = contiguous;
        for (const command of fresh) {
          try {
            await this.deps.repository.appendCommand(command);
          } catch {}
        }
        if (this.isDisposed()) return;
        this.deps.saveActivityNow(this.roomId);
        if (addedCount > 0) this.notice = 'Room is up to date.';
        this.refreshDerived();
      }
      const room = this.room;
      await this.deps.repository.saveActiveSnapshot(room, this.lastOrdinal + 1).catch(() => {});
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
    } finally {
      if (!this.isDisposed()) {
        this.syncing = false;
      }
    }
    if (this.isDisposed()) return;
    this.publish();
    this.runAutoFlows();
  }

  private runAutoFlows(): void {
    if (this.isDisposed()) return;
    this.maybeAutoStartSimulation();
    this.maybeRebuildStats();
    this.maybeAutoVerify();
    this.maybeReportMismatch();
    this.maybePrepareReceipt();
    this.maybeStoreReceipt();
    this.maybeComplete();
    this.maybeFail();
  }

  private maybeAutoStartSimulation(): void {
    if (this.isDisposed()) return;
    if (this.phase === 'simulating' && !this.simStarted && !this.simError && this.room?.rootSeed) {
      void this.startSimulation(this.simulationReason);
    }
  }

  private maybeRebuildStats(): void {
    if (!this.localResult || !this.room) return;
    if (this.phase !== 'awaiting-confirmation' && this.phase !== 'completed') return;
    if (this.statsSource().length > 0 || this.statsBuilding || this.statsRebuildStarted) return;
    this.statsRebuildStarted = true;
    void this.rebuildStatsEntries();
  }

  private statsSource(): FixedFiveWorkerResultEntry[] {
    return this.statsEntries.length > 0 ? this.statsEntries : this.simEntries;
  }

  private maybeAutoVerify(): void {
    if (this.isDisposed() || !this.localResult || !this.room) return;
    if (this.phase !== 'awaiting-confirmation') return;
    const myDigest = this.localResult.digest;
    const proposals = this.facts.proposals;
    const foreign = proposals.filter((p) => p.actor !== this.selfId);
    const iProposed = proposals.some((p) => p.actor === this.selfId && p.digest === myDigest);
    const matchingProposal = proposals.some((p) => p.digest === myDigest);
    const iConfirmed = this.facts.confirms.some(
      (c) => c.actor === this.selfId && c.digest === myDigest && c.verified,
    );
    if (iProposed && this.submittedPropose !== myDigest) {
      this.submittedPropose = myDigest;
      this.saveVerifyGuards();
    }
    if (iConfirmed && this.confirmedFor !== myDigest) {
      this.confirmedFor = myDigest;
      this.saveVerifyGuards();
    }
    this.publish();
    if (iConfirmed) return;
    if (foreign.length === 0) {
      if (!matchingProposal && this.submittedPropose !== myDigest) {
        void this.proposeDigest(myDigest);
      } else if (matchingProposal && this.confirmedFor !== myDigest) {
        void this.confirmDigest(myDigest, true);
      }
      return;
    }
    const match = foreign.some((p) => p.digest === myDigest);
    if (match) {
      if (this.confirmedFor !== myDigest) void this.confirmDigest(myDigest, true);
      return;
    }
    if (!this.reranMismatch) {
      this.reranMismatch = true;
      this.saveVerifyGuards();
      void this.rerunSimulation();
    }
  }

  private maybeReportMismatch(): void {
    if (this.isDisposed() || !this.localResult || !this.room) return;
    if (!this.reranMismatch || this.mismatchReported) return;
    if (this.phase !== 'awaiting-confirmation') return;
    const myDigest = this.localResult.digest;
    const foreign = this.facts.proposals.filter((p) => p.actor !== this.selfId);
    if (foreign.some((p) => p.digest === myDigest)) return;
    if (foreign.length === 0) return;
    this.mismatchReported = true;
    this.saveVerifyGuards();
    this.publish();
    const first = foreign[0];
    const iDenied = first
      ? this.facts.confirms.some(
          (c) => c.actor === this.selfId && c.digest === first.digest && !c.verified,
        )
      : true;
    void (async () => {
      if (this.submittedPropose !== myDigest) await this.proposeDigest(myDigest);
      if (first && !iDenied) await this.confirmDigest(first.digest, false);
    })();
  }

  private maybePrepareReceipt(): void {
    if (
      this.isDisposed() ||
      !this.room ||
      !this.assets ||
      !this.localResult ||
      !this.room.rootSeed
    ) {
      return;
    }
    if (this.phase !== 'awaiting-confirmation') return;
    if (this.receiptsUnsupported) return;
    if (this.verificationReceipt || this.verificationError || this.verificationInFlight) return;
    const myDigest = this.localResult.digest;
    const ownConfirmed = this.facts.confirms.some(
      (c) => c.actor === this.selfId && c.digest === myDigest && c.verified,
    );
    const foreignConfirmed = this.facts.confirms.some(
      (c) => c.actor !== this.selfId && c.digest === myDigest && c.verified,
    );
    if (!ownConfirmed || !foreignConfirmed) return;
    void this.prepareReceipt();
  }

  private maybeStoreReceipt(): void {
    if (!this.verificationReceipt) return;
    if (this.submittedReceipt === this.verificationReceipt.receiptDigest) return;
    void this.storeReceipt(this.verificationReceipt);
  }

  private maybeComplete(): void {
    if (this.isDisposed() || !this.room || !this.localResult) return;
    if (this.phase !== 'awaiting-confirmation') return;
    if (!this.receiptsUnsupported) {
      const receipt = this.verificationReceipt;
      if (!receipt || receipt.resultDigest !== this.localResult.digest) return;
      if (this.submittedReceipt !== receipt.receiptDigest) return;
      if (this.confirmedFor !== receipt.resultDigest) return;
      const foreignVerified = this.facts.confirms.filter(
        (c) => c.actor !== this.selfId && c.digest === receipt.resultDigest && c.verified,
      );
      if (foreignVerified.length === 0) return;
      const pairKey = `receipt:${receipt.resultDigest}:${String(foreignVerified.length)}`;
      if (this.completedPairKey === pairKey) return;
      void this.runCompleteOnce(receipt.receiptDigest, pairKey);
      return;
    }
    if (!this.confirmedFor) return;
    const foreignVerified = this.facts.confirms.filter(
      (c) => c.actor !== this.selfId && c.digest === this.confirmedFor && c.verified,
    );
    if (foreignVerified.length === 0) return;
    const pairKey = `${this.confirmedFor}:${String(foreignVerified.length)}`;
    if (this.completedPairKey === pairKey) return;
    void this.runCompleteOnce(this.confirmedFor, pairKey);
  }

  private maybeFail(): void {
    if (this.isDisposed() || !this.room || this.failSent) return;
    if (
      this.phase === 'completed' ||
      this.phase === 'integrity-failed' ||
      this.phase === 'expired'
    ) {
      return;
    }
    const digests = new Set(this.facts.proposals.map((p) => p.digest));
    const denied = this.facts.confirms.some((c) => !c.verified);
    if (digests.size >= 2 && denied) {
      this.failSent = true;
      void this.attemptFail().then((failed) => {
        if (this.isDisposed()) return;
        if (!failed) {
          this.failSent = false;
          this.notice = 'Mismatch recorded — will retry marking the room once synced.';
          this.publish();
        }
      });
    }
  }

  private async startSimulation(reason: FixedFiveSimulationReason): Promise<void> {
    if (this.isDisposed()) return;
    if (this.simStarted || !this.room || !this.assets || !this.room.rootSeed || !this.replay)
      return;
    if (!this.simulationGate.tryStart(reason)) return;
    this.simStarted = true;
    this.simError = null;
    this.publish();
    try {
      const room = this.room;
      const assets = this.assets;
      const replay = this.replay;
      if (!room.rootSeed) throw new Error('the room is not ready to simulate');
      const rootSeed: Seed = room.rootSeed;
      const p1Refs = refsForParticipant(replay, assets, 'p1');
      const p2Refs = refsForParticipant(replay, assets, 'p2');
      if (p1Refs.length !== 5 || p2Refs.length !== 5) {
        throw new Error('both lineups must be complete before simulating');
      }
      const pending = await this.deps.repository.loadPendingResult(this.roomId).catch(() => null);
      const p1Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p1',
        'Player 1',
        p1Refs,
      );
      if (this.isDisposed()) return;
      const p2Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p2',
        'Player 2',
        p2Refs,
      );
      if (this.isDisposed()) return;
      if (pending) {
        this.localResult = {
          result: pending.run.result,
          digest: pending.run.resultDigest,
          p1: { refs: p1Refs, players: [...p1Team.players] },
          p2: { refs: p2Refs, players: [...p2Team.players] },
          weakestReplacedOpponentId: pending.run.authorityFacts.weakestReplacedOpponentId,
        };
        this.simulationGate.finish();
        this.simDone = true;
        this.recomputePhase();
        this.publish();
        this.runAutoFlows();
        return;
      }
      this.simEntries = [];
      this.progress = { completed: 0, total: room.settings.mode === 'duel' ? 7 : 161 };
      this.simStartAt = this.deps.now();
      this.publish();
      const simulationContext: SimulationContext = { p1Refs, p2Refs, p1Team, p2Team };
      const active = this.deps.createRunner((event) => {
        if (this.isDisposed()) return;
        if (event.kind === 'progress') {
          this.progress = { completed: event.completedGames, total: event.totalGames };
          this.publish();
        } else if (event.kind === 'results') {
          this.simEntries = [...this.simEntries, ...event.entries];
          this.progress = {
            completed: this.simEntries.length,
            total: this.progress?.total ?? this.simEntries.length,
          };
          this.publish();
        } else if (event.kind === 'complete') {
          void this.finalizeSimulation(simulationContext);
        } else if (event.kind === 'error') {
          this.simulationGate.fail();
          this.simError = event.message;
          this.publish();
        }
      });
      this.runner = active;
      const versions = room.settings.versions;
      if (room.settings.mode === 'duel') {
        active.runDuel({
          rootSeed,
          p1Team,
          p2Team,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      } else {
        active.runShared82({
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      }
    } catch (e) {
      this.simulationGate.fail();
      if (this.isDisposed()) return;
      this.simError = e instanceof Error ? e.message : String(e);
      this.simStarted = false;
      this.publish();
    }
  }

  private async finalizeSimulation(context: SimulationContext): Promise<void> {
    if (this.isDisposed()) return;
    const room = this.room;
    const assets = this.assets;
    if (!room || !assets || !room.rootSeed) return;
    try {
      const rootSeed: Seed = room.rootSeed;
      const summary = summarizeWorkerEntries({
        mode: room.settings.mode,
        bracket: assets.bracket,
        rootSeed,
        p1TeamId: 'p1',
        p2TeamId: 'p2',
        p1PlayerIds: context.p1Team.players.map((player) => player.playerId),
        p2PlayerIds: context.p2Team.players.map((player) => player.playerId),
        entries: this.simEntries,
      });
      const digest = computeCompetitionDigest({
        rootSeed,
        versions: room.settings.versions,
        p1: { refs: context.p1Refs, players: [...context.p1Team.players] },
        p2: { refs: context.p2Refs, players: [...context.p2Team.players] },
        commands: this.commands,
        result: summary.result,
      });
      const run = assembleCompetitionRun({
        roomId: this.roomId,
        sourceMode: room.settings.sourceMode,
        competition: room.settings.mode === 'duel' ? 'duel' : 'shared-82',
        rootSeed,
        versions: room.settings.versions,
        commands: this.commands,
        p1: { refs: context.p1Refs, players: [...context.p1Team.players] },
        p2: { refs: context.p2Refs, players: [...context.p2Team.players] },
        result: summary.result,
        resultDigest: digest,
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      });
      await this.deps.repository.savePendingResult(this.roomId, run, this.selfId);
      if (this.isDisposed()) return;
      const minShow = this.deps.prefersReducedMotion()
        ? SIM_SHOWDOWN_REDUCED_MS
        : SIM_SHOWDOWN_MIN_MS;
      const waitMs = Math.max(0, this.simStartAt + minShow - this.deps.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (this.isDisposed()) return;
      this.localResult = {
        result: summary.result,
        digest,
        p1: { refs: context.p1Refs, players: [...context.p1Team.players] },
        p2: { refs: context.p2Refs, players: [...context.p2Team.players] },
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      };
      this.simulationGate.finish();
      this.simDone = true;
      this.recomputePhase();
      this.publish();
      this.runAutoFlows();
    } catch (e) {
      this.simulationGate.fail();
      if (this.isDisposed()) return;
      this.simError = e instanceof Error ? e.message : String(e);
      this.publish();
    }
  }

  private async rerunSimulation(): Promise<void> {
    try {
      this.simulationReason = 'mismatch-rerun';
      if (!this.simulationGate.canStart(this.simulationReason)) return;
      this.runner?.dispose();
      this.runner = null;
      this.statsRunner?.dispose();
      this.statsRunner = null;
      await this.deps.repository.clearPendingResult(this.roomId).catch(() => {});
      if (this.isDisposed()) return;
      this.verificationReceipt = null;
      this.verificationError = null;
      this.submittedReceipt = null;
      this.receiptRebuilds = 0;
      this.simStarted = false;
      this.simDone = false;
      this.localResult = null;
      this.simEntries = [];
      this.statsEntries = [];
      this.statsBuilding = false;
      this.statsRebuildStarted = false;
      this.progress = null;
      this.simError = null;
      this.recomputePhase();
      this.publish();
      await this.sync(this.lastOrdinal);
      if (this.isDisposed()) return;
      void this.startSimulation(this.simulationReason);
    } catch (e) {
      if (!this.isDisposed()) {
        this.simError = e instanceof Error ? e.message : String(e);
        this.publish();
      }
    }
  }

  private async rebuildStatsEntries(): Promise<void> {
    const room = this.room;
    const assets = this.assets;
    const localResult = this.localResult;
    if (this.statsBuilding || !room || !assets || !room.rootSeed || !this.replay || !localResult) {
      return;
    }
    this.statsBuilding = true;
    this.publish();
    try {
      const rootSeed: Seed = room.rootSeed;
      const p1Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p1',
        'Player 1',
        localResult.p1.refs,
      );
      const p2Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p2',
        'Player 2',
        localResult.p2.refs,
      );
      if (this.isDisposed()) {
        this.statsBuilding = false;
        return;
      }
      this.statsRunner?.dispose();
      const collected: FixedFiveWorkerResultEntry[] = [];
      const active = this.deps.createRunner((event) => {
        if (this.isDisposed()) return;
        if (event.kind === 'results') {
          for (const entry of event.entries) collected.push(entry);
        } else if (event.kind === 'complete') {
          this.statsEntries = collected;
          this.statsBuilding = false;
          this.statsRunner?.dispose();
          this.statsRunner = null;
          this.publish();
        } else if (event.kind === 'error') {
          this.statsBuilding = false;
          this.statsRunner?.dispose();
          this.statsRunner = null;
          this.publish();
        }
      });
      this.statsRunner = active;
      const versions = room.settings.versions;
      if (room.settings.mode === 'duel') {
        active.runDuel({
          rootSeed,
          p1Team,
          p2Team,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      } else {
        active.runShared82({
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      }
    } catch {
      if (!this.isDisposed()) {
        this.statsBuilding = false;
        this.publish();
      }
    }
  }

  private async sendCommand(
    payload: FixedFiveCommandPayload,
    options?: {
      actor?: FixedFiveParticipantId;
      commandId?: string;
      retry?: boolean;
    },
  ): Promise<boolean> {
    this.error = null;
    const commandId = this.newCommandId(options?.commandId);
    try {
      const result = await submitFixedFiveCommand({
        submitCommand: (command) => this.deps.transport.submitCommand(command),
        roomId: this.brandedRoomId(),
        commandId,
        actorParticipantId: options?.actor ?? this.selfId,
        payload,
        expectedRevision: this.room?.revision,
        resync: () => this.sync(this.lastOrdinal),
        retry: options?.retry,
        retryAfterResync: () => {
          if (payload.kind === 'propose-result') {
            return this.localResult?.digest === payload.resultDigest;
          }
          const currentResult = this.localResult;
          if (payload.kind !== 'confirm-result' || !currentResult) return false;
          const freshForeign = this.facts.proposals.filter(
            (proposal) => proposal.actor !== this.selfId,
          );
          if (payload.verified) {
            return (
              currentResult.digest === payload.resultDigest &&
              freshForeign.some((proposal) => proposal.digest === payload.resultDigest)
            );
          }
          return (
            this.reranMismatch &&
            currentResult.digest !== payload.resultDigest &&
            freshForeign.some((proposal) => proposal.digest === payload.resultDigest) &&
            !freshForeign.some((proposal) => proposal.digest === currentResult.digest)
          );
        },
      });
      if (this.isDisposed()) return false;
      const receipt = result.receipt;
      if (this.room && receipt.revision > this.room.revision) {
        this.room = { ...this.room, revision: receipt.revision };
      }
      if (result.retried && receipt.accepted) {
        this.notice = 'Room changed while sending — resynced and recovered.';
      }
      if (!receipt.accepted && receipt.rejectionCode === 'stale-revision') {
        this.notice = 'Stale command — resyncing once before a single retry.';
        this.error = result.retried
          ? 'The room changed again during the retry. The command was not applied.'
          : 'The room changed and invalidated this command. It was not applied.';
        this.publish();
        return false;
      }
      if (!receipt.accepted) {
        this.error = `Command rejected: ${receipt.rejectionCode ?? 'unknown'}`;
        this.publish();
        return false;
      }
      this.deps.saveActivityNow(this.roomId);
      await this.sync(this.lastOrdinal);
      return true;
    } catch (e) {
      if (!this.isDisposed()) {
        this.error = friendlyFixedFiveJoinError(e);
        this.publish();
      }
      return false;
    }
  }

  private async proposeDigest(digest: ContentHash): Promise<void> {
    this.busyAction = 'propose';
    this.publish();
    try {
      const ok = await this.sendCommand({ kind: 'propose-result', resultDigest: digest });
      if (ok && !this.isDisposed()) {
        this.submittedPropose = digest;
        this.saveVerifyGuards();
        this.publish();
        this.runAutoFlows();
      }
    } finally {
      if (!this.isDisposed()) {
        this.busyAction = null;
        this.publish();
      }
    }
  }

  private async confirmDigest(digest: ContentHash, verified: boolean): Promise<void> {
    this.busyAction = 'confirm';
    this.publish();
    try {
      const ok = await this.sendCommand({ kind: 'confirm-result', resultDigest: digest, verified });
      if (ok && verified && !this.isDisposed()) {
        this.confirmedFor = digest;
        this.saveVerifyGuards();
        this.publish();
        this.runAutoFlows();
      }
    } finally {
      if (!this.isDisposed()) {
        this.busyAction = null;
        this.publish();
      }
    }
  }

  private async attemptComplete(receiptId: string): Promise<boolean> {
    this.busyAction = 'complete';
    this.publish();
    try {
      const out = await this.deps.transport.complete(this.roomId, receiptId);
      if (this.isDisposed()) return false;
      if (!out.completed) {
        this.notice = 'Completion not ready yet — waiting for the matching confirmation.';
        this.publish();
      }
      await this.sync(this.lastOrdinal);
      return out.completed;
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
      return false;
    } finally {
      if (!this.isDisposed()) {
        this.busyAction = null;
        this.publish();
      }
    }
  }

  private async runCompleteOnce(receiptId: string, pairKey: string | null): Promise<void> {
    if (this.completeInFlight || this.isDisposed()) return;
    this.completeInFlight = true;
    if (pairKey) this.completedPairKey = pairKey;
    this.completeNotReady = false;
    this.publish();
    try {
      const done = await this.attemptComplete(receiptId);
      if (this.isDisposed()) return;
      this.completeNotReady = !done;
      this.publish();
    } finally {
      this.completeInFlight = false;
    }
  }

  private async attemptFail(): Promise<boolean> {
    this.busyAction = 'fail';
    this.publish();
    try {
      const out = await this.deps.transport.fail(this.roomId);
      await this.sync(this.lastOrdinal);
      return out.failed;
    } catch (e) {
      if (!this.isDisposed()) this.error = friendlyFixedFiveJoinError(e);
      return false;
    } finally {
      if (!this.isDisposed()) {
        this.busyAction = null;
        this.publish();
      }
    }
  }

  private async prepareReceipt(): Promise<void> {
    if (this.verificationInFlight || !this.room || !this.assets || !this.localResult) return;
    if (!this.room.rootSeed) return;
    this.verificationInFlight = true;
    this.verificationError = null;
    this.publish();
    try {
      const challenge = await this.deps.transport.verificationChallenge(this.roomId);
      if (this.isDisposed()) return;
      const current = this.currentLocalResult();
      if (!current) return;
      const input = buildFixedFiveVerificationInput({
        roomId: this.roomId,
        competition: this.room.settings.mode === 'duel' ? 'duel' : 'shared-82',
        rootSeed: this.room.rootSeed,
        versions: this.room.settings.versions,
        challenge,
        commands: this.commands,
        bracket: this.assets.bracket,
        profile: this.assets.profile,
        result: current.result,
        resultDigest: current.digest,
        p1: current.p1,
        p2: current.p2,
      });
      const outcome = await this.runVerification(input);
      if (this.isDisposed()) return;
      if (!outcome.ok || !outcome.receipt) {
        this.verificationError = outcome.failures.join('; ');
        this.publish();
        return;
      }
      this.verificationReceipt = outcome.receipt;
      this.publish();
      void this.storeReceipt(outcome.receipt);
    } catch (e) {
      if (isMissingFunctionError(e)) {
        this.markReceiptsUnsupported();
      } else if (!this.isDisposed()) {
        this.verificationError = e instanceof Error ? e.message : String(e);
      }
    } finally {
      this.verificationInFlight = false;
      if (!this.isDisposed()) this.publish();
    }
  }

  private runVerification(
    input: Parameters<FixedFiveRunnerLike['verify']>[0],
  ): Promise<VerificationOutcome> {
    return new Promise((resolve) => {
      const active = this.deps.createRunner((event) => {
        if (event.kind === 'progress' || event.kind === 'results' || event.kind === 'complete') {
          return;
        }
        active.dispose();
        if (this.verificationRunner === active) this.verificationRunner = null;
        if (event.kind === 'verified') {
          resolve({ ok: true, receipt: event.receipt, failures: [] });
        } else if (event.kind === 'verification-failed') {
          resolve({ ok: false, receipt: null, failures: event.failures });
        } else {
          resolve({ ok: false, receipt: null, failures: [event.message] });
        }
      });
      this.verificationRunner = active;
      active.verify(input);
    });
  }

  private async storeReceipt(receipt: FixedFiveVerificationReceipt): Promise<void> {
    if (this.receiptSubmitInFlight || this.submittedReceipt === receipt.receiptDigest) return;
    this.receiptSubmitInFlight = true;
    try {
      const out = await this.deps.transport.submitVerification(
        this.roomId,
        receipt,
        this.room?.revision,
      );
      if (this.isDisposed()) return;
      this.submittedReceipt = out.receiptId;
      if (this.room && out.revision > this.room.revision) {
        this.room = { ...this.room, revision: out.revision };
      }
      this.publish();
      this.runAutoFlows();
    } catch (e) {
      const rejection = e as {
        rejectionCode?: unknown;
        revision?: unknown;
      };
      if (
        typeof rejection.revision === 'number' &&
        this.room &&
        rejection.revision > this.room.revision
      ) {
        this.room = { ...this.room, revision: rejection.revision };
      }
      if (rejection.rejectionCode === 'invalid-receipt' && this.receiptRebuilds < 2) {
        this.receiptRebuilds += 1;
        this.verificationReceipt = null;
        this.verificationError = null;
        if (!this.isDisposed()) {
          this.notice = 'Verification receipt was rejected — rebuilding it from the accepted log.';
        }
      } else if (rejection.rejectionCode === 'invalid-receipt') {
        if (!this.isDisposed()) {
          this.verificationError =
            'The server rejected the verification receipt for this accepted command log.';
        }
      } else if (isMissingFunctionError(e)) {
        this.markReceiptsUnsupported();
      } else if (!this.isDisposed()) {
        this.notice =
          'Verification receipt is ready but not stored yet — retrying after the next sync.';
      }
      this.publish();
      if (!this.isDisposed()) void this.sync(this.lastOrdinal);
    } finally {
      this.receiptSubmitInFlight = false;
    }
  }

  private markReceiptsUnsupported(): void {
    if (this.receiptsUnsupported) return;
    this.receiptsUnsupported = true;
    this.verificationError = null;
    this.saveVerifyGuards();
    if (!this.isDisposed()) {
      this.notice = 'Checking that both players have the same result.';
      this.publish();
      this.runAutoFlows();
    }
  }

  private async resolveOverdue(): Promise<void> {
    if (this.isDisposed() || !this.room || !this.assets || !this.room.rootSeed || !this.replay)
      return;
    if (this.phase !== 'drafting') return;
    const mode = this.room.settings.mode;
    const now = this.deps.now();
    const deadline = this.room.deadline;
    if (!deadline) return;
    if (now < Date.parse(deadline.deadlineAt)) return;
    const participant = deadline.participantId;
    if (participant !== this.selfId) return;
    const ordinal = deadline.pickOrdinal;
    const key = `${participant}:${String(ordinal)}`;
    if (this.submittedTimeouts.has(key)) return;
    const applied = this.commands.some(
      (c) =>
        c.actorParticipantId === participant &&
        c.payload.kind === 'timeout-autopick' &&
        c.payload.pickOrdinal === ordinal,
    );
    if (applied) return;
    const pick = computeDueAutopick(
      mode,
      this.room.rootSeed,
      this.replay,
      this.assets,
      participant,
    );
    if (!pick) return;
    this.submittedTimeouts.add(key);
    try {
      const stored = await this.deps.transport.commitFallback(
        this.roomId,
        deadline.cursor,
        {
          kind: 'timeout-autopick',
          playerId: pick.playerId,
          playerVersionId: pick.playerVersionId,
          slotIndex: pick.slotIndex,
          pickOrdinal: ordinal,
          seedPath: pick.seedPath,
        },
        this.room.revision,
      );
      if (this.isDisposed()) return;
      if (stored.revision > this.room.revision) {
        this.room = { ...this.room, revision: stored.revision };
      }
      if (!stored.stored) {
        this.submittedTimeouts.delete(key);
        this.publish();
        return;
      }
      await this.deps.transport.resolveTimeout(this.roomId);
      await this.sync(this.lastOrdinal);
    } catch (e) {
      this.submittedTimeouts.delete(key);
      if (isMissingFunctionError(e)) {
        this.markReceiptsUnsupported();
        this.submittedTimeouts.add(key);
        void this.sendCommand(
          {
            kind: 'timeout-autopick',
            playerId: pick.playerId,
            playerVersionId: pick.playerVersionId,
            slotIndex: pick.slotIndex,
            pickOrdinal: ordinal,
            seedPath: pick.seedPath,
          },
          { actor: participant, commandId: `timeout-${deadline.cursor}-${String(ordinal)}` },
        );
        return;
      }
      if (!this.isDisposed()) {
        this.error = friendlyFixedFiveJoinError(e);
        this.publish();
      }
    }
  }

  private newCommandId(provided?: string): CommandId {
    return provided ? commandIdSchema.parse(provided) : commandIdSchema.parse(crypto.randomUUID());
  }

  private brandedRoomId(): Id {
    return idSchema.parse(this.roomId);
  }

  private verifyGuardStorageKey(): string {
    return `${VERIFY_GUARD_PREFIX}${this.roomId}`;
  }

  private saveVerifyGuards(): void {
    try {
      localStorage.setItem(
        this.verifyGuardStorageKey(),
        JSON.stringify({
          submittedPropose: this.submittedPropose,
          confirmedFor: this.confirmedFor,
          reranMismatch: this.reranMismatch,
          mismatchReported: this.mismatchReported,
          receiptsUnsupported: this.receiptsUnsupported,
        }),
      );
    } catch {}
  }

  private restoreVerifyGuards(): void {
    try {
      const raw = localStorage.getItem(this.verifyGuardStorageKey());
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const result = verifyGuardSchema.safeParse(parsed);
      if (!result.success) return;
      if (result.data.submittedPropose) this.submittedPropose = result.data.submittedPropose;
      if (result.data.confirmedFor) this.confirmedFor = result.data.confirmedFor;
      if (result.data.reranMismatch === true) this.reranMismatch = true;
      if (result.data.mismatchReported === true) this.mismatchReported = true;
    } catch {}
  }
}
