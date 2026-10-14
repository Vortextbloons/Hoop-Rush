import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import {
  fixedFiveTimeoutMsForMode,
  playerVersionId,
  type ContentHash,
  type FixedFiveDuelGameOutput,
  type FixedFiveRoomSnapshot,
  type FixedFiveVerificationReceipt,
  type FixedFiveWorkerResultEntry,
  type PlayersIndexEntry,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import { arenaWin } from '#lib/arena-sound.js';
import { presentationForVariant } from '#lib/draft-presentation.js';
import { newRequestId } from '#lib/ids.js';
import {
  friendlyFixedFiveJoinError,
  loadFixedFiveMembership,
  saveFixedFiveMembership,
} from './fixed-five-identity';
import {
  aggregateFixedFivePlayerStats,
  type FixedFivePlayerStats,
} from './fixed-five-player-stats';
import { fixedFiveRepository } from './fixed-five-repo';
import {
  deriveEffectivePhase,
  loadActivityAt,
  loadFixedFiveAssets,
  overlaySnapshotProgress,
  roomLogFacts,
  saveActivityNow,
  type DraftReplay,
  type FixedFiveAssets,
} from './fixed-five-room-state';
import { rollAnimationFor } from './fixed-five-roll-animation';
import { FixedFiveRunner } from './fixed-five-runner';
import {
  FixedFiveRoomSession,
  type DuelGameVerification,
  type FixedFiveLocalResult,
  type FixedFiveRoomSessionDeps,
  type FixedFiveRoomSessionSnapshot,
} from '@hoop-rush/application/fixed-five';
import { buildSimulationTeam } from './fixed-five-room-state';
import { getFixedFiveTransport } from './fixed-five-transport';
import { lobbyCommand, loadLobbyId } from './multiplayer-lobby';
import type { GamecastPlayer } from '#lib/gamecast/gamecast-types.js';

const TICK_MS = 1000;
const COPY_FEEDBACK_MS = 1500;

export interface FixedFiveRoomControllerDeps {
  roomId: string;
  session?: Partial<FixedFiveRoomSessionDeps>;
}

function defaultSessionDeps(roomId: string): FixedFiveRoomSessionDeps {
  return {
    roomId,
    transport: getFixedFiveTransport(),
    repository: fixedFiveRepository,
    createRunner: (onEvent) => new FixedFiveRunner(onEvent),
    loadAssets: () => loadFixedFiveAssets(),
    buildTeam: (manifest, teamId, displayName, refs) =>
      buildSimulationTeam(manifest, teamId, displayName, refs),
    loadMembership: (id) => loadFixedFiveMembership(id),
    saveMembership: (membership) => {
      saveFixedFiveMembership(membership);
    },
    loadLobbyId: (id) => loadLobbyId(id),
    removeLobbyGuest: (lobbyId) => lobbyCommand({ kind: 'remove-guest', lobbyId }),
    now: () => Date.now(),
    newCommandId: () => newRequestId(),
    friendlyError: (error) => friendlyFixedFiveJoinError(error),
    loadActivityAt: (id) => loadActivityAt(id),
    saveActivityNow: (id) => {
      saveActivityNow(id);
    },
    prefersReducedMotion: () => {
      try {
        return (
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
      } catch {
        return false;
      }
    },
    guardStorage: {
      load: (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      save: (key, value) => {
        try {
          localStorage.setItem(key, value);
        } catch {}
      },
    },
  };
}

export class FixedFiveRoomController {
  readonly roomId: string;
  loading = $state(true);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  draftError = $state<string | null>(null);
  reconnecting = $state(false);
  syncing = $state(false);
  roomSnapshot = $state.raw<FixedFiveRoomSnapshot | null>(null);
  commands = $state.raw<FixedFiveRoomSessionSnapshot['commands']>([]);
  replay = $state.raw<DraftReplay | null>(null);
  assets = $state.raw<FixedFiveAssets | null>(null);
  assetsError = $state<string | null>(null);
  selfId = $state<'p1' | 'p2'>('p1');
  lobbyId = $state<string | null>(null);
  simStarted = $state(false);
  simDone = $state(false);
  simError = $state<string | null>(null);
  progress = $state<{
    completed: number;
    total: number;
  } | null>(null);
  simEntries = $state.raw<FixedFiveWorkerResultEntry[]>([]);
  statsEntries = $state.raw<FixedFiveWorkerResultEntry[]>([]);
  statsBuilding = $state(false);
  localResult = $state.raw<FixedFiveLocalResult | null>(null);
  duelBroadcast = $state(false);
  duelOutputs = $state.raw<Record<number, FixedFiveDuelGameOutput>>({});
  duelSimError = $state<string | null>(null);
  duelSimulatingGame = $state<number | null>(null);
  broadcastProgress = $state(0);
  duelVerification = $state<DuelGameVerification>('pending');
  localReady = $state(false);
  opponentReady = $state(false);
  readyCountdownMs = $state<number | null>(null);
  awaitingContinue = $state(false);
  duelRecapGame = $state<number | null>(null);
  receiptsUnsupported = $state(false);
  verificationReceipt = $state.raw<FixedFiveVerificationReceipt | null>(null);
  verificationError = $state<string | null>(null);
  verificationInFlight = $state(false);
  submittedReceipt = $state<string | null>(null);
  submittedPropose = $state<ContentHash | null>(null);
  confirmedFor = $state<ContentHash | null>(null);
  reranMismatch = $state(false);
  mismatchReported = $state(false);
  completeNotReady = $state(false);
  busyAction = $state<string | null>(null);
  leaveBusy = $state(false);
  rematchBusy = $state(false);
  now = $state(Date.now());
  copiedInvite = $state(false);
  copiedCode = $state(false);

  facts = $derived(roomLogFacts(this.commands));
  phase = $derived(
    this.roomSnapshot && this.replay
      ? deriveEffectivePhase(this.roomSnapshot.phase, this.replay, this.simDone)
      : (this.roomSnapshot?.phase ?? 'lobby'),
  );

  display = $derived(
    this.roomSnapshot && this.replay
      ? overlaySnapshotProgress(this.roomSnapshot, this.replay, this.facts)
      : this.roomSnapshot,
  );
  rollAnimation = $derived(
    rollAnimationFor(
      this.commands,
      this.roomSnapshot?.settings.mode ?? 'classic-shared-82',
      this.selfId,
    ),
  );
  presentation = $derived(presentationForVariant(this.roomSnapshot?.settings.variant ?? 'ratings'));
  indexById = $derived.by((): Map<string, PlayersIndexEntry> =>
    this.assets
      ? new Map(this.assets.index.players.map((p) => [p.playerId as string, p]))
      : new Map<string, PlayersIndexEntry>(),
  );
  indexByVersionId = $derived.by((): Map<string, PlayersIndexEntry> =>
    this.assets
      ? new Map(
          this.assets.index.players.map((p) => [
            playerVersionId(p.playerId, p.franchiseId, p.eraId, p.seasonKey),
            p,
          ]),
        )
      : new Map<string, PlayersIndexEntry>(),
  );
  p1ResultRows = $derived.by((): (PlayersIndexEntry | null)[] => this.resultRows('p1'));
  p2ResultRows = $derived.by((): (PlayersIndexEntry | null)[] => this.resultRows('p2'));
  statsSource = $derived(this.statsEntries.length > 0 ? this.statsEntries : this.simEntries);
  playerStats = $derived.by((): FixedFivePlayerStats | null => {
    if (!this.roomSnapshot || this.statsSource.length === 0) return null;
    try {
      return aggregateFixedFivePlayerStats(
        this.roomSnapshot.settings.mode,
        this.statsSource,
        'p1',
        'p2',
      );
    } catch {
      return null;
    }
  });
  statsState = $derived<'ready' | 'building' | 'empty'>(
    this.playerStats ? 'ready' : this.statsBuilding ? 'building' : 'empty',
  );
  duelSeries = $derived(this.roomSnapshot?.series ?? null);
  duelCurrentGameNumber = $derived(this.roomSnapshot?.series?.currentGameNumber ?? null);
  duelBroadcastGame = $derived(this.roomSnapshot?.broadcast?.gameNumber ?? null);
  currentDuelOutput = $derived.by((): FixedFiveDuelGameOutput | null => {
    const gameNumber = this.duelBroadcastGame ?? this.duelRecapGame ?? this.duelCurrentGameNumber;
    if (gameNumber === null) return null;
    return this.duelOutputs[gameNumber] ?? null;
  });
  duelPlayers = $derived.by((): Record<string, GamecastPlayer> => {
    const output = this.currentDuelOutput;
    const mapped: Record<string, GamecastPlayer> = {};
    if (!output) return mapped;
    for (const player of [...output.result.home.players, ...output.result.away.players]) {
      const entry = this.indexById.get(player.playerId);
      if (!entry) continue;
      mapped[player.playerId] = {
        playerId: entry.playerId,
        displayName: entry.displayName,
        seasonKey: entry.seasonKey,
        franchiseId: entry.franchiseId,
        playerExternalId: entry.playerExternalId,
        altIds: entry.altIds,
      };
    }
    return mapped;
  });
  opponent = $derived(this.display?.members.find((m) => m.participantId !== this.selfId) ?? null);
  timeoutMs = $derived(
    this.roomSnapshot ? fixedFiveTimeoutMsForMode(this.roomSnapshot.settings.mode) : 90 * 1000,
  );
  anchorMs = $derived.by(() => {
    const stored = this.sessionDeps.loadActivityAt(this.roomId);
    if (stored) return stored;
    return this.roomSnapshot ? Date.parse(this.roomSnapshot.createdAt) : this.now;
  });
  clockText = $derived.by((): string | null => {
    if (!this.roomSnapshot || this.phase !== 'drafting') return null;
    const deadlineMs = this.roomSnapshot.deadline
      ? Date.parse(this.roomSnapshot.deadline.deadlineAt)
      : this.anchorMs + this.timeoutMs;
    const remaining = deadlineMs - this.now;
    if (remaining <= 0) return 'Time is up · choosing an automatic pick…';
    const total = Math.floor(remaining / 1000);
    return `Pick clock: ${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
  });
  lastAutopick = $derived.by((): { displayName: string; seedPath: string } | null => {
    if (!this.assets) return null;
    const timeouts = this.commands.filter((c) => c.payload.kind === 'timeout-autopick');
    const last = timeouts[timeouts.length - 1];
    if (!last) return null;
    const payload = last.payload;
    if (payload.kind !== 'timeout-autopick') return null;
    const row = payload.playerVersionId
      ? this.assets.index.players.find(
          (p) =>
            playerVersionId(p.playerId, p.franchiseId, p.eraId, p.seasonKey) ===
            payload.playerVersionId,
        )
      : this.assets.index.players.find((p) => p.playerId === payload.playerId);
    return { displayName: row?.displayName ?? payload.playerId, seedPath: payload.seedPath };
  });
  canRematch = $derived(
    this.facts.rematchRequested.p1 &&
      this.facts.rematchRequested.p2 &&
      this.facts.rematchConfirmed.p1 &&
      this.facts.rematchConfirmed.p2 &&
      this.roomSnapshot?.phase === 'completed',
  );
  rematchWaiting = $derived(
    this.facts.rematchRequested[this.selfId] &&
      !this.facts.rematchRequested[this.selfId === 'p1' ? 'p2' : 'p1'],
  );
  rematchLabel = $derived.by((): string => {
    const other = this.selfId === 'p1' ? 'p2' : 'p1';
    return this.canRematch
      ? 'Start rematch'
      : this.facts.rematchRequested[other]
        ? 'Accept rematch'
        : this.facts.rematchRequested[this.selfId]
          ? 'Waiting for opponent'
          : 'Rematch';
  });
  modeDetailLabel = $derived.by((): string => {
    const current = this.roomSnapshot;
    if (!current) return 'Multiplayer';
    const format = current.settings.mode === 'duel' ? 'Duel · Best of 7' : 'Season · 82 games';
    return `${format} · ${current.settings.sourceMode === 'sandbox' ? 'Sandbox' : 'Classic'}`;
  });
  resultVerified = $derived.by((): boolean => {
    if (!this.roomSnapshot || !this.localResult) return false;
    if (this.roomSnapshot.phase === 'completed') return true;
    if (this.receiptsUnsupported)
      return this.roomSnapshot.confirmedDigest === this.localResult.digest;

    return (
      this.verificationReceipt !== null &&
      this.verificationReceipt.resultDigest === this.localResult.digest &&
      this.verificationReceipt.receiptDigest === this.submittedReceipt
    );
  });
  roomName = $derived(this.roomSnapshot?.settings.mode === 'duel' ? 'Duel' : 'Season');
  roomImage = $derived(
    this.roomSnapshot?.settings.mode === 'duel'
      ? '/images/multiplayer/duel.jpg'
      : this.roomSnapshot?.settings.mode === 'sandbox-shared-82'
        ? '/images/multiplayer/sandbox-season.jpg'
        : '/images/multiplayer/shared-season.jpg',
  );
  stageIndex = $derived(
    this.phase === 'lobby' ? 0 : this.phase === 'drafting' ? 1 : this.phase === 'completed' ? 3 : 2,
  );
  phaseLabel = $derived(
    this.phase === 'lobby'
      ? 'Lobby'
      : this.phase === 'drafting'
        ? 'Draft'
        : this.phase === 'simulating'
          ? 'Playing'
          : this.phase === 'preparing-game'
            ? 'Pre-game'
            : this.phase === 'broadcasting'
              ? 'Broadcast'
              : this.phase === 'game-results'
                ? 'Game recap'
                : this.phase === 'awaiting-confirmation'
                  ? 'Checking results'
                  : this.phase === 'completed'
                    ? 'Final'
                    : this.phase === 'expired'
                      ? 'Room expired'
                      : 'Result mismatch',
  );

  private readonly deps: FixedFiveRoomControllerDeps;
  private readonly sessionDeps: FixedFiveRoomSessionDeps;
  private readonly session: FixedFiveRoomSession;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private winPlayed = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackRaf: number | null = null;
  private playbackLastFrameMs = 0;
  private lastBroadcastGame: number | null = null;

  constructor(deps: FixedFiveRoomControllerDeps) {
    this.deps = deps;
    this.roomId = deps.roomId;
    this.sessionDeps = {
      ...defaultSessionDeps(deps.roomId),
      ...deps.session,
    };
    this.session = new FixedFiveRoomSession(this.sessionDeps);
    this.unsubscribe = this.session.subscribe((next) => {
      this.mirror(next);
    });
    this.mirror(this.session.getSnapshot());
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    this.tickTimer = setInterval(() => {
      if (this.disposed) return;
      this.now = Date.now();
    }, TICK_MS);
    await this.session.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.copyTimer !== null) {
      clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    this.stopPlayback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session.dispose();
  }

  async copyInviteLink(): Promise<void> {
    const code = this.roomSnapshot?.code;
    if (!code) return;
    this.error = null;
    try {
      await navigator.clipboard.writeText(
        new URL(`${resolve('multiplayer/')}?code=${code}`, window.location.origin).href,
      );

      if (this.disposed) return;
      this.copiedInvite = true;
      this.scheduleCopyReset('invite');
    } catch {
      if (this.disposed) return;
      this.error = 'Could not copy the invite. Share the room code instead.';
    }
  }

  async copyRoomCode(): Promise<void> {
    const code = this.roomSnapshot?.code;
    if (!code) return;
    this.error = null;
    try {
      await navigator.clipboard.writeText(code);
      if (this.disposed) return;
      this.copiedCode = true;
      this.scheduleCopyReset('code');
    } catch {
      if (this.disposed) return;
      this.error = 'Could not copy the code. You can select and copy the digits below.';
    }
  }

  async startDraft(): Promise<void> {
    await this.session.startDraft();
  }

  async pickPlayer(player: PlayersIndexEntry, slot: SlotIndex): Promise<void> {
    await this.session.pickPlayer(player, slot);
  }

  async reroll(axis: 'franchise' | 'era'): Promise<void> {
    await this.session.reroll(axis);
  }

  async removeSlot(slot: SlotIndex): Promise<void> {
    await this.session.removeSlot(slot);
  }

  async lockLineup(): Promise<void> {
    await this.session.lockLineup();
  }

  retrySimulation(): void {
    this.session.retrySimulation();
  }

  retryDuelGame(): void {
    this.session.retryDuelGame();
  }

  async readyForNextGame(): Promise<void> {
    await this.session.readyForNextGame();
  }

  continueAfterGame(): void {
    this.session.continueAfterGame();
  }

  startPlayback(): void {
    if (this.disposed) return;
    this.stopPlayback();
    this.session.beginPlayback();
    if (typeof requestAnimationFrame !== 'function') return;
    this.playbackLastFrameMs = typeof performance === 'undefined' ? 0 : performance.now();
    const frame = (now: number): void => {
      if (this.disposed) return;
      const delta = Math.max(0, now - this.playbackLastFrameMs);
      this.playbackLastFrameMs = now;
      this.session.advancePlayback(delta);
      if (this.broadcastProgress >= 1) {
        this.stopPlayback();
        return;
      }
      this.playbackRaf = requestAnimationFrame(frame);
    };
    this.playbackRaf = requestAnimationFrame(frame);
  }

  requestStatsRebuild(): void {
    this.session.requestStatsRebuild();
  }

  retryVerification(): void {
    this.session.retryVerification();
  }

  async retryFinishing(): Promise<void> {
    await this.session.retryFinishing();
  }

  async removeGuest(): Promise<void> {
    await this.session.removeGuest();
  }

  async leaveRoom(): Promise<void> {
    const ok = await this.session.leaveRoom();
    if (!ok || this.disposed) return;
    await goto(resolve('multiplayer/'));
  }

  async rematchAction(): Promise<void> {
    const next = await this.session.rematchAction();
    if (!next || this.disposed) return;
    await goto(resolve('/multiplayer/room/[roomId]', { roomId: next.roomId }));
  }

  private mirror(next: FixedFiveRoomSessionSnapshot): void {
    if (this.disposed) return;
    this.loading = next.loading;
    this.error = next.error;
    this.notice = next.notice;
    this.draftError = next.draftError;
    this.reconnecting = next.reconnecting;
    this.syncing = next.syncing;
    this.roomSnapshot = next.room;
    this.commands = next.commands;
    this.replay = next.replay;
    this.assets = next.assets;
    this.assetsError = next.assetsError;
    this.selfId = next.selfId;
    this.lobbyId = next.lobbyId;
    this.simStarted = next.simStarted;
    this.simDone = next.simDone;
    this.simError = next.simError;
    this.progress = next.progress;
    this.simEntries = next.simEntries;
    this.statsEntries = next.statsEntries;
    this.statsBuilding = next.statsBuilding;
    this.localResult = next.localResult;
    this.duelBroadcast = next.duelBroadcast;
    this.duelOutputs = next.duelOutputs;
    this.duelSimError = next.duelSimError;
    this.duelSimulatingGame = next.duelSimulatingGame;
    this.broadcastProgress = next.broadcastProgress;
    this.duelVerification = next.duelVerification;
    this.localReady = next.localReady;
    this.opponentReady = next.opponentReady;
    this.readyCountdownMs = next.readyCountdownMs;
    this.awaitingContinue = next.awaitingContinue;
    this.duelRecapGame = next.duelRecapGame;
    this.receiptsUnsupported = next.receiptsUnsupported;
    this.verificationReceipt = next.verificationReceipt;
    this.verificationError = next.verificationError;
    this.verificationInFlight = next.verificationInFlight;
    this.submittedReceipt = next.submittedReceipt;
    this.submittedPropose = next.submittedPropose;
    this.confirmedFor = next.confirmedFor;
    this.reranMismatch = next.reranMismatch;
    this.mismatchReported = next.mismatchReported;
    this.completeNotReady = next.completeNotReady;
    this.busyAction = next.busyAction;
    this.leaveBusy = next.leaveBusy;
    this.rematchBusy = next.rematchBusy;
    const broadcastGame = next.room?.broadcast?.gameNumber ?? null;
    if (broadcastGame !== null && broadcastGame !== this.lastBroadcastGame) {
      this.lastBroadcastGame = broadcastGame;
      this.startPlayback();
    } else if (broadcastGame === null && this.lastBroadcastGame !== null) {
      this.lastBroadcastGame = null;
      this.stopPlayback();
    }
    if (this.phase === 'completed' && this.localResult && !this.winPlayed) {
      this.winPlayed = true;
      arenaWin();
    }
  }

  private stopPlayback(): void {
    if (this.playbackRaf !== null) {
      cancelAnimationFrame(this.playbackRaf);
      this.playbackRaf = null;
    }
  }

  private resultRows(participant: 'p1' | 'p2'): (PlayersIndexEntry | null)[] {
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    if (!this.localResult) return rows;
    for (const ref of this.localResult[participant].refs) {
      if (ref.slotIndex >= 0 && ref.slotIndex < 5) {
        rows[ref.slotIndex] =
          (ref.playerVersionId ? this.indexByVersionId.get(ref.playerVersionId) : null) ??
          this.indexById.get(ref.playerId) ??
          null;
      }
    }
    return rows;
  }

  private scheduleCopyReset(kind: 'invite' | 'code'): void {
    if (this.copyTimer !== null) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => {
      this.copyTimer = null;
      if (this.disposed) return;
      if (kind === 'invite') this.copiedInvite = false;
      else this.copiedCode = false;
    }, COPY_FEEDBACK_MS);
  }
}
