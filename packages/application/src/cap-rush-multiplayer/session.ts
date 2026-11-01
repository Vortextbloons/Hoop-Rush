import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerCommandReceipt,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerPlayoffState,
  CapRushMultiplayerRoomSnapshot,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  CapRushMultiplayerSync,
  CapRushMultiplayerTransport,
  CapRushLeagueGame,
  CapRushPlayoffGameSummary,
} from '@hoop-rush/data-contracts';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import { CoalescedTask, SessionEvents } from '../runtime/index.ts';
import {
  capRushMultiplayerLockDigest,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
  replayCapRushMultiplayerLog,
  type CapRushMultiplayerEnvironment,
} from '@hoop-rush/engine';
import {
  capRushMultiplayerDeadlineOf,
  capRushMultiplayerNextSlot,
  capRushMultiplayerPendingH2H,
} from './recruitment-deadline.ts';

export interface CapRushMultiplayerSessionDeps {
  readonly transport: CapRushMultiplayerTransport;
  readonly environment: CapRushMultiplayerEnvironment;
  readonly roomId: string;
  readonly seat: CapRushMultiplayerSeatId;
  readonly newCommandId: () => string;
  readonly verifyLog?: (input: {
    rootSeed: string;
    commands: readonly CapRushMultiplayerCommand[];
    variant: 'clash' | 'roulette';
  }) => Promise<string>;
  readonly now?: () => number;
  readonly scheduleTick?: (tick: () => void, intervalMs: number) => () => void;
}

export interface CapRushMultiplayerAttachOptions {
  /** Skip the presence resume when the caller already resumed this room. */
  readonly resume?: boolean;
  /** Adopt an already fetched sync instead of issuing another initial read. */
  readonly initialSync?: CapRushMultiplayerSync;
}

export interface CapRushMultiplayerSessionView {
  readonly roomId: string;
  readonly seat: CapRushMultiplayerSeatId;
  readonly snapshot: CapRushMultiplayerRoomSnapshot | null;
  readonly state: CapRushMultiplayerState;
  readonly locked: CapRushMultiplayerLockedInputs | null;
  readonly postseason: CapRushMultiplayerPlayoffState | null;
  readonly error: string | null;
  readonly connected: boolean;
}

export class CapRushMultiplayerSession {
  private readonly events = new SessionEvents<never>();
  private readonly refreshTask = new CoalescedTask(() => this.fetch());
  private snapshot: CapRushMultiplayerRoomSnapshot | null = null;
  private state: CapRushMultiplayerState;
  private commands: CapRushMultiplayerCommand[] = [];
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private readonly deps: CapRushMultiplayerSessionDeps;
  error: string | null = null;

  constructor(deps: CapRushMultiplayerSessionDeps) {
    this.deps = deps;
    this.state = createCapRushMultiplayerState(null);
  }

  async attach(options: CapRushMultiplayerAttachOptions = {}): Promise<void> {
    if (this.isDisposed()) return;
    const initialSync = options.initialSync;
    const resuming = options.resume === false ? null : this.deps.transport.resume(this.deps.roomId);
    if (resuming === null) {
      if (initialSync === undefined) await this.refresh();
    } else if (initialSync === undefined) {
      await Promise.all([resuming, this.refresh()]);
    } else {
      await resuming;
    }
    if (this.isDisposed()) return;
    if (initialSync !== undefined) this.adopt(initialSync.snapshot, initialSync.commands);
    if (this.isDisposed()) return;
    this.unsubscribe?.();
    this.unsubscribe = this.deps.transport.subscribe(
      this.deps.roomId,
      () => {
        void this.refresh(false).catch((error: unknown) => {
          if (this.disposed) return;
          this.error = error instanceof Error ? error.message : 'Could not refresh the room.';
          this.events.publish();
        });
      },
      (error) => {
        if (this.disposed) return;
        this.error = error.message;
        this.events.publish();
      },
    );
  }

  subscribe(listener: () => void): () => void {
    return this.events.subscribe(listener);
  }

