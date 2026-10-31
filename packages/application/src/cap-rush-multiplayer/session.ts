import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerCommandReceipt,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerPlayoffState,
  CapRushMultiplayerRoomSnapshot,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  CapRushMultiplayerTransport,
  CapRushLeagueGame,
  CapRushPlayoffGameSummary,
} from '@hoop-rush/data-contracts';
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
  readonly now?: () => number;
  readonly scheduleTick?: (tick: () => void, intervalMs: number) => () => void;
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

  async attach(): Promise<void> {
    await this.deps.transport.resume(this.deps.roomId);
    const sync = await this.deps.transport.sync(this.deps.roomId);
    this.adopt(sync.snapshot, sync.commands);
    this.unsubscribe = this.deps.transport.subscribe(
      this.deps.roomId,
      () => {
        void this.refresh();
      },
      (error) => {
        this.error = error.message;
      },
    );
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const last = this.commands[this.commands.length - 1]?.ordinal ?? -1;
    const sync = await this.deps.transport.sync(this.deps.roomId, last);
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

  async ready(ready: boolean): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'ready', ready });
  }

  async start(): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'start' });
  }

  async bid(
    round: number,
    playerId: string,
    totalDollars: number,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'bid', round, playerId, totalDollars });
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
    return this.send({ kind: 'purchase-mutation', purchase, targetPlayerId });
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

  async acceptSlot(
    slot: number,
    games: readonly CapRushLeagueGame[],
  ): Promise<CapRushMultiplayerCommandReceipt> {
    return this.send({ kind: 'accept-slot', slot, games: [...games] });
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
    if (this.snapshot?.rootSeed === null || this.snapshot?.rootSeed === undefined) {
      return false;
    }
    const replayed = replayCapRushMultiplayerLog({
      rootSeed: this.snapshot.rootSeed,
      commands: this.commands,
      environment: this.deps.environment,
    });
    return replayed.stateDigest === capRushMultiplayerStateDigest(this.state);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private adopt(
    snapshot: CapRushMultiplayerRoomSnapshot,
    fetched: readonly CapRushMultiplayerCommand[],
  ): void {
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
