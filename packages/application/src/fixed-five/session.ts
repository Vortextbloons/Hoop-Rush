import {
  FIXED_FIVE_DUEL_GAME_READY_TIMEOUT_MS,
  FIXED_FIVE_DUEL_GAME_RESULTS_HOLD_MS,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  commandIdSchema,
  idSchema,
  playerVersionId,
  type ClassicDraftCatalog,
  type CommandId,
  type ContentHash,
  type EraSimulationProfile,
  type FixedFiveBroadcast,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCompetitionResult,
  type FixedFiveCompetitionRun,
  type FixedFiveDuelGameOutput,
  type FixedFiveShared82H2HGameOutput,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomMembership,
  type FixedFiveRoomPhase,
  type FixedFiveRoomSnapshot,
  type FixedFiveVerificationReceipt,
  type FixedFiveWorkerResultEntry,
  type FixedFiveWorkerTeam,
  type HoopRushManifest,
  type Id,
  type OpponentBracket,
  type OpponentBracketCore,
  type PlayersIndex,
  type PlayersIndexEntry,
  type Seed,
  type SimulationPlayer,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import {
  assembleCompetitionRun,
  computeCompetitionDigest,
  computeDueAutopick,
  deriveEffectivePhase,
  findWeakestOpponent,
  h2hGameNumbersFor,
  isFixedFiveDraftTurn,
  mergeFixedFiveCommands,
  replayFixedFiveLog,
  restoreFixedFiveCommandSyncState,
  roomLogFacts,
  summarizeWorkerEntries,
  type DraftReplay,
  type EngineContext,
  type FixedFiveCandidate,
  type FixedFivePickRef,
  type FixedFiveVerificationInput,
  type RoomLogFacts,
} from '@hoop-rush/engine';
import { SeriesCoordinator } from '../multiplayer/series-coordinator.ts';
import { clamp01, CoalescedTask } from '../runtime/index.ts';
import { RoomLifecycle, type RoomAttachment } from '../multiplayer/room-lifecycle.ts';
import { submitFixedFiveCommand } from './command-submit.ts';
import { FixedFiveCompetitionFlow } from './competition-flow.ts';
import { FixedFiveVerificationFlow, isMissingFunctionError } from './verification-flow.ts';
import { refsForParticipant } from './pick-refs.ts';
export { refsForParticipant } from './pick-refs.ts';

const RESYNC_INTERVAL_MS = 15_000;
const CLOCK_INTERVAL_MS = 1_000;
const REVEAL_INTERVAL_MS = 240;
const DUEL_AUTO_START_RETRY_MS = 5000;
const NOTICE_TTL_MS = 6_000;

export type DuelGameVerification = 'pending' | 'verified' | 'mismatch';

export interface FixedFiveLocalResult {
  result: FixedFiveCompetitionResult;
  digest: ContentHash;
  p1: {
    refs: FixedFivePickRef[];
    players: SimulationPlayer[];
  };
  p2: {
    refs: FixedFivePickRef[];
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
  assets: FixedFiveSessionAssets | null;
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
  revealedEntries: FixedFiveWorkerResultEntry[];
  revealedThroughGameNumber: number;
  statsEntries: FixedFiveWorkerResultEntry[];
  statsBuilding: boolean;
  localResult: FixedFiveLocalResult | null;
  duelBroadcast: boolean;
  duelOutputs: Record<number, FixedFiveDuelGameOutput>;
  shared82Broadcast: boolean;
  shared82H2HOutputs: Record<number, FixedFiveShared82H2HGameOutput>;
  shared82H2HSimError: string | null;
  shared82H2HSimulatingGame: number | null;
  duelSimError: string | null;
  duelSimulatingGame: number | null;
  broadcastProgress: number;
  duelVerification: DuelGameVerification;
  localReady: boolean;
  opponentReady: boolean;
  readyCountdownMs: number | null;
  awaitingContinue: boolean;
  duelRecapGame: number | null;
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

export type FixedFiveRunnerEvent =
  | {
      kind: 'progress';
      completedGames: number;
      totalGames: number;
    }
  | {
      kind: 'results';
      entries: FixedFiveWorkerResultEntry[];
    }
  | {
      kind: 'duel-game';
      output: FixedFiveDuelGameOutput;
    }
  | {
      kind: 'shared82-h2h-game';
      output: FixedFiveShared82H2HGameOutput;
    }
  | {
      kind: 'complete';
      gamesDelivered: number;
    }
  | {
      kind: 'verified';
      receipt: FixedFiveVerificationReceipt;
    }
  | {
      kind: 'verification-failed';
      failures: string[];
    }
  | {
      kind: 'error';
      message: string;
    };

export interface FixedFiveRunnerPort {
  runShared82(input: {
    rootSeed: Seed;
    p1Team: FixedFiveWorkerTeam;
    p2Team: FixedFiveWorkerTeam;
    bracket: OpponentBracketCore;
    profile: EraSimulationProfile;
    dataVersion: string;
    engineVersion: string;
    startGameNumber?: number;
    recordH2H?: boolean;
  }): void;
  runDuel(input: {
    rootSeed: Seed;
    p1Team: FixedFiveWorkerTeam;
    p2Team: FixedFiveWorkerTeam;
    profile: EraSimulationProfile;
    dataVersion: string;
    engineVersion: string;
  }): void;
  runDuelGame(input: {
    roomId: string;
    gameNumber: number;
    rootSeed: Seed;
    p1Team: FixedFiveWorkerTeam;
    p2Team: FixedFiveWorkerTeam;
    profile: EraSimulationProfile;
    dataVersion: string;
    engineVersion: string;
  }): void;
  runShared82H2HGame(input: {
    roomId: string;
    gameNumber: number;
    rootSeed: Seed;
    p1Team: FixedFiveWorkerTeam;
    p2Team: FixedFiveWorkerTeam;
    bracket: OpponentBracket;
    profile: EraSimulationProfile;
    dataVersion: string;
    engineVersion: string;
  }): void;
  verify(input: FixedFiveVerificationInput): void;
  dispose(): void;
}

export interface FixedFiveSessionAssets {
  catalog: ClassicDraftCatalog;
  pool: FixedFiveCandidate[];
  poolById: Map<string, FixedFiveCandidate>;
  context: EngineContext;
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
  index: PlayersIndex;
}

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
  createRunner: (onEvent: (event: FixedFiveRunnerEvent) => void) => FixedFiveRunnerPort;
  loadAssets: () => Promise<FixedFiveSessionAssets | null>;
  buildTeam: (
    manifest: HoopRushManifest,
    teamId: string,
    displayName: string,
    refs: FixedFivePickRef[],
  ) => Promise<FixedFiveWorkerTeam>;
  loadMembership: (roomId: string) => FixedFiveRoomMembership | null;
  saveMembership: (membership: FixedFiveRoomMembership) => void;
  loadLobbyId: (roomId: string) => string | null;
  removeLobbyGuest: (lobbyId: string) => Promise<unknown>;
  now: () => number;
  newCommandId: () => string;
  friendlyError: (error: unknown) => string;
  loadActivityAt: (roomId: string) => number | null;
  saveActivityNow: (roomId: string) => void;
  prefersReducedMotion: () => boolean;
  guardStorage: {
    load(key: string): string | null;
    save(key: string, value: string): void;
  };
}

function otherParticipant(participantId: FixedFiveParticipantId): FixedFiveParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export type FixedFiveFlowContext = Pick<
  FixedFiveRoomSessionSnapshot,
  'room' | 'assets' | 'replay' | 'commands' | 'selfId' | 'phase'
>;

export class FixedFiveRoomSession {
  private readonly competition: FixedFiveCompetitionFlow;
  private readonly verification: FixedFiveVerificationFlow;
  private readonly deps: FixedFiveRoomSessionDeps;
  private readonly roomId: string;
  private readonly listeners = new Set<(snapshot: FixedFiveRoomSessionSnapshot) => void>();
  private readonly submittedTimeouts = new Set<string>();

  private disposed = false;
  private loading = true;
  private error: string | null = null;
  private notice: string | null = null;
  private noticeAtMs = 0;
  private draftError: string | null = null;
  private reconnecting = false;
  private syncing = false;
  private submissionsInFlight = 0;
  private autoFlowsDeferred = false;
  private room: FixedFiveRoomSnapshot | null = null;
  private commands: FixedFiveCommand[] = [];
  private replay: DraftReplay | null = null;
  private facts: RoomLogFacts = roomLogFacts([]);
  private assets: FixedFiveSessionAssets | null = null;
  private assetsError: string | null = null;
  private selfId: FixedFiveParticipantId = 'p1';
  private lobbyId: string | null = null;
  private phase: FixedFiveRoomPhase = 'lobby';
  private lastOrdinal = -1;

  private duelOutputs: Record<number, FixedFiveDuelGameOutput> = {};
  private duelRunner: FixedFiveRunnerPort | null = null;
  private shared82H2HOutputs: Record<number, FixedFiveShared82H2HGameOutput> = {};
  private shared82H2HRunner: FixedFiveRunnerPort | null = null;
  private shared82H2HSimulatingGame: number | null = null;
  private shared82H2HSimError: string | null = null;
  private broadcastStartPending: number | null = null;
  private duelSimulatingGame: number | null = null;
  private duelSimError: string | null = null;
  private readonly seriesFlow: SeriesCoordinator;
  private readonly lifecycle = new RoomLifecycle();
  private attachment: RoomAttachment | null = null;
  private broadcastProgress = 0;
  private duelRecapGame: number | null = null;

  private busyAction: string | null = null;
  private leaveBusy = false;
  private rematchBusy = false;

  private unsubscribeTransport: (() => void) | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private revealTimer: ReturnType<typeof setInterval> | null = null;
  private readonly reconcileTask = new CoalescedTask(() => this.reconcile());
  private pendingReadyGame: number | null = null;
  private pendingReadyRetryAtMs = 0;
  private readonly wakeHandler = (): void => {
    this.wake();
  };

  constructor(deps: FixedFiveRoomSessionDeps) {
    this.deps = deps;
    this.seriesFlow = new SeriesCoordinator(deps.now, DUEL_AUTO_START_RETRY_MS);
    this.seriesFlow.holdMs = FIXED_FIVE_DUEL_GAME_RESULTS_HOLD_MS;
    this.roomId = deps.roomId;
    this.competition = new FixedFiveCompetitionFlow(deps, {
      context: () => this.flowContext(),
      isDisposed: () => this.isDisposed(),
      publish: () => {
        this.publish();
      },
      recomputePhase: () => {
        this.recomputePhase();
      },
      runAutoFlows: () => {
        this.runAutoFlows();
      },
      resetVerification: () => {
        this.verification.resetResult();
      },
      sync: () => this.sync(),
      shared82H2HGame: (output) => {
        this.shared82H2HOutputs = {
          ...this.shared82H2HOutputs,
          [output.gameNumber]: output,
        };
        if (this.shared82H2HSimulatingGame === output.gameNumber) {
          this.shared82H2HRunner?.dispose();
          this.shared82H2HRunner = null;
          this.shared82H2HSimulatingGame = null;
        }
        this.shared82H2HSimError = null;
        this.publish();
        this.tickShared82Reveal();
      },
    });
    this.verification = new FixedFiveVerificationFlow(deps, {
      context: () => ({
        ...this.flowContext(),
        facts: this.facts,
        localResult: this.competition.getSnapshot().localResult,
      }),
      isDisposed: () => this.isDisposed(),
      publish: () => {
        this.publish();
      },
      runAutoFlows: () => {
        this.runAutoFlows();
      },
      sync: () => this.sync(),
      rerunSimulation: () => this.competition.rerun(),
      setBusyAction: (action) => {
        this.busyAction = action;
      },
      setError: (message) => {
        this.error = message;
      },
      setNotice: (message) => {
        this.setNotice(message);
      },
      advanceRevision: (revision) => {
        if (this.room && revision > this.room.revision) this.room = { ...this.room, revision };
      },
      sendCommand: (payload) => this.sendCommand(payload),
    });
  }

  getSnapshot(): FixedFiveRoomSessionSnapshot {
    return {
      ...this.competition.getSnapshot(),
      ...this.verification.getSnapshot(),
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
      duelBroadcast: this.isDuelBroadcast(),
      duelOutputs: this.duelOutputs,
      shared82Broadcast: this.isShared82Broadcast(),
      shared82H2HOutputs: this.shared82H2HOutputs,
      shared82H2HSimError: this.shared82H2HSimError,
      shared82H2HSimulatingGame: this.shared82H2HSimulatingGame,
      duelSimError: this.duelSimError,
      duelSimulatingGame: this.duelSimulatingGame,
      broadcastProgress: this.broadcastProgress,
      duelVerification: this.duelVerification(),
      localReady: this.duelLocalReady(),
      opponentReady: this.duelOpponentReady(),
      readyCountdownMs: this.duelReadyCountdownMs(),
      awaitingContinue: this.duelAwaitingContinue(),
      duelRecapGame: this.duelRecapGame,
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
    if (this.isDisposed() || this.attachment?.current()) return;
    this.attachment = this.lifecycle.begin(this.roomId);
    this.lobbyId = this.deps.loadLobbyId(this.roomId);
    this.verification.restore();
    const membership = this.deps.loadMembership(this.roomId);
    if (membership) this.selfId = membership.participantId;
    this.attachWakeHandlers();
    this.resyncTimer = setInterval(() => {
      void this.deps.transport
        .resolveTimeout(this.roomId)
        .catch(() => null)
        .then(() => this.sync())
        .catch(() => {});
    }, RESYNC_INTERVAL_MS);
    this.clockTimer = setInterval(() => {
      this.maybeExpireNotice();
      this.tickDuel();
      void this.resolveOverdue();
    }, CLOCK_INTERVAL_MS);
    this.revealTimer = setInterval(() => {
      this.tickShared82Reveal();
    }, REVEAL_INTERVAL_MS);
    await this.boot();
  }

  dispose(): void {
    if (this.isDisposed()) return;
    this.disposed = true;
    this.lifecycle.dispose();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    this.competition.dispose();
    this.verification.dispose();
    this.duelRunner?.dispose();
    this.duelRunner = null;
    this.shared82H2HRunner?.dispose();
    this.shared82H2HRunner = null;
    this.detachWakeHandlers();
    if (this.resyncTimer !== null) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.revealTimer !== null) {
      clearInterval(this.revealTimer);
      this.revealTimer = null;
    }
    this.listeners.clear();
  }

  retrySimulation(): void {
    this.competition.retry();
  }

  requestStatsRebuild(): void {
    this.competition.requestStatsRebuild();
  }

  retryVerification(): void {
    this.verification.retry();
  }

  retryFinishing(): Promise<void> {
    return this.verification.retryFinishing();
  }

  private flowContext(): FixedFiveFlowContext {
    return {
      room: this.room,
      assets: this.assets,
      replay: this.replay,
      commands: this.commands,
      selfId: this.selfId,
      phase: this.phase,
    };
  }

  async refresh(): Promise<void> {
    await this.sync();
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
          const own = replay.state.picks.filter((p) => p.participantId === this.selfId);
          if (own.some((p) => p.playerId === playerId)) {
            await this.sendCommand({ kind: 'sandbox-reposition', playerId, slotIndex: slot });
            return;
          }
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
          const own = replay.state.picks.filter((p) => p.participantId === this.selfId);
          if (own.some((p) => p.playerId === playerId)) {
            await this.sendCommand({ kind: 'duel-reposition', playerId, slotIndex: slot });
            return;
          }
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
        const own = replay.state.picks.filter((p) => p.participantId === this.selfId);
        if (own.some((p) => p.playerId === playerId)) {
          await this.sendCommand({ kind: 'duel-reposition', playerId, slotIndex: slot });
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

  retryDuelGame(): void {
    if (this.isDisposed()) return;
    this.duelSimError = null;
    this.publish();
    this.maybeStartDuelPipeline();
  }

  retryShared82H2HGame(): void {
    if (!this.isShared82Broadcast()) return;
    const gameNumber = this.room?.broadcast?.gameNumber ?? this.competition.advanceSeasonReveal();
    if (gameNumber === null) return;
    this.shared82H2HOutputs = Object.fromEntries(
      Object.entries(this.shared82H2HOutputs).filter(([key]) => Number(key) !== gameNumber),
    );
    this.shared82H2HSimError = null;
    this.shared82H2HRunner?.dispose();
    this.shared82H2HRunner = null;
    this.shared82H2HSimulatingGame = null;
    this.maybeStartShared82H2HGame(gameNumber);
  }

  async readyForNextGame(): Promise<void> {
    if (!this.isDuelBroadcast() || this.room?.phase !== 'preparing-game') return;
    const gameNumber = this.duelCurrentGameNumber();
    if (gameNumber === null) return;
    await this.sendCommand({ kind: 'ready-next-game', gameNumber, ready: true }, { quiet: true });
  }

  async startBroadcast(auto = false): Promise<void> {
    if (this.isDuelBroadcast()) {
      const gameNumber = this.duelCurrentGameNumber();
      if (gameNumber === null) return;
      await this.sendCommand(
        {
          kind: 'broadcast-start',
          gameNumber,
          ...(auto ? { auto: true } : {}),
        },
        { quiet: true },
      );
      return;
    }
    if (!this.isShared82Broadcast() || this.broadcastStartPending !== null) return;
    const gameNumber = this.competition.advanceSeasonReveal();
    const room = this.room;
    if (gameNumber === null || !room || room.broadcast) return;
    if (!this.shared82H2HOutputs[gameNumber]) {
      this.maybeStartShared82H2HGame(gameNumber);
      return;
    }
    const eligibleGameNumbers = this.shared82H2HGameNumbers();
    if (eligibleGameNumbers.length === 0) return;
    this.broadcastStartPending = gameNumber;
    try {
      await this.sendCommand(
        { kind: 'broadcast-start', gameNumber, eligibleGameNumbers },
        { quiet: true },
      );
    } finally {
      if (this.broadcastStartPending === gameNumber) this.broadcastStartPending = null;
    }
  }

  beginPlayback(): void {
    if (this.isDisposed()) return;
    const broadcast = this.duelBroadcastOf();
    if (!broadcast) return;
    const startedAt = Date.parse(broadcast.startedAtIso);
    this.seriesFlow.playback.begin(this.deps.now(), startedAt, broadcast.durationMs);
    this.broadcastProgress = clamp01((this.deps.now() - startedAt) / broadcast.durationMs);
    this.publish();
  }

  advancePlayback(deltaMs: number): void {
    if (this.isDisposed()) return;
    const broadcast = this.duelBroadcastOf();
    if (!broadcast) return;
    const outcome = this.seriesFlow.playback.advance(
      deltaMs,
      broadcast.durationMs,
      this.deps.now(),
    );
    this.broadcastProgress = outcome.progress;
    if (outcome.completed) this.duelRecapGame = broadcast.gameNumber;
    this.publish();
    if (this.broadcastProgress >= 1) this.maybeProposeOrConfirmGame();
  }

  continueAfterGame(): void {
    if (this.isDisposed()) return;
    const gameNumber = this.duelRecapGame ?? this.duelCurrentGameNumber();
    if (gameNumber === null) return;
    this.seriesFlow.playback.approve(gameNumber);
    this.pendingReadyGame = gameNumber + 1;
    this.pendingReadyRetryAtMs = 0;
    this.publish();
    this.maybeProposeOrConfirmGame();
  }

  async leaveRoom(): Promise<boolean> {
    if (this.isDisposed()) return false;
    this.leaveBusy = true;
    this.publish();
    try {
      this.competition.stopSimulation();
      this.duelRunner?.dispose();
      this.duelRunner = null;
      await this.deps.transport.leave(this.roomId, this.selfId);
      return true;
    } catch (e) {
      if (!this.isDisposed()) this.error = this.deps.friendlyError(e);
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
        this.applyRoomSnapshot(resumed.snapshot);
        this.recomputePhase();
        this.publish();
        return;
      }
      const next = await this.deps.transport.removeGuest(this.roomId, 'p2');
      if (this.isDisposed()) return;
      this.applyRoomSnapshot(next);
      this.recomputePhase();
      this.publish();
    } catch (e) {
      if (!this.isDisposed()) {
        this.error = this.deps.friendlyError(e);
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
      this.setNotice('Rematch requested — it starts once your opponent hits rematch too.');
      this.publish();
      return null;
    } catch (e) {
      if (!this.isDisposed()) this.error = this.deps.friendlyError(e);
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
      if (!this.isDisposed()) this.error = this.deps.friendlyError(e);
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
    void this.sync()
      .then(() => {
        if (this.isDisposed()) return;
        if (this.error === null) this.setNotice('Back in sync with the room.');
      })
      .finally(() => {
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
      this.applyRoomSnapshot(room);
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
      this.unsubscribeTransport = transport.subscribe(this.roomId, () => {
        if (this.isDisposed()) return;
        this.reconnecting = false;
        void this.sync();
      }).unsubscribe;
      await this.sync();
      if (this.verification.getSnapshot().receiptsUnsupported) {
        try {
          await transport.verificationChallenge(this.roomId);
          if (this.isDisposed()) return;
          this.verification.enableReceipts();
          await this.sync();
        } catch (e) {
          if (!isMissingFunctionError(e) && !this.isDisposed()) {
            this.error = this.deps.friendlyError(e);
          }
        }
      }
    } catch (e) {
      if (!this.isDisposed()) this.error = this.deps.friendlyError(e);
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
        ? deriveEffectivePhase(this.room.phase, this.replay, this.competition.getSnapshot().simDone)
        : (this.room?.phase ?? 'lobby');
  }

  private setNotice(message: string | null): void {
    this.notice = message;
    this.noticeAtMs = message === null ? 0 : this.deps.now();
  }

  private maybeExpireNotice(): void {
    if (this.notice === null || this.noticeAtMs === 0) return;
    if (this.deps.now() - this.noticeAtMs < NOTICE_TTL_MS) return;
    this.setNotice(null);
    this.publish();
  }

  private sync(): Promise<void> {
    return this.reconcileTask.request();
  }

  private async reconcile(): Promise<void> {
    if (this.isDisposed() || !this.room) return;
    this.syncing = true;
    this.publish();
    try {
      const snapshot = await this.deps.transport.snapshot(this.roomId);
      if (this.isDisposed()) return;
      const fresh = await this.deps.transport.refetch(this.roomId, this.lastOrdinal);
      if (this.isDisposed()) return;
      const merged = mergeFixedFiveCommands(this.commands, fresh);
      if (merged.length > snapshot.commandCount) {
        void this.sync();
        return;
      }
      this.applyRoomSnapshot(snapshot);
      if (fresh.length > 0) {
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
        this.refreshDerived();
      } else {
        this.recomputePhase();
      }
      const room = this.room;
      await this.deps.repository.saveActiveSnapshot(room, this.lastOrdinal + 1).catch(() => {});
    } catch (e) {
      if (!this.isDisposed()) this.error = this.deps.friendlyError(e);
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
    if (this.submissionsInFlight > 0) {
      this.autoFlowsDeferred = true;
      return;
    }
    this.autoFlowsDeferred = false;
    this.maybeStartDuelPipeline();
    this.maybeFinalizeDuelSeries();
    this.maybeProposeOrConfirmGame();
    this.maybeReadyNextGame();
    this.competition.maybeStart();
    this.competition.maybeRebuildStats();
    this.verification.tick();
  }

  private isDuelBroadcast(): boolean {
    const room = this.room;
    return (
      room !== null &&
      room.settings.mode === 'duel' &&
      room.settings.versions.multiplayerVersion === FIXED_FIVE_MULTIPLAYER_VERSION
    );
  }

  private isShared82Broadcast(): boolean {
    const room = this.room;
    return (
      room !== null &&
      room.settings.mode !== 'duel' &&
      room.settings.versions.multiplayerVersion === FIXED_FIVE_MULTIPLAYER_VERSION
    );
  }

  private isGamecastBroadcast(): boolean {
    return this.isDuelBroadcast() || this.isShared82Broadcast();
  }

  private shared82H2HGameNumbers(): number[] {
    if (!this.assets) return [];
    const weakest = findWeakestOpponent(this.assets.bracket);
    return h2hGameNumbersFor(this.assets.bracket, weakest.opponentId);
  }

  private tickShared82Reveal(): void {
    if (this.isDisposed() || !this.isShared82Broadcast()) return;
    const target = this.competition.advanceSeasonReveal();
    this.maybeProposeOrConfirmGame();
    if (target === null) return;
    if (this.room?.broadcast?.gameNumber === target) {
      this.maybeStartShared82H2HGame(target);
      return;
    }
    if (this.room?.broadcast) return;
    if (this.shared82H2HOutputs[target]) void this.startBroadcast();
    else this.maybeStartShared82H2HGame(target);
  }

  private maybeStartShared82H2HGame(gameNumber: number): void {
    if (
      this.isDisposed() ||
      !this.isShared82Broadcast() ||
      this.shared82H2HOutputs[gameNumber] ||
      this.shared82H2HSimulatingGame !== null
    ) {
      return;
    }
    const room = this.room;
    const assets = this.assets;
    const replay = this.replay;
    if (!room?.rootSeed || !assets || !replay) return;
    const rootSeed: Seed = room.rootSeed;
    this.shared82H2HSimulatingGame = gameNumber;
    this.shared82H2HSimError = null;
    this.publish();
    void (async () => {
      try {
        const p1Refs = refsForParticipant(replay, assets, 'p1');
        const p2Refs = refsForParticipant(replay, assets, 'p2');
        if (p1Refs.length !== 5 || p2Refs.length !== 5) {
          throw new Error('both lineups must be complete before simulating');
        }
        const p1Team: FixedFiveWorkerTeam = await this.deps.buildTeam(
          assets.manifest,
          'p1',
          'Player 1',
          p1Refs,
        );
        if (this.isDisposed()) return;
        const p2Team: FixedFiveWorkerTeam = await this.deps.buildTeam(
          assets.manifest,
          'p2',
          'Player 2',
          p2Refs,
        );
        if (this.isDisposed()) return;
        const active = this.deps.createRunner((event) => {
          if (this.isDisposed() || this.shared82H2HSimulatingGame !== gameNumber) return;
          if (event.kind === 'shared82-h2h-game') {
            this.shared82H2HOutputs = {
              ...this.shared82H2HOutputs,
              [gameNumber]: event.output,
            };
            this.shared82H2HSimError = null;
            this.shared82H2HRunner?.dispose();
            this.shared82H2HRunner = null;
            this.shared82H2HSimulatingGame = null;
            this.publish();
            this.tickShared82Reveal();
          } else if (event.kind === 'error') {
            this.shared82H2HSimError = event.message;
            this.shared82H2HRunner?.dispose();
            this.shared82H2HRunner = null;
            this.shared82H2HSimulatingGame = null;
            this.publish();
          }
        });
        this.shared82H2HRunner = active;
        active.runShared82H2HGame({
          roomId: this.roomId,
          gameNumber,
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: room.settings.versions.dataVersion,
          engineVersion: room.settings.versions.engineVersion,
        });
      } catch (error) {
        if (this.isDisposed()) return;
        this.shared82H2HSimError = error instanceof Error ? error.message : String(error);
        this.shared82H2HSimulatingGame = null;
        this.shared82H2HRunner?.dispose();
        this.shared82H2HRunner = null;
        this.publish();
      }
    })();
  }

  private duelCurrentGameNumber(): number | null {
    return this.room?.series?.currentGameNumber ?? null;
  }

  private duelBroadcastOf(): FixedFiveBroadcast | null {
    return this.room?.broadcast ?? null;
  }

  private duelMemberReady(participantId: FixedFiveParticipantId): boolean {
    return this.seriesFlow.memberReady(
      this.room?.members ?? [],
      participantId,
      this.duelCurrentGameNumber(),
    );
  }

  private duelLocalReady(): boolean {
    return this.duelMemberReady(this.selfId);
  }
  private duelOpponentReady(): boolean {
    return this.duelMemberReady(otherParticipant(this.selfId));
  }

  private duelReadyCountdownMs(): number | null {
    if (!this.isDuelBroadcast()) return null;
    return this.seriesFlow.readyCountdown(
      this.duelOpponentReady(),
      FIXED_FIVE_DUEL_GAME_READY_TIMEOUT_MS,
    );
  }

  private duelAwaitingContinue(): boolean {
    const game = this.duelRecapGame;
    return game !== null && !this.duelContinueApproved(game);
  }

  private duelContinueApproved(gameNumber: number): boolean {
    return this.seriesFlow.playback.continueApproved(
      gameNumber,
      FIXED_FIVE_DUEL_GAME_RESULTS_HOLD_MS,
      this.deps.now(),
    );
  }

  private duelVerification(): DuelGameVerification {
    const gameNumber =
      this.room?.broadcast?.gameNumber ?? this.duelRecapGame ?? this.duelCurrentGameNumber();
    if (gameNumber === null) return 'pending';
    const confirms = this.facts.gameConfirms.filter((entry) => entry.gameNumber === gameNumber);
    if (confirms.some((entry) => !entry.verified)) return 'mismatch';
    const verified = confirms.filter((entry) => entry.verified);
    const actors = new Set(verified.map((entry) => entry.actor));
    if (
      verified.length >= 2 &&
      actors.size >= 2 &&
      new Set(verified.map((entry) => entry.digest)).size === 1
    ) {
      return 'verified';
    }
    return 'pending';
  }

  private duelPipelineTarget(): number | null {
    const room = this.room;
    const series = room?.series;
    if (!room || !series) return null;
    if (
      room.phase === 'preparing-game' ||
      room.phase === 'broadcasting' ||
      room.phase === 'game-results'
    ) {
      const current = series.currentGameNumber;
      if (current !== null && !this.duelOutputs[current]) return current;
      return null;
    }
    if (room.phase === 'awaiting-confirmation') {
      const missing = series.games.find((game) => !this.duelOutputs[game.gameNumber]);
      if (missing) return missing.gameNumber;
    }
    return null;
  }

  private refreshDuelEntries(): void {
    const entries = Object.values(this.duelOutputs)
      .sort((a, b) => a.gameNumber - b.gameNumber)
      .map((output) => ({ tag: 'duel' as const, game: output.result }));
    if (entries.length === 0) return;
    this.competition.setDuelEntries(entries);
  }

  private maybeStartDuelPipeline(): void {
    if (this.isDisposed() || !this.isDuelBroadcast()) return;
    if (this.duelSimulatingGame !== null) return;
    if (!this.room?.rootSeed || !this.assets || !this.replay) return;
    const target = this.duelPipelineTarget();
    if (target === null) return;
    this.duelSimulatingGame = target;
    this.duelSimError = null;
    this.publish();
    void (async () => {
      try {
        const output = await this.simulateDuelGame(target);
        if (this.isDisposed()) return;
        this.duelOutputs = { ...this.duelOutputs, [output.gameNumber]: output };
        this.refreshDuelEntries();
      } catch (error) {
        if (this.isDisposed()) return;
        this.duelSimError = error instanceof Error ? error.message : String(error);
      } finally {
        if (this.isDisposed()) return;
        this.duelSimulatingGame = null;
        this.publish();
        if (this.duelSimError === null) this.runAutoFlows();
      }
    })();
  }

  private async simulateDuelGame(gameNumber: number): Promise<FixedFiveDuelGameOutput> {
    const room = this.room;
    const assets = this.assets;
    const replay = this.replay;
    if (!room || !assets || !replay || !room.rootSeed) {
      throw new Error('Duel game inputs are incomplete.');
    }
    const p1Refs = refsForParticipant(replay, assets, 'p1');
    const p2Refs = refsForParticipant(replay, assets, 'p2');
    if (p1Refs.length !== 5 || p2Refs.length !== 5) {
      throw new Error('both lineups must be complete before simulating');
    }
    const p1Team = await this.deps.buildTeam(assets.manifest, 'p1', 'Player 1', p1Refs);
    if (this.isDisposed()) throw new Error('the room session was disposed');
    const p2Team = await this.deps.buildTeam(assets.manifest, 'p2', 'Player 2', p2Refs);
    if (this.isDisposed()) throw new Error('the room session was disposed');
    const versions = room.settings.versions;
    return await new Promise<FixedFiveDuelGameOutput>((resolve, reject) => {
      const active = this.deps.createRunner((event) => {
        if (this.isDisposed()) return;
        if (event.kind === 'duel-game') {
          active.dispose();
          if (this.duelRunner === active) this.duelRunner = null;
          resolve(event.output);
        } else if (event.kind === 'error') {
          active.dispose();
          if (this.duelRunner === active) this.duelRunner = null;
          reject(new Error(event.message));
        }
      });
      this.duelRunner = active;
      active.runDuelGame({
        roomId: this.roomId,
        gameNumber,
        rootSeed: room.rootSeed as Seed,
        p1Team,
        p2Team,
        profile: assets.profile,
        dataVersion: versions.dataVersion,
        engineVersion: versions.engineVersion,
      });
    });
  }

  private maybeFinalizeDuelSeries(): void {
    if (this.isDisposed() || !this.isDuelBroadcast()) return;
    const room = this.room;
    const series = room?.series;
    if (!room || !series || !series.champion) return;
    if (room.phase !== 'awaiting-confirmation') return;
    if (this.competition.getSnapshot().localResult) return;
    if (this.duelPipelineTarget() !== null) return;
    const played = series.games.map((game) => this.duelOutputs[game.gameNumber]);
    if (played.some((output) => output === undefined)) return;
    void this.finalizeDuelSeries(played as FixedFiveDuelGameOutput[]);
  }

  private async finalizeDuelSeries(outputs: FixedFiveDuelGameOutput[]): Promise<void> {
    const room = this.room;
    const assets = this.assets;
    const replay = this.replay;
    if (!room || !assets || !replay || !room.rootSeed) return;
    try {
      const rootSeed: Seed = room.rootSeed;
      const p1Refs = refsForParticipant(replay, assets, 'p1');
      const p2Refs = refsForParticipant(replay, assets, 'p2');
      const p1Team = await this.deps.buildTeam(assets.manifest, 'p1', 'Player 1', p1Refs);
      if (this.isDisposed()) return;
      const p2Team = await this.deps.buildTeam(assets.manifest, 'p2', 'Player 2', p2Refs);
      if (this.isDisposed()) return;
      const summary = summarizeWorkerEntries({
        mode: room.settings.mode,
        bracket: assets.bracket,
        rootSeed,
        p1TeamId: 'p1',
        p2TeamId: 'p2',
        p1PlayerIds: p1Team.players.map((player) => player.playerId),
        p2PlayerIds: p2Team.players.map((player) => player.playerId),
        entries: outputs.map((output) => ({ tag: 'duel' as const, game: output.result })),
      });
      const digest = computeCompetitionDigest({
        rootSeed,
        versions: room.settings.versions,
        p1: { refs: p1Refs, players: [...p1Team.players] },
        p2: { refs: p2Refs, players: [...p2Team.players] },
        commands: this.commands,
        result: summary.result,
      });
      const run = assembleCompetitionRun({
        roomId: this.roomId,
        sourceMode: room.settings.sourceMode,
        competition: 'duel',
        rootSeed,
        versions: room.settings.versions,
        commands: this.commands,
        p1: { refs: p1Refs, players: [...p1Team.players] },
        p2: { refs: p2Refs, players: [...p2Team.players] },
        result: summary.result,
        resultDigest: digest,
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      });
      await this.deps.repository.savePendingResult(this.roomId, run, this.selfId);
      if (this.isDisposed()) return;
      this.competition.acceptDuelResult({
        result: summary.result,
        digest,
        p1: { refs: p1Refs, players: [...p1Team.players] },
        p2: { refs: p2Refs, players: [...p2Team.players] },
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      });
      this.recomputePhase();
      this.publish();
      this.runAutoFlows();
    } catch (error) {
      if (this.isDisposed()) return;
      this.competition.setError(error instanceof Error ? error.message : String(error));
      this.publish();
    }
  }

  private duelWinnerOf(
    output: FixedFiveDuelGameOutput | FixedFiveShared82H2HGameOutput,
  ): FixedFiveParticipantId {
    return output.result.winner === 'home'
      ? output.homeParticipantId
      : otherParticipant(output.homeParticipantId);
  }

  private maybeProposeOrConfirmGame(): void {
    if (this.isDisposed() || !this.isGamecastBroadcast() || this.busyAction !== null) return;
    const room = this.room;
    const gameNumber = this.isDuelBroadcast()
      ? (room?.series?.currentGameNumber ?? null)
      : (room?.broadcast?.gameNumber ?? null);
    if (!room || gameNumber === null) return;
    if (room.phase !== 'broadcasting' && room.phase !== 'game-results') return;
    const output = this.isDuelBroadcast()
      ? this.duelOutputs[gameNumber]
      : this.shared82H2HOutputs[gameNumber];
    if (!output || this.broadcastProgress < 1) return;
    this.seriesFlow.holdMs = this.isDuelBroadcast() ? FIXED_FIVE_DUEL_GAME_RESULTS_HOLD_MS : 0;
    this.seriesFlow.coordinate({
      gameNumber,
      localDigest: output.resultDigest,
      ownProposal: this.facts.gameProposals.find(
        (p) => p.actor === this.selfId && p.gameNumber === gameNumber,
      )?.digest,
      peerProposal: this.facts.gameProposals.find(
        (p) => p.actor !== this.selfId && p.gameNumber === gameNumber,
      )?.digest,
      current: () => !this.isDisposed(),
      propose: () =>
        this.sendCommand({
          kind: 'propose-game-result',
          gameNumber,
          winner: this.duelWinnerOf(output),
          resultDigest: output.resultDigest,
          tapeDigest: output.tapeDigest,
          inputDigest: output.inputDigest,
        }),
      confirm: (verified) =>
        this.sendCommand({
          kind: 'confirm-game-result',
          gameNumber,
          resultDigest: output.resultDigest,
          verified,
        }),
      mismatch: () => {
        void this.deps.transport.fail(this.roomId).catch(() => {});
      },
    });
  }

  private tickDuel(): void {
    if (this.isDisposed() || !this.isDuelBroadcast()) return;
    this.maybeProposeOrConfirmGame();
    this.maybeReadyNextGame();
    if (this.room?.phase !== 'preparing-game') return;
    if (
      this.seriesFlow.shouldAutoStart(
        this.duelLocalReady(),
        this.duelOpponentReady(),
        FIXED_FIVE_DUEL_GAME_READY_TIMEOUT_MS,
      )
    ) {
      void this.startBroadcast(!(this.duelLocalReady() && this.duelOpponentReady()));
    }
  }

  private applyRoomSnapshot(snapshot: FixedFiveRoomSnapshot): void {
    if (this.isDisposed()) return;
    const previous = this.room;
    if (previous && snapshot.revision < previous.revision) return;
    this.room = snapshot;
    if (this.seriesFlow.observe(snapshot.phase, snapshot.broadcast?.gameNumber ?? null)) {
      this.broadcastProgress = 0;
      this.duelRecapGame = null;
      const game = snapshot.broadcast?.gameNumber;
      if (game !== undefined) {
        this.seriesFlow.proposals.delete(game);
        this.seriesFlow.confirmations.delete(game);
      }
    }
    if (snapshot.phase === 'preparing-game' && this.duelRecapGame !== null) {
      this.duelRecapGame = null;
    }
    if (
      this.isDuelBroadcast() &&
      snapshot.phase === 'game-results' &&
      snapshot.broadcast !== null &&
      previous?.broadcast?.gameNumber !== snapshot.broadcast.gameNumber
    ) {
      this.seriesFlow.playback.resumeReview(this.deps.now());
      if (this.duelRecapGame === null) {
        this.duelRecapGame = snapshot.broadcast.gameNumber;
        this.broadcastProgress = 1;
      }
    }
    if (
      this.isShared82Broadcast() &&
      snapshot.seasonBroadcast?.lastCompletedGameNumber !== null &&
      snapshot.seasonBroadcast?.lastCompletedGameNumber !== undefined &&
      previous?.seasonBroadcast?.lastCompletedGameNumber !==
        snapshot.seasonBroadcast.lastCompletedGameNumber
    ) {
      this.competition.revealSeasonBroadcast(snapshot.seasonBroadcast.lastCompletedGameNumber);
    }
    this.completeElapsedBroadcast();
  }

  private maybeReadyNextGame(): void {
    const target = this.pendingReadyGame;
    if (target === null || this.isDisposed() || this.submissionsInFlight > 0) return;
    const room = this.room;
    if (
      !room ||
      room.phase === 'awaiting-confirmation' ||
      room.phase === 'completed' ||
      room.phase === 'integrity-failed' ||
      room.phase === 'expired'
    ) {
      this.pendingReadyGame = null;
      return;
    }
    if (room.phase !== 'preparing-game') return;
    const current = this.duelCurrentGameNumber();
    if (current !== target) {
      if (current === null || current > target) this.pendingReadyGame = null;
      return;
    }
    if (this.duelLocalReady()) {
      this.pendingReadyGame = null;
      return;
    }
    if (this.deps.now() < this.pendingReadyRetryAtMs) return;
    this.pendingReadyRetryAtMs = this.deps.now() + DUEL_AUTO_START_RETRY_MS;
    void this.readyForNextGame();
  }

  private completeElapsedBroadcast(): void {
    const room = this.room;
    const broadcast = room?.broadcast;
    if (!broadcast || !this.isGamecastBroadcast()) return;
    if (room.phase !== 'broadcasting' && room.phase !== 'game-results') return;
    if (this.duelRecapGame === broadcast.gameNumber) return;
    const startedAt = Date.parse(broadcast.startedAtIso);
    if (!Number.isFinite(startedAt)) return;
    const now = this.deps.now();
    if (now < startedAt + broadcast.durationMs) return;
    this.seriesFlow.playback.begin(now, startedAt, broadcast.durationMs);
    this.seriesFlow.playback.advance(0, broadcast.durationMs, now);
    this.broadcastProgress = 1;
    this.duelRecapGame = broadcast.gameNumber;
    this.maybeProposeOrConfirmGame();
  }

  private async sendCommand(
    payload: FixedFiveCommandPayload,
    options?: {
      actor?: FixedFiveParticipantId;
      commandId?: string;
      retry?: boolean;
      quiet?: boolean;
    },
  ): Promise<boolean> {
    this.error = null;
    const commandId = this.newCommandId(options?.commandId);
    this.submissionsInFlight += 1;
    try {
      return await this.dispatchCommand(payload, commandId, options);
    } finally {
      this.submissionsInFlight -= 1;
      this.flushDeferredAutoFlows();
    }
  }

  private flushDeferredAutoFlows(): void {
    if (this.submissionsInFlight > 0 || !this.autoFlowsDeferred) return;
    this.autoFlowsDeferred = false;
    this.runAutoFlows();
  }

  private async resyncForRetry(): Promise<void> {
    try {
      const fresh = await this.deps.transport.snapshot(this.roomId);
      if (this.isDisposed()) return;
      this.applyRoomSnapshot(fresh);
    } catch {}
    await this.sync();
  }

  private async dispatchCommand(
    payload: FixedFiveCommandPayload,
    commandId: CommandId,
    options?: {
      actor?: FixedFiveParticipantId;
      commandId?: string;
      retry?: boolean;
      quiet?: boolean;
    },
  ): Promise<boolean> {
    try {
      const result = await submitFixedFiveCommand({
        submitCommand: (command) => this.deps.transport.submitCommand(command),
        roomId: this.brandedRoomId(),
        commandId,
        actorParticipantId: options?.actor ?? this.selfId,
        payload,
        expectedRevision: this.room?.revision,
        resync: () => this.resyncForRetry().then(() => this.room?.revision),
        retry: options?.retry,
        retryAfterResync: () => this.verification.canRetry(payload),
      });
      if (this.isDisposed()) return false;
      const receipt = result.receipt;
      if (this.room && receipt.revision > this.room.revision) {
        this.room = { ...this.room, revision: receipt.revision };
      }
      if (result.retried && receipt.accepted) {
        this.setNotice('Room changed while sending — resynced and recovered.');
      }
      if (!receipt.accepted && receipt.rejectionCode === 'stale-revision') {
        if (!options?.quiet) {
          this.setNotice('Stale command — resyncing before a retry.');
          this.error = result.retried
            ? 'The room changed again during the retry. The command was not applied.'
            : 'The room changed and invalidated this command. It was not applied.';
          this.publish();
        }
        return false;
      }
      if (!receipt.accepted) {
        if (!options?.quiet) {
          this.error = `Command rejected: ${receipt.rejectionCode ?? 'unknown'}`;
          this.publish();
        }
        return false;
      }
      this.deps.saveActivityNow(this.roomId);
      await this.sync();
      return true;
    } catch (e) {
      if (!this.isDisposed()) {
        if (!options?.quiet) this.error = this.deps.friendlyError(e);
        this.publish();
      }
      return false;
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
      await this.sync();
    } catch (e) {
      this.submittedTimeouts.delete(key);
      if (isMissingFunctionError(e)) {
        this.verification.markReceiptsUnsupported();
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
        this.error = this.deps.friendlyError(e);
        this.publish();
      }
    }
  }

  private newCommandId(provided?: string): CommandId {
    return provided
      ? commandIdSchema.parse(provided)
      : commandIdSchema.parse(this.deps.newCommandId());
  }

  private brandedRoomId(): Id {
    return idSchema.parse(this.roomId);
  }
}