  refresh(queueIfRunning = true): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.refreshTask.request(queueIfRunning);
  }

  private async fetch(): Promise<void> {
    if (this.isDisposed()) return;
    const last = this.snapshot === null ? 2_147_483_647 : this.snapshot.commandCount - 1;
    const sync = await this.deps.transport.sync(this.deps.roomId, last);
    if (this.isDisposed()) return;
    this.adopt(sync.snapshot, sync.commands);
  }

  get room(): CapRushMultiplayerRoomSnapshot | null {
    return this.snapshot;
  }

  get current(): CapRushMultiplayerState {
    return this.state;
  }

  get isHost(): boolean {
    return this.deps.seat === 'p1';
  }

  view(): CapRushMultiplayerSessionView {
    return {
      roomId: this.deps.roomId,
      seat: this.deps.seat,
      snapshot: this.snapshot,
      state: this.state,
      locked: this.state.locked,
      postseason: this.state.postseason,
      error: this.error,
      connected: this.snapshot?.members.every((member) => member.online) ?? false,
    };
  }

  async start(): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'start' });
  }

  async bid(
    round: number,
    playerId: string,
    totalDollars: number,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({
      kind: 'bid',
      round,
      playerId: playerIdSchema.parse(playerId),
      totalDollars,
    });
  }

  async endAuctionEarly(round: number, agree: boolean): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'end-auction-early', round, agree });
  }

  async closeDueAuctions(): Promise<CapRushMultiplayerCommandReceipt | null> {
    const receipt = await this.deps.transport.closeDueAuctions(this.deps.roomId);
    await this.refresh();
    return receipt;
  }

  async purchaseMutation(
    purchase: 'standard' | 'surge',
    targetPlayerId: string,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({
      kind: 'purchase-mutation',
      purchase,
      targetPlayerId: playerIdSchema.parse(targetPlayerId),
    });
  }

  async skipMutation(): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'skip-mutation' });
  }

  async confirmLock(): Promise<CapRushMultiplayerCommandReceipt> {
    const digest = capRushMultiplayerLockDigest(this.state);
    if (digest === null) throw new Error('the roster is not ready to lock');
    return this.send({ kind: 'confirm-lock', stateDigest: digest });
  }

  async chooseBlockPlan(
    block: number,
    choice: 'sim' | 'simcast',
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'choose-block-plan', block, choice });
  }

  async simulateRange(
    slot: number,
    throughSlot: number,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'simulate-range', slot, throughSlot });
  }

  async cancelBid(round: number, playerId: string): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'cancel-bid', round, playerId: playerIdSchema.parse(playerId) });
  }

  async simulatePlayoffRound(round: number): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'simulate-playoff-step', round });
  }

  async acceptSlot(
    slot: number,
    games: readonly CapRushLeagueGame[],
    throughSlot?: number,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({
      kind: 'accept-slot',
      slot,
      games: [...games],
      ...(throughSlot === undefined ? {} : { throughSlot }),
    });
  }

  async ackSlot(slot: number): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'ack-slot', slot });
  }

  async ackBroadcast(input: {
    gameId: string;
    cursor: number;
    total: number;
    resolved: boolean;
  }): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'ack-broadcast', ...input });
  }

  async choosePlayoffPlan(
    round: number,
    choice: 'sim' | 'simcast',
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'choose-playoff-plan', round, choice });
  }

  async acceptPlayoffStep(
    round: number,
    games: readonly CapRushPlayoffGameSummary[],
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'accept-playoff-step', round, games: [...games] });
  }

  async ackPlayoffPlayback(input: {
    gameId: string;
    cursor: number;
    total: number;
    resolved: boolean;
  }): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'ack-playoff-playback', ...input });
  }

  async completeLeague(): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'complete-league' });
  }

  async removeGuest(targetParticipantId: CapRushMultiplayerSeatId): Promise<void> {
    await this.deps.transport.removeGuest(this.deps.roomId, targetParticipantId);
    await this.refresh();
  }

  async leave(): Promise<void> {
    await this.deps.transport.leave(this.deps.roomId);
    await this.refresh();
  }

  deadline() {
    return capRushMultiplayerDeadlineOf(this.state);
  }

  nextSlot(): number | null {
    return capRushMultiplayerNextSlot(this.state);
  }

  pendingH2H() {
    return capRushMultiplayerPendingH2H({
      state: this.state,
      locked: this.state.locked,
    });
  }

  async verifyLog(): Promise<boolean> {
    await Promise.resolve();
    if (this.snapshot?.rootSeed === null || this.snapshot?.rootSeed === undefined) {
      return false;
    }
    const history = await this.deps.transport.sync(this.deps.roomId, -1);
    if (this.isDisposed()) return false;
    const expectedDigest = capRushMultiplayerStateDigest(this.state);
    const input = {
      rootSeed: this.snapshot.rootSeed,
      commands: history.commands,
      variant: this.snapshot.settings.variant,
    };
    const digest = this.deps.verifyLog
      ? await this.deps.verifyLog(input)
      : replayCapRushMultiplayerLog({ ...input, environment: this.deps.environment }).stateDigest;
    return !this.isDisposed() && digest === expectedDigest;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.events.dispose();
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private adopt(
    snapshot: CapRushMultiplayerRoomSnapshot,
    fetched: readonly CapRushMultiplayerCommand[],
  ): void {
    if (this.snapshot !== null && snapshot.revision < this.snapshot.revision) return;
    if (this.snapshot !== null && fetched.length === 0 && sameSnapshot(this.snapshot, snapshot)) {
      return;
    }
    this.snapshot = snapshot;
    if (fetched.length > 0) {
      const seen = new Set(this.commands.map((command) => command.commandId));
      const merged = [
        ...this.commands,
        ...fetched.filter((command) => !seen.has(command.commandId)),
      ].sort((left, right) => left.ordinal - right.ordinal);
      this.commands = merged;
    }
    this.state = snapshot.state ?? createCapRushMultiplayerState(snapshot.rootSeed ?? null);
    this.events.publish();
  }

  private async send(
    payload: CapRushMultiplayerCommandPayload,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    const revision = this.snapshot?.revision ?? 0;
    const receipt = await this.deps.transport.submitCommand({
      roomId: this.deps.roomId,
      commandId: this.deps.newCommandId(),
      actorParticipantId: this.deps.seat,
      expectedRevision: revision,
      payload,
    });
    if (!receipt.accepted) {
      this.error = receipt.rejectionCode;
    } else {
      this.error = null;
    }
    await this.refresh();
    return receipt;
  }
}

