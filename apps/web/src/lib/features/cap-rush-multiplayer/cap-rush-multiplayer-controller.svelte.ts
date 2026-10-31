import type {
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  CapRushPlayoffGameSummary,
} from '@hoop-rush/data-contracts';
import {
  CapRushMultiplayerSession,
  type CapRushMultiplayerSessionView,
} from '@hoop-rush/application/cap-rush-multiplayer';
import {
  capRushMultiplayerCurrentRound,
  capRushMultiplayerPlayoffPlans,
  createEngineContext,
  simulateCapRushMultiplayerPlayoffGame,
} from '@hoop-rush/engine';
import { newSeasonId } from '#lib/ids.js';
import { getCapRushMultiplayerData } from './cap-rush-multiplayer-assets.js';
import { getCapRushMultiplayerTransport } from './cap-rush-multiplayer-transport.js';
import { CapRushMultiplayerRunner } from './cap-rush-multiplayer-runner.js';

const POLL_MS = 1_000;

export class CapRushMultiplayerController {
  view = $state<CapRushMultiplayerSessionView | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  nowMs = $state(Date.now());
  loading = $state(true);

  private session: CapRushMultiplayerSession | null = null;
  private readonly runner = new CapRushMultiplayerRunner();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  get state(): CapRushMultiplayerState | null {
    return this.view?.state ?? null;
  }

  get seat(): CapRushMultiplayerSeatId {
    return this.view?.seat ?? 'p1';
  }

  get isHost(): boolean {
    return this.seat === 'p1';
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const [data, transport] = await Promise.all([
        getCapRushMultiplayerData(),
        getCapRushMultiplayerTransport(),
      ]);
      const membership = await transport.resume(this.roomId);
      this.session = new CapRushMultiplayerSession({
        transport,
        environment: data.environment,
        roomId: this.roomId,
        seat: membership.participantId,
        newCommandId: () => newSeasonId('cap-rush-mp-cmd'),
      });
      await this.session.attach();
      this.sync();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open the room.';
    } finally {
      this.loading = false;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.nowMs = Date.now();
      void this.tick();
    }, POLL_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.runner.dispose();
    this.session?.dispose();
  }

  async readiness(): Promise<void> {
    const state = this.state;
    if (state === null) return;
    await this.run(() => this.session?.ready(!state.ready[this.seat]));
  }

  async startLeague(): Promise<void> {
    await this.run(() => this.session?.start());
  }

  async bid(playerId: string, totalDollars: number): Promise<void> {
    const state = this.state;
    const round = state?.recruitment ? state.recruitment.roundIndex : null;
    if (round === null) return;
    await this.run(() => this.session?.bid(round, playerId, totalDollars));
  }

  async chooseBlock(choice: 'sim' | 'simcast'): Promise<void> {
    const state = this.state;
    if (state?.season === null || state?.season === undefined) return;
    await this.run(() => this.session?.chooseBlockPlan(state.season?.block.index ?? 0, choice));
  }

  async skipMutation(): Promise<void> {
    await this.run(() => this.session?.skipMutation());
  }

  async purchaseMutation(purchase: 'standard' | 'surge', targetPlayerId: string): Promise<void> {
    await this.run(() => this.session?.purchaseMutation(purchase, targetPlayerId));
  }

  async confirmLock(): Promise<void> {
    await this.run(() => this.session?.confirmLock());
  }

  async simulateNextSlot(): Promise<void> {
    await this.run(async () => {
      const session = this.session;
      const state = this.state;
      if (session === null || state === null || state.locked === null || state.season === null) {
        return;
      }
      if (!this.isHost) return;
      const slot = session.nextSlot();
      if (slot === null) return;
      const h2h = new Set(state.season.h2hSlots);
      const tapeGameIds: string[] = [];
      if (h2h.has(slot)) {
        const ids = [
          state.locked.seats.p1.franchise.franchiseId,
          state.locked.seats.p2.franchise.franchiseId,
        ];
        const game = state.season.games.find(
          (entry) =>
            entry.slot === slot && ids.includes(entry.homeTeamId) && ids.includes(entry.awayTeamId),
        );
        if (game !== undefined) tapeGameIds.push(game.gameId);
      }
      const output = await this.runner.simulateSlot({
        roomId: this.roomId,
        locked: state.locked,
        slot,
        tapeGameIds,
      });
      await session.acceptSlot(slot, output.games);
      if (!h2h.has(slot)) await session.ackSlot(slot);
    });
  }

  async ackSlot(): Promise<void> {
    await this.run(async () => {
      const session = this.session;
      const state = this.state;
      if (session === null || state?.season === null || state?.season === undefined) return;
      const accepted = state.season.games.reduce(
        (highest, game) => Math.max(highest, game.slot),
        0,
      );
      if (state.season.slotAcks[this.seat] < accepted) {
        await session.ackSlot(state.season.slotAcks[this.seat] + 1);
      }
    });
  }

  async finishBroadcast(gameId: string): Promise<void> {
    await this.run(async () => {
      const session = this.session;
      const state = this.state;
      if (session === null || state?.season === null || state?.season === undefined) return;
      await session.ackBroadcast({ gameId, cursor: 1, total: 1, resolved: true });
      const game = state.season.games.find((entry) => entry.gameId === gameId);
      if (game !== undefined) await session.ackSlot(game.slot);
    });
  }

  async choosePlayoffPlan(choice: 'sim' | 'simcast'): Promise<void> {
    const state = this.state;
    if (state?.postseason === null || state?.postseason === undefined) return;
    await this.run(() =>
      this.session?.choosePlayoffPlan(
        capRushMultiplayerCurrentRound(state.postseason as NonNullable<typeof state.postseason>),
        choice,
      ),
    );
  }

  async simulatePlayoffStep(): Promise<void> {
    await this.run(async () => {
      const session = this.session;
      const state = this.state;
      if (session === null || state?.postseason === null || state?.postseason === undefined) {
        return;
      }
      if (state.locked === null || !this.isHost) return;
      const plans = capRushMultiplayerPlayoffPlans({
        locked: state.locked,
        state: state.postseason,
      });
      if (plans.length === 0) return;
      const round = capRushMultiplayerCurrentRound(state.postseason);
      const context = createEngineContext();
      const games: CapRushPlayoffGameSummary[] = plans.map(
        (entry) =>
          simulateCapRushMultiplayerPlayoffGame({
            locked: state.locked as NonNullable<typeof state.locked>,
            plan: entry.plan,
            context,
          }).game,
      );
      await session.acceptPlayoffStep(round, games);
    });
  }

  async completeLeague(): Promise<void> {
    await this.run(() => this.session?.completeLeague());
  }

  async leave(): Promise<void> {
    await this.run(() => this.session?.leave());
  }

  private async tick(): Promise<void> {
    if (this.disposed || this.busy || this.session === null) return;
    const state = this.state;
    if (state?.phase === 'recruiting') {
      const deadline = this.session.deadline();
      if (deadline !== null && Date.parse(deadline.atIso) <= this.nowMs) {
        await this.run(() => this.session?.closeDueAuctions());
        return;
      }
    }
    try {
      await this.session.refresh();
      this.sync();
    } catch {
      // The transport surfaces its own connection error.
    }
  }

  private async run(action: () => Promise<unknown> | undefined): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.error = null;
    try {
      await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The room rejected that action.';
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  private sync(): void {
    this.view = this.session?.view() ?? null;
    if (this.view?.error) this.error = this.view.error;
  }
}
