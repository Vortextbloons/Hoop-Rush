import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  commandIdSchema,
  defaultDraftDuelVersionLocks,
  idSchema,
  type DraftDuelBroadcast,
  type DraftDuelCard,
  type DraftDuelCommand,
  type DraftDuelGameOutput,
  type DraftDuelMultiplayerTransport,
  type DraftDuelOfferedPick,
  type DraftDuelParticipantId,
  type DraftDuelPartiallyVerified,
  type DraftDuelRoomCode,
  type DraftDuelRoomSnapshot,
  type DraftDuelSeriesGame,
  type DraftDuelVersionLocks,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  applyDraftDuelPick,
  draftDuelCurrentPicker,
  draftDuelGameSeed,
  draftDuelHomeForGame,
  draftDuelLegalPicks,
  draftDuelRoster,
  draftDuelSeriesMvp,
  draftDuelSimulationTeam,
  draftDuelStandouts,
  draftDuelTimeoutPick,
  createDraftDuelDraft,
} from '@hoop-rush/engine';
import { DexieDraftDuelRepository, type DraftDuelCompletionRecap } from '@hoop-rush/persistence';
import { newRequestId } from '$lib/ids';
import { getDraftDuelTransport } from '$lib/draft-duel-transport';
import { DraftDuelRunner } from '$lib/draft-duel-runner';
import {
  draftDuelVisibleEventCount,
  draftDuelVisibleState,
  type DraftDuelVisibleState,
} from '$lib/draft-duel-playback';
import {
  loadDraftDuelMembership,
  saveDraftDuelMembership,
  friendlyDraftDuelJoinError,
} from '$lib/draft-duel-identity';
import { loadDraftDuelAssets, type DraftDuelAssets } from './draft-duel-assets';
import { draftDuelFeedLines, type DraftDuelFeedLine } from './draft-duel-broadcast-view';

const TICK_MS = 250;
const AUTO_START_RETRY_MS = 5000;
const GAME_READY_WINDOW_MS = 60_000;
type ReactionKey = 'hype' | 'clap' | 'cold' | 'wow';

