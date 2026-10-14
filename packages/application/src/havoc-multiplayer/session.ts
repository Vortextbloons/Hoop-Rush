import {
  HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_GAME_RESULTS_HOLD_MS,
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
  HavocMultiplayerCompletionRecap,
  HavocMultiplayerGameOutput,
  HavocMultiplayerRepository,
  HavocMultiplayerSeriesMvp,
  StoredHavocMultiplayerCompleted,
  StoredHavocMultiplayerResultRow,
} from '@hoop-rush/persistence';

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

export interface HavocMultiplayerSessionDeps {
  transport: HavocMultiplayerTransport;
  repository: Pick<
    HavocMultiplayerRepository,
    | 'loadActive'
    | 'loadCompleted'
    | 'loadResults'
    | 'appendCommands'
    | 'saveResult'
    | 'saveVerification'
    | 'saveActive'
    | 'complete'
  >;
  runner: HavocMultiplayerRunnerPort;
  loadAssets: () => Promise<HavocMultiplayerSessionAssets>;
  now: () => number;
  newCommandId: () => string;
  friendlyError: (error: unknown) => string;
  loadMembership: (roomId: string) => HavocMultiplayerRoomMembership | null;
  saveMembership: (membership: HavocMultiplayerRoomMembership) => void;
}

