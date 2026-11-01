import {
  HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_GAME_RESULTS_HOLD_MS,
  HAVOC_MULTIPLAYER_LEGACY_RULES_VERSION,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  canonicalJson,
  contentHashSchema,
  defaultHavocMultiplayerVersionLocks,
  havocMultiplayerGameSeed,
  havocMultiplayerVerificationReceiptSchema,
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
  type CommandId,
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
} from '@hoop-rush/data-contracts';
import type { TickScheduler } from '../runtime/index.ts';
import { type RoomConnection } from '../multiplayer/room-lifecycle.ts';
import { SeriesRoomSession } from '../multiplayer/series-room-session.ts';

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
  completedRecap: HavocMultiplayerCompletionRecap | null;
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
  completedRecap: HavocMultiplayerCompletionRecap | null;
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
  loadActive(roomId: string): Promise<HavocMultiplayerActiveState | null>;
  loadCompleted(roomId: string): Promise<HavocMultiplayerCompletionRecap | null>;
  loadResults(roomId: string): Promise<HavocMultiplayerGameOutput[]>;
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

export class HavocMultiplayerSession extends SeriesRoomSession<
  {
    snapshot: HavocMultiplayerRoomSnapshot;
    phase: HavocMultiplayerPhase;
    output: HavocMultiplayerGameOutput;
    resultRow: HavocMultiplayerGameOutput;
    payload: HavocMultiplayerCommand['payload'];
    command: HavocMultiplayerCommand;
    verification: HavocMultiplayerGameVerification;
    storedVerification: HavocMultiplayerActiveState;
    completed: HavocMultiplayerCompletionRecap;
    membership: HavocMultiplayerRoomMembership;
    transient: HavocMultiplayerTransientEvent;
  },
  HavocMultiplayerSessionDeps
