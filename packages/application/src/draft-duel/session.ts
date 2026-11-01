import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  DRAFT_DUEL_MULTIPLAYER_VERSION,
  canonicalJson,
  defaultDraftDuelVersionLocks,
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
  type CommandId,
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
import type { DraftDuelActiveState, DraftDuelCompletionRecap } from '@hoop-rush/data-contracts';
import type { TickScheduler } from '../runtime/index.ts';
import { type RoomConnection } from '../multiplayer/room-lifecycle.ts';
import { otherSeriesParticipant } from '../multiplayer/series-coordinator.ts';
import { SeriesRoomSession } from '../multiplayer/series-room-session.ts';

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
  completedRecap: DraftDuelCompletionRecap | null;
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
  completedRecap: DraftDuelCompletionRecap | null;
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
  loadActive(roomId: string): Promise<DraftDuelActiveState | null>;
  loadCompleted(roomId: string): Promise<DraftDuelCompletionRecap | null>;
  loadResults(roomId: string): Promise<{ output: DraftDuelGameOutput }[]>;
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

export class DraftDuelSession extends SeriesRoomSession<
  {
    snapshot: DraftDuelRoomSnapshot;
    phase: DraftDuelRoomSnapshot['phase'];
    output: DraftDuelGameOutput;
    resultRow: { output: DraftDuelGameOutput };
    payload: DraftDuelCommand['payload'];
    command: DraftDuelCommand;
    verification: DraftDuelPartiallyVerified;
    storedVerification: DraftDuelActiveState;
    completed: DraftDuelCompletionRecap;
    membership: DraftDuelRoomMembership;
    transient: DraftDuelTransientEvent;
  },
  DraftDuelSessionDeps
