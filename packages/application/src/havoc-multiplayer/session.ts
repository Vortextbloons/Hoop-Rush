import {
  HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_GAME_RESULTS_HOLD_MS,
  HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  canonicalJson,
  commandIdSchema,
  contentHashSchema,
  defaultHavocMultiplayerVersionLocks,
  havocMultiplayerGameSeed,
  havocMultiplayerVerificationReceiptSchema,
  idSchema,
  seasonDigestHex,
  type EraSimulationProfile,
  type HavocBattleInput,
  type HavocBattleResult,
  type HavocCatalog,
  type HavocDraftCard,
  type HavocDraftOffer,
  type HavocMultiplayerBroadcast,
  type HavocMultiplayerCommand,
  type HavocMultiplayerDeadline,
  type HavocMultiplayerDraftState,
  type HavocMultiplayerMemberSnapshot,
  type HavocMultiplayerParticipantId,
  type HavocMultiplayerPhase,
  type HavocMultiplayerRoomCode,
  type HavocMultiplayerRoomMembership,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerSeriesGame,
  type HavocMultiplayerSeriesSnapshot,
  type HavocMultiplayerTransientEvent,
  type HavocMultiplayerTransport,
  type HavocMultiplayerVariant,
  type HavocMultiplayerVerificationReceipt,
  type HavocMultiplayerVersionLocks,
  type HavocMultiplayerWorkerGameOutput,
  type HavocVersionSet,
  type HoopRushManifest,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_DEFINITIONS,
  auditHavocBattleGame,
  buildHavocMultiplayerGameInput,
  buildHavocMultiplayerTeam,
  createHavocCommandEnvironment,
  createRng,
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
  havocMultiplayerSeriesMvp,
  havocMultiplayerTimeoutPick,
  replayHavocMultiplayerDraft,
  type EngineContext,
  type HavocCommandEnvironment,
} from '@hoop-rush/engine';
import type {
  HavocMultiplayerActiveState,
  HavocMultiplayerCommandEntry,
  HavocMultiplayerCompletionRecap,
  HavocMultiplayerGameOutput,
  HavocMultiplayerSeriesMvp,
  StoredHavocMultiplayerActive,
  StoredHavocMultiplayerCompleted,
  StoredHavocMultiplayerResultRow,
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
const GAME_READY_WINDOW_MS = HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS;
const GAME_RESULTS_HOLD_MS = HAVOC_MULTIPLAYER_GAME_RESULTS_HOLD_MS;

export type ReactionKey = 'hype' | 'clap' | 'cold' | 'wow';

export interface HavocMultiplayerSessionAssets {
  catalog: HavocCatalog;
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  versionSet: HavocVersionSet;
  context: EngineContext;
}

export interface HavocMultiplayerRunnerPort {
  runGame(request: {
    roomId: string;
    gameNumber: number;
    input: HavocBattleInput;
  }): Promise<HavocMultiplayerWorkerGameOutput>;
  dispose(): void;
}

export interface HavocMultiplayerGameVerification {
  gameNumber: number;
  localResultDigest: string;
  peerResultDigest: string | null;
  status: 'verified' | 'mismatch';
}

export interface HavocMultiplayerSeriesFacts {
  series: HavocMultiplayerSeriesSnapshot | null;
  outputs: Record<number, HavocMultiplayerGameOutput>;
  completedRecap: StoredHavocMultiplayerCompleted | null;
}

export interface HavocMultiplayerSessionView {
  connection: RoomConnection;
  assets: HavocMultiplayerSessionAssets | null;
  snapshot: HavocMultiplayerRoomSnapshot | null;
  phase: HavocMultiplayerPhase;
  members: readonly HavocMultiplayerMemberSnapshot[];
  localRole: HavocMultiplayerParticipantId | null;
  draft: HavocMultiplayerDraftState | null;
  offer: HavocDraftOffer | null;
  series: HavocMultiplayerSeriesSnapshot | null;
  broadcast: HavocMultiplayerBroadcast | null;
  deadline: HavocMultiplayerDeadline | null;
  currentGameNumber: number | null;
  outputs: Record<number, HavocMultiplayerGameOutput>;
  verification: HavocMultiplayerGameVerification[];
  commands: HavocMultiplayerCommand[];
  completedRecap: StoredHavocMultiplayerCompleted | null;
  mvp: HavocMultiplayerSeriesMvp | null;
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

export interface HavocMultiplayerSessionRepository {
  loadActive(roomId: string): Promise<StoredHavocMultiplayerActive | null>;
  loadCompleted(roomId: string): Promise<StoredHavocMultiplayerCompleted | null>;
  loadResults(roomId: string): Promise<StoredHavocMultiplayerResultRow[]>;
  appendCommands(roomId: string, entries: readonly HavocMultiplayerCommandEntry[]): Promise<void>;
  saveResult(output: HavocMultiplayerGameOutput): Promise<void>;
  saveVerification(
    roomId: string,
    entries: readonly HavocMultiplayerVerificationReceipt[],
  ): Promise<void>;
  saveActive(state: HavocMultiplayerActiveState): Promise<void>;
  complete(recap: HavocMultiplayerCompletionRecap): Promise<void>;
}

export interface HavocMultiplayerSessionDeps {
  transport: HavocMultiplayerTransport;
  repository: HavocMultiplayerSessionRepository;
  runner: HavocMultiplayerRunnerPort;
  loadAssets: () => Promise<HavocMultiplayerSessionAssets>;
  now: () => number;
  newCommandId: () => string;
  friendlyError: (error: unknown) => string;
  loadMembership: (roomId: string) => HavocMultiplayerRoomMembership | null;
  saveMembership: (membership: HavocMultiplayerRoomMembership) => void;
  scheduleTick?: TickScheduler;
}

function otherParticipant(
  participantId: HavocMultiplayerParticipantId,
): HavocMultiplayerParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

function havocMultiplayerReceiptDigest(
  receipt: Omit<HavocMultiplayerVerificationReceipt, 'receiptDigest'>,
): string {
  const material = canonicalJson(receipt);
  return contentHashSchema.parse(
    `${seasonDigestHex(`havoc-multiplayer-receipt-v1:${material}`)}${seasonDigestHex(`havoc-multiplayer-receipt-v2:${material}`)}`,
  );
}

function verificationFromReceipts(
  receipts: readonly HavocMultiplayerVerificationReceipt[],
): HavocMultiplayerGameVerification[] {
  return receipts
    .map((receipt) => {
      const parsed = Number.parseInt(receipt.receiptId.replace(/^hvr-/, ''), 10);
      const gameNumber = Number.isInteger(parsed) ? parsed : 0;
      return {
        gameNumber,
        localResultDigest: receipt.resultDigest,
        peerResultDigest: receipt.resultDigest,
        status: 'verified' as const,
      };
    })
    .sort((left, right) => left.gameNumber - right.gameNumber);
}

function storedResultToOutput(row: StoredHavocMultiplayerResultRow): HavocMultiplayerGameOutput {
  return {
    roomId: row.roomId,
    gameNumber: row.gameNumber,
    winner: row.winner,
    result: row.result,
    tape: row.tape,
    inputDigest: row.inputDigest,
    resultDigest: row.resultDigest,
    tapeDigest: row.tapeDigest,
  };
}

/**
 * The replayed draft is the deterministic engine state; the room snapshot is
 * authoritative whenever the transport generated its own offers. They only
 * agree when both sides derive the same draft from the same accepted log.
 */
function havocMultiplayerDraftsAgree(
  replayed: HavocMultiplayerDraftState,
  serverDraft: HavocMultiplayerDraftState,
): boolean {
  return (
    replayed.turnOrdinal === serverDraft.turnOrdinal &&
    replayed.status === serverDraft.status &&
    replayed.firstPicker === serverDraft.firstPicker &&
    (replayed.offer?.offerId ?? null) === (serverDraft.offer?.offerId ?? null) &&
    replayed.picks.length === serverDraft.picks.length
  );
}

export function havocMultiplayerSeriesMvpOf(
  facts: HavocMultiplayerSeriesFacts,
): HavocMultiplayerSeriesMvp | null {
  const series = facts.series;
  if (!series?.champion) return null;
  const results: HavocBattleResult[] = [];
  for (const game of series.games) {
    if (game.status !== 'verified') continue;
    const output = facts.outputs[game.gameNumber];
    if (!output) return facts.completedRecap?.mvp ?? null;
    results.push(output.result);
  }
  if (results.length === 0) return facts.completedRecap?.mvp ?? null;
  try {
    return havocMultiplayerSeriesMvp(series, results);
  } catch {
    return facts.completedRecap?.mvp ?? null;
  }
}

export class HavocMultiplayerSession {
  private readonly deps: HavocMultiplayerSessionDeps;
  private readonly events = new SessionEvents<HavocMultiplayerTransientEvent>();
  private readonly lifecycle = new RoomLifecycle(() => {
    this.publish();
  });
  private attachment: RoomAttachment | null = null;
  private readonly seriesFlow: SeriesCoordinator;
  private readonly commandRecovery = new CommandRecovery();
  private readonly syncTask: CoalescedTask;
  private readonly tickLoop: TickLoop;
  private assets: HavocMultiplayerSessionAssets | null = null;
  private environment: HavocCommandEnvironment | null = null;
  private snapshot: HavocMultiplayerRoomSnapshot | null = null;
  private participantId: HavocMultiplayerParticipantId | null = null;
  private draft: HavocMultiplayerDraftState | null = null;
  private outputs: Record<number, HavocMultiplayerGameOutput> = {};
  private verification: HavocMultiplayerGameVerification[] = [];
  private completedRecap: StoredHavocMultiplayerCompleted | null = null;
  private commands: HavocMultiplayerCommand[] = [];
  private challenge: string | null = null;
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

  constructor(deps: HavocMultiplayerSessionDeps) {
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

  getSnapshot(): HavocMultiplayerSessionView {
    return {
      connection: this.lifecycle.getConnection(),
      assets: this.assets,
      snapshot: this.snapshot,
      phase: this.phase(),
      members: this.snapshot?.members ?? [],
      localRole: this.participantId,
      draft: this.draft,
      offer: this.draft?.offer ?? null,
      series: this.snapshot?.series ?? null,
      broadcast: this.snapshot?.broadcast ?? null,
      deadline: this.snapshot?.deadline ?? null,
      currentGameNumber: this.currentGameNumber(),
      outputs: this.outputs,
      verification: this.verification,
      commands: this.commands,
      completedRecap: this.completedRecap,
      mvp: havocMultiplayerSeriesMvpOf({
        series: this.snapshot?.series ?? null,
        outputs: this.outputs,
        completedRecap: this.completedRecap,
      }),
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

  subscribeTransient(listener: (event: HavocMultiplayerTransientEvent) => void): () => void {
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
    this.challenge = null;
    this.roomId = idSchema.parse(roomId);
    try {
      await this.loadAssets();
      if (!attachment.current()) return;
      const membership = this.deps.loadMembership(roomId);
      if (!membership) {
        this.error = 'You are not a member of this room. Join from the Havoc lobby.';
        this.publish();
        return;
      }
      const resumed = await this.deps.transport.resume(roomId);
      if (!attachment.current()) return;
      this.participantId = resumed.membership.participantId;
      this.deps.saveMembership(resumed.membership);
      this.applySnapshot(resumed.snapshot);
      if (!this.assertRoomVersions()) {
        this.publish();
        return;
      }
      const restored = await this.deps.repository.loadActive(roomId);
      if (!attachment.current()) return;
      if (restored) {
        this.verification = verificationFromReceipts(restored.verification);
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
        const outputs: Record<number, HavocMultiplayerGameOutput> = {};
        for (const row of rows) outputs[row.gameNumber] = storedResultToOutput(row);
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
    variant: HavocMultiplayerVariant = 'standard',
  ): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      await this.loadAssets();
      const created = await this.deps.transport.create({
        variant,
        versions: this.versionLocks(),
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

  async roomVersions(): Promise<HavocMultiplayerVersionLocks> {
    await this.loadAssets();
    return this.versionLocks();
  }

  async joinRoom(code: string): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      await this.loadAssets();
      const joined = await this.deps.transport.join(code);
      this.deps.saveMembership(joined.membership);
      return { roomId: joined.snapshot.roomId, code: joined.snapshot.code };
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      return null;
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  async setReady(): Promise<void> {
    await this.submit({ kind: 'ready' });
  }

  async startDraft(): Promise<void> {
    await this.submit({ kind: 'start' });
  }

  async pickCard(card: HavocDraftCard): Promise<boolean> {
    const draft = this.draft;
    if (!draft || draft.status !== 'drafting' || draft.offer === null) return false;
    if (!this.activeTurn()) {
      this.notice = 'It is not your turn.';
      this.publish();
      return false;
    }
    if (card.offerId !== draft.offer.offerId) {
      this.notice = 'That card is not part of the current offer.';
      this.publish();
      return false;
    }
    const seasonKey = card.source.seasonKey;
    if (seasonKey === null) {
      this.notice = 'That card cannot be picked right now.';
      this.publish();
      return false;
    }
    return this.submit({
      kind: 'pick',
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
      cardId: card.cardId,
      claimKey: { playerId: card.source.playerId, seasonKey },
    });
  }

  async rerollOffer(): Promise<boolean> {
    const draft = this.draft;
    if (!draft || draft.status !== 'drafting' || draft.offer === null) return false;
    if (!this.activeTurn()) {
      this.notice = 'It is not your turn.';
      this.publish();
      return false;
    }
    return this.submit({
      kind: 'reroll',
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
    });
  }

  async readyForNextGame(): Promise<void> {
    if (this.phase() !== 'lineup-showdown' && this.phase() !== 'preparing-game') return;
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    await this.submit({ kind: 'ready-next-game', gameNumber });
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
      const next = await this.deps.transport.removeGuest(this.roomId, 'p2');
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

  async consider(card: HavocDraftCard | null): Promise<void> {
    const draft = this.draft;
    if (!this.roomId || !this.participantId || !draft || !card) return;
    if (draft.status !== 'drafting' || draft.offer === null) return;
    await this.deps.transport.publishTransient(this.roomId, {
      kind: 'consideration',
      participantId: this.participantId,
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
      cardId: card.cardId,
      sentAtMs: this.deps.now(),
    });
  }

  async react(reaction: ReactionKey): Promise<void> {
    const draft = this.draft;
    if (!this.roomId || !this.participantId || !draft) return;
    if (draft.status !== 'drafting') return;
    await this.deps.transport.publishTransient(this.roomId, {
      kind: 'reaction',
      participantId: this.participantId,
      turnOrdinal: draft.turnOrdinal,
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
      Date.parse(broadcast.startedAt),
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

  seriesGameEntries(): HavocMultiplayerSeriesGame[] {
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

  private emitTransient(event: HavocMultiplayerTransientEvent): void {
    this.events.emitTransient(event);
  }

  private phase(): HavocMultiplayerPhase {
    return this.snapshot?.phase ?? 'lobby';
  }

  private currentGameNumber(): number | null {
    const series = this.snapshot?.series;
    if (!series) return null;
    return series.games.find((game) => game.status !== 'verified')?.gameNumber ?? null;
  }

  private currentOutput(): HavocMultiplayerGameOutput | null {
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return null;
    return this.outputs[gameNumber] ?? null;
  }

  private broadcastOf(): HavocMultiplayerBroadcast | null {
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
    return Math.max(0, Date.parse(deadline.at) - this.now);
  }

  private activeTurn(): boolean {
    const draft = this.draft;
    if (this.phase() !== 'drafting' || !draft || draft.status !== 'drafting') return false;
    return draft.activeParticipantId === this.participantId && !this.busy;
  }

  private async loadAssets(): Promise<void> {
    this.assets ??= await this.deps.loadAssets();
    this.environment ??= createHavocCommandEnvironment(this.assets.catalog, {
      rngFactory: createRng,
      definitions: HAVOC_MUTATION_DEFINITIONS,
    });
    this.publish();
  }

  private versionLocks(): HavocMultiplayerVersionLocks {
    const assets = this.assets;
    if (!assets) throw new Error('Havoc assets are unavailable.');
    return defaultHavocMultiplayerVersionLocks({
      engineVersion: assets.versionSet.engineVersion,
      rulesVersion: assets.versionSet.rulesVersion,
      mutationCatalogVersion: assets.versionSet.mutationCatalogVersion,
      profileVersion: assets.versionSet.profileVersion,
      dataVersion: assets.versionSet.dataVersion,
      catalogVersion: assets.versionSet.catalogVersion,
      catalogHash: assets.versionSet.catalogHash,
      profileHash: assets.versionSet.profileHash,
    });
  }

  private assertRoomVersions(): boolean {
    const assets = this.assets;
    const snapshot = this.snapshot;
    if (!assets || !snapshot) return true;
    const locks = snapshot.settings.versions;
    const versions = assets.versionSet;
    const rulesSupported =
      locks.rulesVersion === versions.rulesVersion ||
      locks.rulesVersion === HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION;
    const variantSupported =
      snapshot.settings.variant !== 'curated' || locks.rulesVersion === versions.rulesVersion;
    const matches =
      rulesSupported &&
      variantSupported &&
      locks.engineVersion === versions.engineVersion &&
      locks.mutationCatalogVersion === versions.mutationCatalogVersion &&
      locks.profileVersion === versions.profileVersion &&
      locks.dataVersion === versions.dataVersion &&
      locks.catalogVersion === versions.catalogVersion &&
      locks.catalogHash === versions.catalogHash &&
      locks.profileHash === versions.profileHash;
    if (!matches) {
      this.error = 'This room was created with different engine or data versions.';
    }
    return matches;
  }

  private applySnapshot(snapshot: HavocMultiplayerRoomSnapshot, publish = true): void {
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
    if (snapshot.phase === 'integrity-failed') {
      this.integrityFailed = true;
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
      deadline.participantId === this.participantId &&
      this.now >= Date.parse(deadline.at) &&
      this.now >= this.deadlineRetryAtMs &&
      this.resolvedCursor !== deadline.cursor
    ) {
      void this.resolveDeadline(deadline.cursor);
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

  private async resolveDeadline(cursor: string): Promise<void> {
    if (this.deadlineResolving || !this.roomId || !this.participantId) return;
    const draft = this.draft;
    const assets = this.assets;
    const environment = this.environment;
    if (!draft || !assets || !environment) return;
    if (draft.status !== 'drafting' || draft.offer === null) return;
    const deadline = this.snapshot?.deadline;
    if (!deadline || deadline.cursor !== cursor) return;
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const roomId = attachment.roomId;
    this.deadlineResolving = true;
    try {
      const card = havocMultiplayerTimeoutPick(draft, assets.catalog, environment);
      await this.deps.transport.commitFallback(roomId, cursor, {
        kind: 'timeout-pick',
        turnOrdinal: draft.turnOrdinal,
        offerId: draft.offer.offerId,
        cardId: card.cardId,
      });
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

  private async submit(payload: HavocMultiplayerCommand['payload']): Promise<boolean> {
    const attachment = this.attachment;
    if (!attachment?.current() || !this.roomId || !this.participantId) return false;
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      const report = await executeMultiplayerCommand(
        {
          schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
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
        throw new Error(`Havoc command rejected: ${receipt?.rejectionCode ?? 'unknown'}`);
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
      const latest = await this.deps.transport.resume(roomId);
      if (isDisposed()) return;
      if (latest.snapshot.revision !== resumed.snapshot.revision) {
        void this.syncFromServer();
        return;
      }
      if (this.snapshot && resumed.snapshot.revision < this.snapshot.revision) {
        void this.syncFromServer();
        return;
      }
      this.commands = commands;
      this.applySnapshot(resumed.snapshot, false);
      if (!this.assertRoomVersions()) return;
      if (!this.completedPersisted) this.rebuildDraft();
      if (this.shouldCreateRematch()) {
        this.rematchRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
        await this.deps.transport.rematch(roomId);
        const rematched = await this.deps.transport.resume(roomId);
        if (isDisposed()) return;
        this.applySnapshot(rematched.snapshot);
      }
      if (!this.completedPersisted) {
        await this.deps.repository.appendCommands(
          roomId,
          commands.map((command, ordinal) => ({ ordinal, command })),
        );
        if (isDisposed()) return;
        await this.ensureGamePipeline();
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
    const environment = this.environment;
    if (!snapshot || !assets || !environment) return;
    const serverDraft = snapshot.draft;
    if (!serverDraft) {
      this.draft = null;
      this.publish();
      return;
    }
    let replayed: HavocMultiplayerDraftState | null = null;
    try {
      replayed = replayHavocMultiplayerDraft({
        rootSeed: serverDraft.rootSeed,
        catalog: assets.catalog,
        environment,
        commands: this.commands.map((command) => command.payload),
        settings: {
          variant: snapshot.settings.variant,
          rulesVersion: snapshot.settings.versions.rulesVersion,
        },
      });
    } catch {
      replayed = null;
    }
    this.draft =
      replayed !== null && havocMultiplayerDraftsAgree(replayed, serverDraft)
        ? replayed
        : serverDraft;
    this.publish();
  }

  private async ensureGamePipeline(): Promise<void> {
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const snapshot = this.snapshot;
    const series = snapshot?.series;
    if (!snapshot || !series || !this.assets || !this.roomId) return;
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return;
    if (
      snapshot.phase !== 'preparing-game' &&
      snapshot.phase !== 'broadcasting' &&
      snapshot.phase !== 'game-results'
    ) {
      return;
    }
    if (this.outputs[gameNumber] || this.seriesFlow.jobs.has(gameNumber)) return;
    const game = series.games.find((entry) => entry.gameNumber === gameNumber);
    if (!game) return;
    try {
      await this.seriesFlow.runGame(
        gameNumber,
        attachment.current,
        () => this.simulateGame(game),
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
    game: HavocMultiplayerSeriesGame,
  ): Promise<HavocMultiplayerGameOutput> {
    const roomId = this.roomId;
    const snapshot = this.snapshot;
    const assets = this.assets;
    const draft = this.draft;
    if (!snapshot || !assets || !draft || draft.status !== 'complete' || !roomId) {
      throw new Error('Havoc series game inputs are incomplete.');
    }
    const rootSeed = draft.rootSeed;
    const displayNameOf = (participantId: HavocMultiplayerParticipantId): string =>
      snapshot.members.find((member) => member.participantId === participantId)?.displayName ??
      participantId;
    const homeTeam = buildHavocMultiplayerTeam({
      participantId: game.homeParticipantId,
      side: 'home',
      teamId: game.homeParticipantId,
      displayName: displayNameOf(game.homeParticipantId),
      picks: draft.picks,
      rootSeed,
    });
    const awayTeam = buildHavocMultiplayerTeam({
      participantId: game.awayParticipantId,
      side: 'away',
      teamId: game.awayParticipantId,
      displayName: displayNameOf(game.awayParticipantId),
      picks: draft.picks,
      rootSeed,
    });
    const input = buildHavocMultiplayerGameInput({
      rootSeed,
      gameNumber: game.gameNumber,
      homeTeam,
      awayTeam,
      profile: assets.profile,
      versionSet: assets.versionSet,
    });
    const output = await this.deps.runner.runGame({
      roomId,
      gameNumber: game.gameNumber,
      input,
    });
    this.assertRunnerOutput(input, output);
    return {
      roomId,
      gameNumber: game.gameNumber,
      winner: output.result.winner === 'home' ? game.homeParticipantId : game.awayParticipantId,
      result: output.result,
      tape: output.tape,
      inputDigest: output.inputDigest,
      resultDigest: output.resultDigest,
      tapeDigest: output.tapeDigest,
    };
  }

  private assertRunnerOutput(
    input: HavocBattleInput,
    output: HavocMultiplayerWorkerGameOutput,
  ): void {
    if (havocBattleGameInputDigest(input) !== output.inputDigest) {
      throw new Error('the simulated game input digest is inconsistent.');
    }
    if (havocBattleGameResultDigest(output.result) !== output.resultDigest) {
      throw new Error('the simulated game result digest is inconsistent.');
    }
    if (havocBattleGameTapeDigest(output.tape) !== output.tapeDigest) {
      throw new Error('the simulated game tape digest is inconsistent.');
    }
    const audit = auditHavocBattleGame(input, output.result, output.tape);
    if (!audit.ok) {
      const finding = audit.findings[0]?.message ?? 'unknown audit finding';
      throw new Error(`the simulated game failed the local audit: ${finding}`);
    }
  }

  private proposalOf(gameNumber: number): {
    byParticipant: Partial<Record<HavocMultiplayerParticipantId, string>>;
  } {
    const byParticipant: Partial<Record<HavocMultiplayerParticipantId, string>> = {};
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
    if (this.seriesFlow.confirmations.has(output.gameNumber)) return false;
    return !this.continueApproved(output.gameNumber);
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
          winner: output.winner,
          resultDigest: output.resultDigest,
          tapeDigest: output.tapeDigest,
          inputDigest: output.inputDigest,
        }),
      confirm: (verified) =>
        this.submit({
          kind: 'confirm-result',
          gameNumber,
          resultDigest: output.resultDigest,
          tapeDigest: output.tapeDigest,
          inputDigest: output.inputDigest,
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

  private recordVerification(
    gameNumber: number,
    localDigest: string,
    peerDigest: string | null,
    status: HavocMultiplayerGameVerification['status'],
  ): void {
    const next = this.verification.filter((entry) => entry.gameNumber !== gameNumber);
    next.push({
      gameNumber,
      localResultDigest: localDigest,
      peerResultDigest: peerDigest,
      status,
    });
    this.verification = next.sort((left, right) => left.gameNumber - right.gameNumber);
    this.publish();
    void this.persistVerification();
  }

  private async persistVerification(): Promise<void> {
    const roomId = this.roomId;
    if (!roomId) return;
    const receipts = await this.verificationReceipts();
    if (receipts === null) return;
    try {
      await this.deps.repository.saveVerification(roomId, receipts);
    } catch {}
  }

  private async ensureChallenge(): Promise<string | null> {
    if (this.challenge !== null) return this.challenge;
    const attachment = this.attachment;
    if (!attachment?.current()) return null;
    try {
      const challenge = await this.deps.transport.verificationChallenge(attachment.roomId);
      if (!attachment.current()) return null;
      this.challenge = challenge;
      return challenge;
    } catch {
      return null;
    }
  }

  private async verificationReceipts(): Promise<HavocMultiplayerVerificationReceipt[] | null> {
    const verified = this.verification.filter((entry) => entry.status === 'verified');
    if (verified.length === 0) return [];
    const draft = this.draft ?? this.snapshot?.draft ?? null;
    const roomId = this.roomId;
    if (!draft || !roomId) return null;
    const challenge = await this.ensureChallenge();
    if (challenge === null) return null;
    const parsedChallenge = contentHashSchema.parse(challenge);
    const commandIds = this.commands.map((command) => command.commandId);
    return verified.map((entry) => {
      const base: Omit<HavocMultiplayerVerificationReceipt, 'receiptDigest'> = {
        receiptId: `hvr-${String(entry.gameNumber)}`,
        challenge: parsedChallenge,
        resultDigest: entry.localResultDigest,
        commandIds,
        gameSeeds: [havocMultiplayerGameSeed(draft.rootSeed, entry.gameNumber)],
      };
      return havocMultiplayerVerificationReceiptSchema.parse({
        ...base,
        receiptDigest: havocMultiplayerReceiptDigest(base),
      });
    });
  }

  private async persistActive(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.roomId || !this.participantId) return;
    const series = snapshot.series;
    const champion = series?.champion ?? null;
    if (snapshot.phase === 'championship' && champion && series) {
      if (this.completedPersisted) return;
      this.completedPersisted = true;
      const recap: HavocMultiplayerCompletionRecap = {
        roomId: this.roomId,
        champion,
        series,
        mvp: havocMultiplayerSeriesMvpOf({
          series,
          outputs: this.outputs,
          completedRecap: this.completedRecap,
        }),
        games: series.games,
      };
      await this.deps.repository.complete(recap);
      return;
    }
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const receipts = (await this.verificationReceipts()) ?? [];
    if (!attachment.current()) return;
    await this.deps.repository.saveActive({
      roomId: attachment.roomId,
      snapshot,
      verification: receipts,
    });
  }
}