> {
  private assets: HavocMultiplayerSessionAssets | null = null;
  private environment: HavocCommandEnvironment | null = null;
  private draft: HavocMultiplayerDraftState | null = null;
  private completedRecap: HavocMultiplayerCompletionRecap | null = null;
  private mvpFacts: HavocMultiplayerSeriesFacts | null = null;
  private mvpValue: HavocMultiplayerSeriesMvp | null = null;
  private challenge: string | null = null;

  constructor(deps: HavocMultiplayerSessionDeps) {
    super(deps, {
      retryMs: AUTO_START_RETRY_MS,
      holdMs: GAME_RESULTS_HOLD_MS,
      readyWindowMs: GAME_READY_WINDOW_MS,
    });
  }

  getSnapshot(): HavocMultiplayerSessionView {
    return {
      ...this.viewBase(),
      assets: this.assets,
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
      completedRecap: this.completedRecap,
      mvp: this.seriesMvp(),
    };
  }

  async createRoom(
    variant: HavocMultiplayerVariant = 'standard',
  ): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    return this.runBusy(async () => {
      await this.loadAssets();
      const created = await this.deps.transport.create({
        variant,
        versions: this.versionLocks(),
      });
      this.deps.saveMembership(created.membership);
      return { roomId: created.snapshot.roomId, code: created.code };
    });
  }

  async roomVersions(): Promise<HavocMultiplayerVersionLocks> {
    await this.loadAssets();
    return this.versionLocks();
  }

  async joinRoom(code: string): Promise<{ roomId: Id; code: HavocMultiplayerRoomCode } | null> {
    return this.runBusy(async () => {
      await this.loadAssets();
      const joined = await this.deps.transport.join(code);
      this.deps.saveMembership(joined.membership);
      return { roomId: joined.snapshot.roomId, code: joined.snapshot.code };
    });
  }

  async setReady(): Promise<void> {
    await this.submitPayload({ kind: 'ready' });
  }

  async startDraft(): Promise<void> {
    await this.submitPayload({ kind: 'start' });
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
    return this.submitPayload({
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
    return this.submitPayload({
      kind: 'reroll',
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
    });
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

  seriesGameEntries(): HavocMultiplayerSeriesGame[] {
    return this.snapshot?.series?.games ?? [];
  }

  protected currentGameNumber(): number | null {
    const series = this.snapshot?.series;
    if (!series) return null;
    return series.games.find((game) => game.status !== 'verified')?.gameNumber ?? null;
  }

  protected currentOutput(): HavocMultiplayerGameOutput | null {
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return null;
    return this.outputs[gameNumber] ?? null;
  }

  private activeTurn(): boolean {
    const draft = this.draft;
    if (this.phase() !== 'drafting' || !draft || draft.status !== 'drafting') return false;
    return draft.activeParticipantId === this.participantId && !this.busy;
  }

  protected async loadAssets(): Promise<void> {
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

  protected rebuildDraft(): void {
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

  /**
   * Havoc supplies only the simulation; the guarding, persistence, and
   * publication pipeline is shared in `SeriesRoomSession.runGamePipeline`.
   */
  protected async simulateGame(gameNumber: number): Promise<HavocMultiplayerGameOutput> {
    const series = this.snapshot?.series;
    if (!series) throw new Error('Havoc series is missing.');
    const game = series.games.find((entry) => entry.gameNumber === gameNumber);
    if (!game) throw new Error('Havoc series game is missing.');
    return this.simulateSeriesGame(game);
  }

  protected async persistOutput(output: HavocMultiplayerGameOutput): Promise<void> {
    await this.deps.repository.saveResult(output);
  }

  private async simulateSeriesGame(
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

  private seriesMvp(): HavocMultiplayerSeriesMvp | null {
    const series = this.snapshot?.series ?? null;
    if (
      !this.mvpFacts ||
      this.mvpFacts.series !== series ||
      this.mvpFacts.outputs !== this.outputs ||
      this.mvpFacts.completedRecap !== this.completedRecap
    ) {
      this.mvpFacts = { series, outputs: this.outputs, completedRecap: this.completedRecap };
      this.mvpValue = havocMultiplayerSeriesMvpOf(this.mvpFacts);
    }
    return this.mvpValue;
  }

  protected async persistActive(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.roomId || !this.participantId) return;
    const series = snapshot.series;
    const champion = series?.champion ?? null;
    if (snapshot.phase === 'championship' && champion && series) {
      if (this.completedPersisted) return;
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
      const attachment = this.attachment;
      await this.deps.repository.complete(recap);
      if (attachment?.current()) this.completedPersisted = true;
      return;
    }
    const attachment = this.attachment;
    if (!attachment?.current()) return;
    const receipts = (await this.verificationReceipts()) ?? [];
    if (!attachment.current()) return;
    const state: HavocMultiplayerActiveState = {
      roomId: attachment.roomId,
      snapshot,
      verification: receipts,
    };
    const key = canonicalJson(state);
    if (key === this.savedActiveKey) return;
    await this.deps.repository.saveActive(state);
    if (attachment.current()) this.savedActiveKey = key;
  }

  protected readonly missingMembershipMessage =
    'You are not a member of this room. Join from the Havoc lobby.';
  protected readonly rejectedLabel = 'Havoc command rejected';

  protected hasAssets(): boolean {
    return this.assets !== null;
  }

  protected resetModeState(): void {
    this.draft = null;
    this.completedRecap = null;
    this.challenge = null;
  }

  protected setVerification(restored: HavocMultiplayerActiveState): void {
    this.verification = verificationFromReceipts(restored.verification);
  }

  protected setCompleted(completed: HavocMultiplayerCompletionRecap): void {
    this.completedRecap = completed;
    this.completedPersisted = true;
  }

  protected mergeOutputs(rows: readonly HavocMultiplayerGameOutput[]): void {
    this.games.restore(rows);
  }

  protected onSnapshot = (snapshot: HavocMultiplayerRoomSnapshot): void => {
    if (snapshot.phase === 'integrity-failed') this.integrityFailed = true;
  };

  protected afterResume(): boolean {
    return this.assertRoomVersions();
  }

  protected afterSnapshotCompatible(): boolean {
    return this.assertRoomVersions();
  }

  protected dueDeadline(): { cursor: string } | null {
    const deadline = this.snapshot?.deadline;
    if (!deadline || this.phase() !== 'drafting') return null;
    if (deadline.participantId !== this.participantId) return null;
    if (this.now < Date.parse(deadline.at)) return null;
    if (!this.deadlineRecovery.due(deadline.cursor, this.now)) return null;
    return { cursor: deadline.cursor };
  }

  protected deadlineFallback(): HavocMultiplayerCommand['payload'] | null {
    const draft = this.draft;
    const assets = this.assets;
    const environment = this.environment;
    if (!draft || !assets || !environment) return null;
    if (draft.status !== 'drafting' || draft.offer === null) return null;
    const card = havocMultiplayerTimeoutPick(draft, assets.catalog, environment);
    return {
      kind: 'timeout-pick',
      turnOrdinal: draft.turnOrdinal,
      offerId: draft.offer.offerId,
      cardId: card.cardId,
    };
  }

  protected buildCommand(
    commandId: CommandId,
    payload: HavocMultiplayerCommand['payload'],
    roomId: Id,
    participantId: HavocMultiplayerParticipantId,
  ): HavocMultiplayerCommand {
    return {
      schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId,
      commandId,
      actorParticipantId: participantId,
      payload,
    };
  }

  protected shouldRebuildDraft(commandsChanged: boolean): boolean {
    return !this.completedPersisted && (commandsChanged || this.draft === null);
  }

  protected shouldPersistActive(): boolean {
    return !this.completedPersisted;
  }

  protected appendCommands(
    roomId: string,
    commands: readonly HavocMultiplayerCommand[],
  ): Promise<void> {
    return this.deps.repository.appendCommands(
      roomId,
      commands.map((command, offset) => ({
        ordinal: this.persistedCommandCount + offset,
        command,
      })),
    );
  }

  protected saveVerification(): void {
    void this.persistVerification();
  }

  protected readyNextPayload(gameNumber: number): HavocMultiplayerCommand['payload'] {
    return { kind: 'ready-next-game', gameNumber };
  }

  protected proposeWinner(output: HavocMultiplayerGameOutput): HavocMultiplayerParticipantId {
    return output.winner;
  }

  protected confirmPayload(
    output: HavocMultiplayerGameOutput,
    verified: boolean,
  ): HavocMultiplayerCommand['payload'] {
    return {
      kind: 'confirm-result',
      gameNumber: output.gameNumber,
      resultDigest: output.resultDigest,
      tapeDigest: output.tapeDigest,
      inputDigest: output.inputDigest,
      verified,
    };
  }
}