> {
  private assets: DraftDuelSessionAssets | null = null;
  private draft: DraftDuelDraft | null = null;
  private completedRecap: DraftDuelCompletionRecap | null = null;

  constructor(deps: DraftDuelSessionDeps) {
    super(deps, {
      retryMs: AUTO_START_RETRY_MS,
      holdMs: GAME_RESULTS_HOLD_MS,
      readyWindowMs: GAME_READY_WINDOW_MS,
    });
  }

  getSnapshot(): DraftDuelSessionView {
    return {
      ...this.viewBase(),
      assets: this.assets,
      participantId: this.participantId,
      draft: this.draft,
      outputs: this.outputs,
      completedRecap: this.completedRecap,
    };
  }

  async createRoom(
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    return this.runBusy(async () => {
      await this.loadAssets();
      const created = await this.deps.transport.create({
        fairness,
        presentation,
        timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
        versions: this.versionLocks(),
      });
      this.deps.saveMembership(created.membership);
      return { roomId: created.snapshot.roomId, code: created.code };
    });
  }

  async roomVersions(): Promise<DraftDuelVersionLocks> {
    await this.loadAssets();
    return this.versionLocks();
  }

  async joinRoom(code: string): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    return this.runBusy(async () => {
      await this.loadAssets();
      const joined = await this.deps.transport.join(code);
      this.deps.saveMembership(joined.membership);
      return {
        roomId: joined.snapshot.roomId,
        code: joined.snapshot.code ?? joined.membership.code,
      };
    });
  }

  async updateSettings(
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<void> {
    await this.submitPayload({ kind: 'settings', fairness, presentation });
  }

  async setReady(ready: boolean): Promise<void> {
    await this.submitPayload({ kind: 'ready', ready });
  }

  async startDraft(): Promise<void> {
    await this.submitPayload({ kind: 'start' });
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
    await this.submitPayload({
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
    await this.submitPayload({
      kind: 'reposition',
      playerId: card.playerId,
      playerVersionId: card.playerVersionId,
      slotIndex,
    });
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

  seriesGameEntries(): DraftDuelSeriesGame[] {
    return this.snapshot?.series?.games ?? [];
  }

  protected currentGameNumber(): number | null {
    return this.snapshot?.series?.currentGameNumber ?? null;
  }

  protected currentOutput(): DraftDuelGameOutput | null {
    const gameNumber = this.currentGameNumber();
    if (gameNumber === null) return null;
    return this.outputs[gameNumber] ?? null;
  }

  private activeTurn(): boolean {
    const draft = this.draft;
    if (this.phase() !== 'drafting' || !draft || draft.status !== 'drafting') return false;
    return draftDuelCurrentPicker(draft) === this.participantId && !this.busy;
  }

  protected async loadAssets(): Promise<void> {
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

  protected rebuildDraft(): void {
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

  /**
   * Draft Duel supplies only the simulation. The pipeline that guards, persists,
   * and publishes it is shared in `SeriesRoomSession.runGamePipeline`.
   */
  protected async simulateGame(gameNumber: number): Promise<DraftDuelGameOutput> {
    const series = this.snapshot?.series;
    if (!series) throw new Error('Draft Duel series is missing.');
    return this.simulateSeriesGame(gameNumber, series.homeWinner);
  }

  protected async persistOutput(output: DraftDuelGameOutput): Promise<void> {
    await this.deps.repository.saveResult(output);
  }

  private async simulateSeriesGame(
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
    const awayParticipantId = otherSeriesParticipant(homeParticipantId);
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

  private winnerOf(output: DraftDuelGameOutput): DraftDuelParticipantId {
    const series = this.snapshot?.series ?? null;
    const game = series?.games.find((entry) => entry.gameNumber === output.gameNumber);
    const home =
      game?.homeParticipantId ??
      (series
        ? draftDuelHomeForGame(series.homeWinner, output.gameNumber)
        : output.homeParticipantId);
    return output.result.winner === 'home' ? home : otherSeriesParticipant(home);
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

  protected async persistActive(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.roomId || !this.participantId) return;
    const state: DraftDuelActiveState = {
      roomId: this.roomId,
      localParticipantId: this.participantId,
      settings: snapshot.settings,
      rootSeed: snapshot.rootSeed,
      phase: snapshot.phase,
      draft: this.draft,
      series: snapshot.series,
      broadcast: snapshot.broadcast,
      verification: this.verification,
    };
    const key = canonicalJson(state);
    if (key !== this.savedActiveKey) {
      const attachment = this.attachment;
      await this.deps.repository.saveActive(state);
      if (!attachment?.current()) return;
      this.savedActiveKey = key;
    }
    const series = snapshot.series;
    const champion = series?.champion ?? null;
    if (snapshot.phase === 'championship' && champion && series && !this.completedPersisted) {
      const recap: DraftDuelCompletionRecap = {
        roomId: this.roomId,
        champion,
        series,
        mvp: this.seriesMvpFact(),
        standouts: this.seriesStandoutsFact(),
        games: series.games.length,
      };
      if (recap.games >= 1) {
        const attachment = this.attachment;
        await this.deps.repository.complete(recap);
        if (attachment?.current()) this.completedPersisted = true;
      }
    }
  }

  protected readonly missingMembershipMessage =
    'You are not a member of this room. Join from the Draft Duel lobby.';
  protected readonly rejectedLabel = 'Draft Duel command rejected';

  protected ordinalOf = (command: DraftDuelCommand): number => command.ordinal;

  protected hasAssets(): boolean {
    return this.assets !== null;
  }

  protected resetModeState(): void {
    this.draft = null;
    this.completedRecap = null;
  }

  protected setVerification(restored: DraftDuelActiveState): void {
    this.verification = restored.verification;
  }

  protected setCompleted(completed: DraftDuelCompletionRecap): void {
    this.completedRecap = completed;
    this.completedPersisted = true;
  }

  protected mergeOutputs(rows: readonly { output: DraftDuelGameOutput }[]): void {
    this.games.restore(rows.map((row) => row.output));
  }

  protected dueDeadline(): { cursor: string } | null {
    const deadline = this.snapshot?.deadline;
    if (!deadline || this.phase() !== 'drafting') return null;
    if (this.now < Date.parse(deadline.deadlineAt)) return null;
    if (!this.deadlineRecovery.due(deadline.cursor, this.now)) return null;
    if (this.draft?.pickOrdinal !== deadline.pickOrdinal) return null;
    return { cursor: deadline.cursor };
  }

  protected deadlineFallback(): DraftDuelCommand['payload'] | null {
    if (!this.draft || !this.assets) return null;
    const pick = draftDuelTimeoutPick(this.draft, this.assets.catalog);
    return {
      kind: 'timeout-autopick',
      pickOrdinal: pick.pickOrdinal,
      playerId: pick.playerId,
      playerVersionId: pick.playerVersionId,
      slotIndex: pick.slotIndex,
      seedPath: pick.seedPath,
    };
  }

  protected buildCommand(
    commandId: CommandId,
    payload: DraftDuelCommand['payload'],
    roomId: Id,
    participantId: DraftDuelParticipantId,
  ): DraftDuelCommand {
    return {
      schemaVersion: 1,
      roomId,
      commandId,
      actorParticipantId: participantId,
      payload,
    } as DraftDuelCommand;
  }

  protected shouldRebuildDraft(commandsChanged: boolean): boolean {
    return commandsChanged || this.draft === null;
  }

  protected appendCommands(roomId: string, commands: readonly DraftDuelCommand[]): Promise<void> {
    return this.deps.repository.appendCommands(roomId, commands);
  }

  protected saveVerification(entries: readonly DraftDuelPartiallyVerified[]): void {
    if (this.roomId) void this.deps.repository.saveVerification(this.roomId, entries);
  }

  protected readyNextPayload(gameNumber: number): DraftDuelCommand['payload'] {
    return { kind: 'ready-next-game', gameNumber, ready: true };
  }

  protected proposeWinner(output: DraftDuelGameOutput): DraftDuelParticipantId {
    return this.winnerOf(output);
  }

  protected confirmPayload(
    output: DraftDuelGameOutput,
    verified: boolean,
  ): DraftDuelCommand['payload'] {
    return {
      kind: 'confirm-result',
      gameNumber: output.gameNumber,
      resultDigest: output.resultDigest,
      verified,
    };
  }
}