function otherParticipant(
  participantId: HavocMultiplayerParticipantId,
): HavocMultiplayerParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  private readonly listeners = new Set<() => void>();
  private readonly transientListeners = new Set<(event: HavocMultiplayerTransientEvent) => void>();
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
  private subscriptions: Array<{ unsubscribe: () => void }> = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private playbackElapsedMs = 0;
  private playbackDoneAtMs: number | null = null;
  private continueApprovedGame: number | null = null;
  private resolvedCursor: string | null = null;
  private deadlineResolving = false;
  private deadlineRetryAtMs = 0;
  private rematchRetryAtMs = 0;
  private syncing = false;
  private syncQueued = false;
  private preparingSinceMs: number | null = null;
  private lastAutoAttemptMs = 0;
  private resultRetryAtMs = 0;
  private proposalSent = new Set<number>();
  private confirmSent = new Set<number>();
  private simulating = new Set<number>();
  private completedPersisted = false;
  private disposed = false;
  private roomId: Id | null = null;

  constructor(deps: HavocMultiplayerSessionDeps) {
    this.deps = deps;
    this.now = deps.now();
  }

  getSnapshot(): HavocMultiplayerSessionView {
    return {
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
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeTransient(listener: (event: HavocMultiplayerTransientEvent) => void): () => void {
    this.transientListeners.add(listener);
    return () => {
      this.transientListeners.delete(listener);
    };
  }

  async attach(roomId: string): Promise<void> {
    if (this.disposed) return;
    this.roomId = idSchema.parse(roomId);
    try {
      await this.loadAssets();
      const membership = this.deps.loadMembership(roomId);
      if (!membership) {
        this.error = 'You are not a member of this room. Join from the Havoc lobby.';
        this.publish();
        return;
      }
      const resumed = await this.deps.transport.resume(roomId);
      this.participantId = resumed.membership.participantId;
      this.deps.saveMembership(resumed.membership);
      this.applySnapshot(resumed.snapshot);
      if (!this.assertRoomVersions()) {
        this.publish();
        return;
      }
      const restored = await this.deps.repository.loadActive(roomId);
      if (restored) {
        this.verification = verificationFromReceipts(restored.verification);
      }
      const completed = await this.deps.repository.loadCompleted(roomId);
      if (completed) {
        this.completedRecap = completed;
        this.completedPersisted = true;
      }
      const rows = await this.deps.repository.loadResults(roomId);
      if (rows.length > 0) {
        const outputs: Record<number, HavocMultiplayerGameOutput> = {};
        for (const row of rows) outputs[row.gameNumber] = storedResultToOutput(row);
        this.outputs = { ...this.outputs, ...outputs };
      }
      this.subscriptions.push(
        this.deps.transport.subscribe(roomId, (snapshot) => {
          this.applySnapshot(snapshot);
          void this.syncFromServer();
        }),
      );
      this.subscriptions.push(
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

  async createRoom(): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      await this.loadAssets();
      const created = await this.deps.transport.create({ versions: this.versionLocks() });
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

  async pickCard(card: HavocDraftCard): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.status !== 'drafting' || draft.offer === null) return;
    if (!this.activeTurn()) {
      this.notice = 'It is not your turn.';
      this.publish();
      return;
    }
    if (card.offerId !== draft.offer.offerId) {
      this.notice = 'That card is not part of the current offer.';
      this.publish();
      return;
    }
    const seasonKey = card.source.seasonKey;
    if (seasonKey === null) {
      this.notice = 'That card cannot be picked right now.';
      this.publish();
      return;
    }
    await this.submit({
      kind: 'pick',
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
      cardId: card.cardId,
      claimKey: { playerId: card.source.playerId, seasonKey },
    });
  }

  async rerollOffer(): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.status !== 'drafting' || draft.offer === null) return;
    if (!this.activeTurn()) {
      this.notice = 'It is not your turn.';
      this.publish();
      return;
    }
    await this.submit({
      kind: 'reroll',
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
    });
  }

  async readyForNextGame(): Promise<void> {
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
    const startedAt = Date.parse(broadcast.startedAt);
    const duration = broadcast.durationMs;
    this.playbackElapsedMs = clamp01((this.deps.now() - startedAt) / duration) * duration;
  }

  advancePlayback(deltaMs: number): void {
    if (this.disposed) return;
    const broadcast = this.broadcastOf();
    if (!broadcast) return;
    this.playbackElapsedMs += deltaMs;
    const progress = clamp01(this.playbackElapsedMs / broadcast.durationMs);
    this.progress = progress;
    if (progress >= 1 && this.playbackDoneAtMs === null) {
      this.playbackDoneAtMs = this.deps.now();
      this.continueApprovedGame = null;
    }
    this.publish();
    if (progress >= 1) this.maybeProposeOrConfirm();
  }

  continueAfterGame(): void {
    if (this.disposed) return;
    const output = this.currentOutput();
    if (!output) return;
    this.continueApprovedGame = output.gameNumber;
    this.maybeProposeOrConfirm();
  }

  seriesGameEntries(): HavocMultiplayerSeriesGame[] {
    return this.snapshot?.series?.games ?? [];
  }

  dispose(): void {
    this.disposed = true;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
    this.listeners.clear();
    this.transientListeners.clear();
    this.deps.runner.dispose();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }

  private emitTransient(event: HavocMultiplayerTransientEvent): void {
    for (const listener of this.transientListeners) listener(event);
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
    const me = this.snapshot?.members.find((member) => member.participantId === this.participantId);
    const game = this.currentGameNumber();
    if (!me || game === null) return false;
    return me.nextGameReady === game;
  }

  private opponentReady(): boolean {
    const me = this.participantId;
    const game = this.currentGameNumber();
    if (!me || game === null) return false;
    const member = this.snapshot?.members.find(
      (entry) => entry.participantId === otherParticipant(me),
    );
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
    const matches =
      locks.engineVersion === versions.engineVersion &&
      locks.rulesVersion === versions.rulesVersion &&
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

  private applySnapshot(snapshot: HavocMultiplayerRoomSnapshot): void {
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
      this.playbackDoneAtMs = null;
      this.continueApprovedGame = null;
    }
    if (snapshot.phase === 'integrity-failed') {
      this.integrityFailed = true;
    }
    this.publish();
  }

  private startTimers(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      this.now = this.deps.now();
      this.publish();
      this.tick();
    }, TICK_MS);
  }

  private tick(): void {
    if (this.disposed || this.busy) return;
    if (this.shouldCreateRematch()) void this.syncFromServer();
    this.maybeProposeOrConfirm();
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
      this.phase() === 'preparing-game' &&
      ((this.localReady() && this.opponentReady()) ||
        (this.readyCountdownMs() === 0 && !this.opponentReady())) &&
      this.now - this.lastAutoAttemptMs >= AUTO_START_RETRY_MS
    ) {
      this.lastAutoAttemptMs = this.now;
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
    this.deadlineResolving = true;
    try {
      const card = havocMultiplayerTimeoutPick(draft, assets.catalog, environment);
      await this.deps.transport.commitFallback(this.roomId, cursor, {
        kind: 'timeout-pick',
        turnOrdinal: draft.turnOrdinal,
        offerId: draft.offer.offerId,
        cardId: card.cardId,
      });
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

  private async submit(payload: HavocMultiplayerCommand['payload']): Promise<boolean> {
    if (!this.roomId || !this.participantId) return false;
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.publish();
    try {
      const receipt = await this.deps.transport.submitCommand({
        schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        roomId: this.roomId,
        commandId: commandIdSchema.parse(this.deps.newCommandId()),
        actorParticipantId: this.participantId,
        payload,
      });
      if (!receipt.accepted) {
        throw new Error(`Havoc command rejected: ${receipt.rejectionCode ?? 'unknown'}`);
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

  private async syncFromServer(): Promise<void> {
    if (this.disposed || !this.roomId || !this.assets) return;
    if (this.syncing) {
      this.syncQueued = true;
      return;
    }
    this.syncing = true;
    const isDisposed = () => this.disposed;
    try {
      const resumed = await this.deps.transport.resume(this.roomId);
      if (isDisposed()) return;
      this.applySnapshot(resumed.snapshot);
      if (!this.assertRoomVersions()) return;
      const commands = await this.deps.transport.refetch(this.roomId, -1);
      if (isDisposed()) return;
      this.commands = commands;
      if (this.shouldCreateRematch()) {
        this.rematchRetryAtMs = this.deps.now() + AUTO_START_RETRY_MS;
        await this.deps.transport.rematch(this.roomId);
        this.applySnapshot((await this.deps.transport.resume(this.roomId)).snapshot);
      }
      if (!this.completedPersisted) {
        await this.deps.repository.appendCommands(
          this.roomId,
          commands.map((command, ordinal) => ({ ordinal, command })),
        );
        this.rebuildDraft();
        await this.ensureGamePipeline();
        await this.persistActive();
      }
      this.maybeProposeOrConfirm();
      this.publish();
    } catch (error) {
      this.error = this.deps.friendlyError(error);
      this.publish();
    } finally {
      this.syncing = false;
      if (this.syncQueued) {
        this.syncQueued = false;
        void this.syncFromServer();
      }
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
    if (this.outputs[gameNumber] || this.simulating.has(gameNumber)) return;
    const game = series.games.find((entry) => entry.gameNumber === gameNumber);
    if (!game) return;
    const roomId = this.roomId;
    this.simulating.add(gameNumber);
    try {
      const output = await this.simulateGame(game);
      if (this.disposed || this.roomId !== roomId) return;
      this.outputs = { ...this.outputs, [gameNumber]: output };
      await this.deps.repository.saveResult(output);
      this.publish();
    } catch (error) {
      if (!this.disposed) {
        this.error =
          error instanceof Error
            ? `Game simulation failed: ${error.message.slice(0, 200)}`
            : 'Game simulation failed.';
        this.publish();
      }
    } finally {
      this.simulating.delete(gameNumber);
    }
  }

  private async simulateGame(
    game: HavocMultiplayerSeriesGame,
  ): Promise<HavocMultiplayerGameOutput> {
    const snapshot = this.snapshot;
    const assets = this.assets;
    const draft = this.draft;
    if (!snapshot || !assets || !draft || draft.status !== 'complete' || !this.roomId) {
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
      roomId: this.roomId,
      gameNumber: game.gameNumber,
      input,
    });
    this.assertRunnerOutput(input, output);
    return {
      roomId: this.roomId,
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
    if (this.continueApprovedGame === gameNumber) return true;
    if (this.playbackDoneAtMs === null) return true;
    return this.deps.now() - this.playbackDoneAtMs >= GAME_RESULTS_HOLD_MS;
  }

  private awaitingContinue(): boolean {
    const snapshot = this.snapshot;
    const output = this.currentOutput();
    if (!snapshot || !output) return false;
    if (snapshot.phase !== 'game-results') return false;
    if (this.confirmSent.has(output.gameNumber)) return false;
    return !this.continueApproved(output.gameNumber);
  }

  private maybeProposeOrConfirm(): void {
    if (this.disposed || this.busy || this.deps.now() < this.resultRetryAtMs) return;
    const snapshot = this.snapshot;
    const output = this.currentOutput();
    if (!snapshot || !output || !this.participantId) return;
    const gameNumber = output.gameNumber;
    if (snapshot.phase !== 'broadcasting' && snapshot.phase !== 'game-results') return;
    if (this.progress < 1 && snapshot.phase === 'broadcasting') return;
    if (!this.proposalSent.has(gameNumber)) {
      this.proposalSent.add(gameNumber);
      void this.submit({
        kind: 'propose-result',
        gameNumber,
        winner: output.winner,
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
    const rivalDigest = byParticipant[otherParticipant(this.participantId)];
    if (rivalDigest === undefined || this.confirmSent.has(gameNumber)) return;
    if (rivalDigest === output.resultDigest && !this.continueApproved(gameNumber)) return;
    this.confirmSent.add(gameNumber);
    if (rivalDigest === output.resultDigest) {
      void this.submit({
        kind: 'confirm-result',
        gameNumber,
        resultDigest: output.resultDigest,
        tapeDigest: output.tapeDigest,
        inputDigest: output.inputDigest,
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
        tapeDigest: output.tapeDigest,
        inputDigest: output.inputDigest,
        verified: false,
      }).then(() => {
        if (this.roomId) void this.deps.transport.fail(this.roomId).catch(() => {});
      });
    }
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
    const roomId = this.roomId;
    if (!roomId) return null;
    try {
      this.challenge = await this.deps.transport.verificationChallenge(roomId);
      return this.challenge;
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
    const receipts = (await this.verificationReceipts()) ?? [];
    await this.deps.repository.saveActive({
      roomId: this.roomId,
      snapshot,
      verification: receipts,
    });
  }
}