function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class DraftDuelController {
  assets = $state<DraftDuelAssets | null>(null);
  snapshot = $state<DraftDuelRoomSnapshot | null>(null);
  participantId = $state<DraftDuelParticipantId | null>(null);
  draft = $state<ReturnType<typeof createDraftDuelDraft> | null>(null);
  outputs = $state<Record<number, DraftDuelGameOutput>>({});
  verification = $state<DraftDuelPartiallyVerified[]>([]);
  consideration = $state<{ displayName: string; seasonKey: string } | null>(null);
  reaction = $state<{
    participantId: DraftDuelParticipantId;
    reaction: ReactionKey;
    atMs: number;
  } | null>(null);
  progress = $state(0);
  now = $state(Date.now());
  busy = $state(false);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  integrityFailed = $state(false);
  muted = $state(false);

  private transport: DraftDuelMultiplayerTransport = getDraftDuelTransport();
  private repo = new DexieDraftDuelRepository();
  private runner = new DraftDuelRunner();
  private subscriptions: Array<{ unsubscribe: () => void }> = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private commands: DraftDuelCommand[] = [];
  private resolvedCursor: string | null = null;
  private deadlineResolving = false;
  private syncing = false;
  private syncQueued = false;
  private preparingSinceMs = $state<number | null>(null);
  private lastAutoAttemptMs = 0;
  private proposalSent = new Set<number>();
  private confirmSent = new Set<number>();
  private simulating = new Set<number>();
  private completedPersisted = false;
  private disposed = false;
  private roomId: Id | null = null;

  phase = $derived(this.snapshot?.phase ?? 'lobby');
  series = $derived(this.snapshot?.series ?? null);
  currentGameNumber = $derived(this.series?.currentGameNumber ?? null);
  currentOutput = $derived(
    this.currentGameNumber !== null ? (this.outputs[this.currentGameNumber] ?? null) : null,
  );
  currentBroadcast = $derived(this.snapshot?.broadcast ?? null);
  roundIndex = $derived(this.draft ? Math.min(4, Math.floor(this.draft.pickOrdinal / 2)) : 0);
  currentPicker = $derived(
    this.draft && this.draft.status === 'drafting' ? draftDuelCurrentPicker(this.draft) : null,
  );
  localRoster = $derived(
    this.draft && this.assets && this.participantId
      ? draftDuelRoster(this.draft, this.assets.catalog, this.participantId)
      : null,
  );
  rivalRoster = $derived(
    this.draft && this.assets && this.participantId
      ? draftDuelRoster(this.draft, this.assets.catalog, otherParticipant(this.participantId))
      : null,
  );
  localPicks = $derived.by<DraftDuelOfferedPick[]>(() => {
    if (!this.draft || !this.assets || !this.participantId || this.draft.status !== 'drafting') {
      return [];
    }
    if (this.currentPicker === this.participantId) {
      return draftDuelLegalPicks(this.draft, this.assets.catalog);
    }
    const round = this.draft.rounds[this.roundIndex];
    const pool = round?.offers[this.participantId] ?? [];
    return pool.map((card, slot) => ({
      slot,
      card,
      available: false,
      reason: 'turn',
    }));
  });
  rivalPool = $derived.by<DraftDuelCard[]>(() => {
    if (!this.draft || !this.participantId) return [];
    const round = this.draft.rounds[this.roundIndex];
    return [...(round?.offers[otherParticipant(this.participantId)] ?? [])];
  });
  activeTurn = $derived(
    this.phase === 'drafting' &&
      this.draft?.status === 'drafting' &&
      this.currentPicker === this.participantId &&
      !this.busy,
  );
  deadlineMsLeft = $derived.by<number | null>(() => {
    const deadline = this.snapshot?.deadline;
    if (!deadline) return null;
    return Math.max(0, Date.parse(deadline.deadlineAt) - this.now);
  });
  localReady = $derived.by<boolean>(() => {
    const me = this.snapshot?.members.find((member) => member.participantId === this.participantId);
    const game = this.currentGameNumber;
    if (!me || game === null) return false;
    return me.nextGameReady === game;
  });
  opponentReady = $derived.by<boolean>(() => {
    const game = this.currentGameNumber;
    if (!this.participantId || game === null) return false;
    const rival = otherParticipant(this.participantId);
    const member = this.snapshot?.members.find((entry) => entry.participantId === rival);
    return member?.nextGameReady === game;
  });
  readyCountdownMs = $derived.by<number | null>(() => {
    if (this.phase !== 'preparing-game') return null;
    if (this.preparingSinceMs === null) return null;
    if (this.opponentReady) return null;
    return Math.max(0, this.preparingSinceMs + GAME_READY_WINDOW_MS - this.now);
  });
  visibleCount = $derived(
    this.currentOutput ? draftDuelVisibleEventCount(this.currentOutput.tape, this.progress) : 0,
  );
  visible = $derived.by<DraftDuelVisibleState | null>(() =>
    this.currentOutput ? draftDuelVisibleState(this.currentOutput, this.visibleCount) : null,
  );
  feed = $derived.by<DraftDuelFeedLine[]>(() =>
    this.currentOutput ? draftDuelFeedLines(this.currentOutput, this.visibleCount) : [],
  );
  playedGames = $derived.by<
    Array<{
      gameNumber: number;
      homeParticipantId: DraftDuelParticipantId;
      awayParticipantId: DraftDuelParticipantId;
      result: DraftDuelGameOutput['result'];
    }>
  >(() => {
    const series = this.series;
    if (!series) return [];
    const played: Array<{
      gameNumber: number;
      homeParticipantId: DraftDuelParticipantId;
      awayParticipantId: DraftDuelParticipantId;
      result: DraftDuelGameOutput['result'];
    }> = [];
    for (const game of series.games) {
      const output = this.outputs[game.gameNumber];
      if (!output) continue;
      played.push({
        gameNumber: game.gameNumber,
        homeParticipantId: game.homeParticipantId,
        awayParticipantId: game.awayParticipantId,
        result: output.result,
      });
    }
    return played;
  });
  seriesMvp = $derived.by(() => {
    if (!this.assets || !this.series?.champion) return null;
    const rosters = this.rosters();
    if (!rosters) return null;
    if (this.playedGames.length !== this.series.games.length) return null;
    return draftDuelSeriesMvp(this.assets.catalog, rosters, this.playedGames, this.series.champion);
  });
  seriesStandouts = $derived.by(() => {
    if (!this.assets) return [];
    const rosters = this.rosters();
    if (!rosters) return [];
    if (this.playedGames.length === 0) return [];
    return draftDuelStandouts(this.assets.catalog, rosters, this.playedGames);
  });
  rivalRematchRequested = $derived.by(() =>
    this.commands.some(
      (command) =>
        command.payload.kind === 'rematch-request' &&
        command.actorParticipantId !== this.participantId,
    ),
  );
  myRematchRequested = $derived.by(() =>
    this.commands.some(
      (command) =>
        command.payload.kind === 'rematch-request' &&
        command.actorParticipantId === this.participantId,
    ),
  );
  successorRoomId = $derived(this.snapshot?.successorRoomId ?? null);

  async attach(roomId: string): Promise<void> {
    if (this.disposed) return;
    this.roomId = idSchema.parse(roomId);
    try {
      await this.loadAssets();
      const membership = loadDraftDuelMembership(roomId);
      if (!membership) {
        this.error = 'You are not a member of this room. Join from the Draft Duel lobby.';
        return;
      }
      const resumed = await this.transport.resume(roomId);
      this.participantId = resumed.membership.participantId;
      saveDraftDuelMembership(resumed.membership);
      this.applySnapshot(resumed.snapshot);
      const restored = await this.repo.loadActive(roomId);
      if (restored) {
        const outputs: Record<number, DraftDuelGameOutput> = {};
        const rows = await this.repo.loadResults(roomId);
        for (const row of rows) outputs[row.gameNumber] = row.output;
        this.outputs = { ...this.outputs, ...outputs };
        this.verification = restored.verification;
      }
      this.subscriptions.push(
        this.transport.subscribe(roomId, (snapshot) => {
          this.applySnapshot(snapshot);
          void this.syncFromServer();
        }),
      );
      this.subscriptions.push(
        this.transport.subscribeTransient(roomId, (event) => {
          this.onTransient(event);
        }),
      );
      await this.syncFromServer();
      this.startTimers();
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
    }
  }

  async createRoom(
    fairness: 'fair' | 'unfair',
    presentation: 'ratings' | 'ball-knowledge',
  ): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    this.busy = true;
    this.error = null;
    try {
      await this.loadAssets();
      const versions = this.versionLocks();
      const created = await this.transport.create({
        fairness,
        presentation,
        timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
        versions,
      });
      saveDraftDuelMembership(created.membership);
      return { roomId: created.snapshot.roomId, code: created.code };
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
      return null;
    } finally {
      this.busy = false;
    }
  }

  async joinRoom(code: string): Promise<{ roomId: Id; code: DraftDuelRoomCode } | null> {
    this.busy = true;
    this.error = null;
    try {
      await this.loadAssets();
      const joined = await this.transport.join(code);
      saveDraftDuelMembership(joined.membership);
      return {
        roomId: joined.snapshot.roomId,
        code: joined.snapshot.code ?? joined.membership.code,
      };
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
      return null;
    } finally {
      this.busy = false;
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
    if (!this.draft || this.draft.status !== 'drafting') return;
    if (!this.activeTurn) {
      this.notice = 'It is not your turn.';
      return;
    }
    if (!pick.available) {
      this.notice = 'That card cannot be picked right now.';
      return;
    }
    if (slotIndex < 0 || slotIndex > 4 || !Number.isInteger(slotIndex)) {
      this.notice = 'Choose a position for this player.';
      return;
    }
    await this.submit({
      kind: 'pick',
      pickOrdinal: this.draft.pickOrdinal,
      playerId: pick.card.playerId,
      playerVersionId: pick.card.playerVersionId,
      slotIndex,
    });
  }

  async readyForNextGame(): Promise<void> {
    const gameNumber = this.currentGameNumber;
    if (gameNumber === null) return;
    await this.submit({ kind: 'ready-next-game', gameNumber, ready: true });
  }

  async startBroadcast(auto = false): Promise<void> {
    const gameNumber = this.currentGameNumber;
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
      const rematch = await this.transport.rematch(this.roomId);
      const joined = await this.transport.join(rematch.code);
      saveDraftDuelMembership(joined.membership);
      return joined.snapshot.roomId;
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
      return null;
    }
  }

  async removeGuest(): Promise<void> {
    if (!this.roomId || this.participantId !== 'p1') return;
    try {
      const next = await this.transport.removeGuest(
        this.roomId,
        otherParticipant(this.participantId),
      );
      this.applySnapshot(next);
      await this.syncFromServer();
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
    }
  }

  async leaveRoom(): Promise<void> {
    if (!this.roomId || !this.participantId) return;
    const roomId = this.roomId;
    const participantId = this.participantId;
    try {
      await this.transport.leave(roomId, participantId);
    } catch {}
    this.dispose();
  }

  async consider(card: DraftDuelCard | null): Promise<void> {
    if (!this.roomId || !this.participantId || !this.draft) return;
    if (!card) {
      this.consideration = null;
      return;
    }
    this.consideration = null;
    await this.transport.publishTransient(this.roomId, {
      kind: 'consideration',
      roomId: this.roomId,
      participantId: this.participantId,
      pickOrdinal: this.draft.pickOrdinal,
      playerId: card.playerId,
      playerVersionId: card.playerVersionId,
      sentAtMs: Date.now(),
    });
  }

  async react(reaction: ReactionKey): Promise<void> {
    if (!this.roomId || !this.participantId || !this.draft || this.muted) return;
    await this.transport.publishTransient(this.roomId, {
      kind: 'reaction',
      roomId: this.roomId,
      participantId: this.participantId,
      pickOrdinal: this.draft.pickOrdinal,
      reaction,
      sentAtMs: Date.now(),
    });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  dispose(): void {
    this.disposed = true;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
    this.runner.dispose();
  }

  private async loadAssets(): Promise<void> {
    this.assets ??= await loadDraftDuelAssets();
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

  private rosters(): {
    p1: ReturnType<typeof draftDuelRoster>;
    p2: ReturnType<typeof draftDuelRoster>;
  } | null {
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
    const previousPhase = this.snapshot?.phase ?? null;
    const previousBroadcastGame = this.snapshot?.broadcast?.gameNumber ?? null;
    this.snapshot = snapshot;
    if (snapshot.phase === 'preparing-game' && previousPhase !== 'preparing-game') {
      this.preparingSinceMs = Date.now();
      this.lastAutoAttemptMs = 0;
    }
    if (snapshot.phase !== 'preparing-game') {
      this.preparingSinceMs = null;
    }
    const broadcastGame = snapshot.broadcast?.gameNumber ?? null;
    if (broadcastGame !== null && broadcastGame !== previousBroadcastGame) {
      this.progress = 0;
      this.startPlayback();
    }
    if (snapshot.phase !== 'broadcasting' && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startTimers(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      this.now = Date.now();
      this.tick();
    }, TICK_MS);
  }

  private tick(): void {
    if (this.disposed || this.busy) return;
    const deadline = this.snapshot?.deadline;
    if (
      this.phase === 'drafting' &&
      deadline &&
      this.now >= Date.parse(deadline.deadlineAt) &&
      this.resolvedCursor !== deadline.cursor
    ) {
      void this.resolveDeadline(deadline.cursor, deadline.pickOrdinal);
    }
    if (
      this.phase === 'preparing-game' &&
      ((this.localReady && this.opponentReady) ||
        (this.readyCountdownMs === 0 && !this.opponentReady)) &&
      this.now - this.lastAutoAttemptMs >= AUTO_START_RETRY_MS
    ) {
      this.lastAutoAttemptMs = this.now;
      void this.startBroadcast(!(this.localReady && this.opponentReady));
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
        ...(timeoutPick.slotIndex !== undefined ? { slotIndex: timeoutPick.slotIndex } : {}),
        seedPath: timeoutPick.seedPath,
      };
      await this.transport.commitFallback(this.roomId, cursor, payload);
      await this.transport.submitCommand({
        schemaVersion: 1,
        roomId: this.roomId,
        commandId: commandIdSchema.parse(`timeout-${cursor}-${String(timeoutPick.pickOrdinal)}`),
        actorParticipantId: this.participantId,
        payload,
      });
      this.resolvedCursor = cursor;
      await this.syncFromServer();
    } catch {
      this.resolvedCursor = cursor;
    } finally {
      this.deadlineResolving = false;
    }
  }

  private async submit(payload: DraftDuelCommand['payload']): Promise<boolean> {
    if (!this.roomId || !this.participantId) return false;
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      await this.transport.submitCommand({
        schemaVersion: 1,
        roomId: this.roomId,
        commandId: commandIdSchema.parse(newRequestId()),
        actorParticipantId: this.participantId,
        payload,
      });
      await this.syncFromServer();
      return true;
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async syncFromServer(): Promise<void> {
    if (this.disposed || !this.roomId || !this.assets) return;
    if (this.syncing) {
      this.syncQueued = true;
      return;
    }
    this.syncing = true;
    try {
      const commands = await this.transport.refetch(this.roomId, -1);
      this.commands = commands;
      await this.repo.appendCommands(this.roomId, commands);
      this.rebuildDraft();
      await this.ensureGamePipeline();
      this.maybeProposeOrConfirm();
      await this.persistActive();
    } catch (error) {
      this.error = friendlyDraftDuelJoinError(error);
    } finally {
      this.syncing = false;
      if (this.syncQueued) {
        this.syncQueued = false;
        void this.syncFromServer();
      }
    }
  }

  private rebuildDraft(): void {
    const snapshot = this.snapshot;
    const assets = this.assets;
    if (!snapshot || !assets) return;
    const rootSeed = snapshot.rootSeed;
    if (!rootSeed) {
      this.draft = null;
      return;
    }
    const draftCommands = this.commands
      .filter(
        (command) => command.payload.kind === 'pick' || command.payload.kind === 'timeout-autopick',
      )
      .sort((a, b) => a.ordinal - b.ordinal);
    try {
      let state = createDraftDuelDraft({
        rootSeed,
        fairness: snapshot.settings.fairness,
        catalog: assets.catalog,
      });
      for (const command of draftCommands) {
        const payload = command.payload;
        if (payload.kind !== 'pick' && payload.kind !== 'timeout-autopick') continue;
        state = applyDraftDuelPick(state, assets.catalog, {
          participantId: command.actorParticipantId,
          playerId: payload.playerId,
          playerVersionId: payload.playerVersionId,
          ...(payload.slotIndex !== undefined ? { slotIndex: payload.slotIndex } : {}),
        });
      }
      this.draft = state;
    } catch (error) {
      this.error =
        error instanceof Error
          ? `Draft sync failed: ${error.message.slice(0, 200)}`
          : 'Draft sync failed.';
    }
  }

  private broadcastOf(): DraftDuelBroadcast | null {
    return this.snapshot?.broadcast ?? null;
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
      await this.repo.saveResult(output);
    } catch (error) {
      this.error =
        error instanceof Error
          ? `Game simulation failed: ${error.message.slice(0, 200)}`
          : 'Game simulation failed.';
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
    return this.runner.runDraftDuelGame({
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

  private startPlayback(): void {
    const broadcast = this.broadcastOf();
    if (!broadcast || this.rafId !== null || this.disposed) return;
    const startedAt = Date.parse(broadcast.startedAtIso);
    const duration = broadcast.durationMs;
    const loop = () => {
      if (this.disposed || this.snapshot?.phase !== 'broadcasting') {
        this.rafId = null;
        return;
      }
      const progress = clamp01((Date.now() - startedAt) / duration);
      this.progress = progress;
      if (progress >= 1) {
        this.rafId = null;
        this.maybeProposeOrConfirm();
        return;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
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

  private maybeProposeOrConfirm(): void {
    const snapshot = this.snapshot;
    const series = snapshot?.series;
    const output = this.currentOutput;
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
      });
      return;
    }
    const { byParticipant } = this.proposalOf(gameNumber);
    const rivalId = otherParticipant(this.participantId);
    const rivalDigest = byParticipant[rivalId];
    if (rivalDigest === undefined || this.confirmSent.has(gameNumber)) return;
    this.confirmSent.add(gameNumber);
    if (rivalDigest === output.resultDigest) {
      void this.submit({
        kind: 'confirm-result',
        gameNumber,
        resultDigest: output.resultDigest,
        verified: true,
      });
      this.recordVerification(gameNumber, output.resultDigest, rivalDigest, 'verified');
    } else {
      this.recordVerification(gameNumber, output.resultDigest, rivalDigest, 'mismatch');
      this.integrityFailed = true;
      void this.submit({
        kind: 'confirm-result',
        gameNumber,
        resultDigest: output.resultDigest,
        verified: false,
      }).then(() => {
        if (this.roomId) void this.transport.fail(this.roomId).catch(() => {});
      });
    }
  }

  private winnerOf(output: DraftDuelGameOutput): DraftDuelParticipantId {
    const game = this.series?.games.find((entry) => entry.gameNumber === output.gameNumber);
    const home =
      game?.homeParticipantId ??
      (this.series
        ? draftDuelHomeForGame(this.series.homeWinner, output.gameNumber)
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
    if (this.roomId) void this.repo.saveVerification(this.roomId, this.verification);
  }

  private async persistActive(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.roomId || !this.participantId) return;
    await this.repo.saveActive({
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
        mvp: this.seriesMvp,
        standouts: this.seriesStandouts,
        games: series.games.length,
      };
      if (recap.games >= 1) await this.repo.complete(recap);
    }
  }

  private onTransient(event: {
    kind: 'consideration' | 'reaction';
    participantId: DraftDuelParticipantId;
    playerVersionId?: string;
    reaction?: ReactionKey;
    sentAtMs: number;
  }): void {
    if (event.participantId === this.participantId) return;
    if (event.kind === 'consideration' && event.playerVersionId && this.assets) {
      const playerVersionId = event.playerVersionId;
      const entry = this.assets.catalog.byVersionId.get(playerVersionId);
      if (!entry) return;
      const consideration = {
        displayName: entry.card.displayName,
        seasonKey: entry.card.seasonKey,
      };
      this.consideration = consideration;
      const token = `${playerVersionId}:${String(event.sentAtMs)}`;
      setTimeout(() => {
        if (`${playerVersionId}:${String(event.sentAtMs)}` === token) {
          this.consideration = null;
        }
      }, 2000);
      return;
    }
    if (event.kind === 'reaction' && event.reaction && !this.muted) {
      this.reaction = {
        participantId: event.participantId,
        reaction: event.reaction,
        atMs: event.sentAtMs,
      };
    }
  }

  seriesGameEntries(): DraftDuelSeriesGame[] {
    return this.series?.games ?? [];
  }
}