type SnapshotMember = CapRushMultiplayerRoomSnapshot['members'][number];

function sameMember(left: SnapshotMember, right: SnapshotMember): boolean {
  return (
    left.participantId === right.participantId &&
    left.displayName === right.displayName &&
    left.online === right.online &&
    left.ready === right.ready &&
    left.lastSeenAt === right.lastSeenAt
  );
}

function sameMembers(left: readonly SnapshotMember[], right: readonly SnapshotMember[]): boolean {
  if (left.length !== right.length) return false;
  for (const [index, member] of left.entries()) {
    const other = right[index];
    if (other === undefined || !sameMember(member, other)) return false;
  }
  return true;
}

function sameSnapshot(
  left: CapRushMultiplayerRoomSnapshot,
  right: CapRushMultiplayerRoomSnapshot,
): boolean {
  // Presence can change without a revision bump, so members are compared explicitly.
  return (
    left.roomId === right.roomId &&
    left.code === right.code &&
    left.codeActive === right.codeActive &&
    left.settings.variant === right.settings.variant &&
    left.phase === right.phase &&
    left.revision === right.revision &&
    left.commandCount === right.commandCount &&
    left.rootSeed === right.rootSeed &&
    (left.state === null) === (right.state === null) &&
    left.deadline?.cursor === right.deadline?.cursor &&
    left.deadline?.atIso === right.deadline?.atIso &&
    left.resultDigest === right.resultDigest &&
    left.confirmedDigest === right.confirmedDigest &&
    left.successorRoomId === right.successorRoomId &&
    left.expiresAt === right.expiresAt &&
    left.createdAt === right.createdAt &&
    sameMembers(left.members, right.members)
  );
}
