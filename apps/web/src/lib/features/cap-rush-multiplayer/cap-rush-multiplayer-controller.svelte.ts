import type {
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  CapRushPlayoffGamePlan,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
} from '@hoop-rush/data-contracts';
import {
  CapRushMultiplayerSession,
  type CapRushMultiplayerSessionView,
} from '@hoop-rush/application/cap-rush-multiplayer';
import { capRushMultiplayerCurrentRound, capRushMultiplayerPlayoffPlans } from '@hoop-rush/engine';
import { newSeasonId } from '#lib/ids.js';
import { getCapRushMultiplayerData } from './cap-rush-multiplayer-assets.js';
import { getCapRushMultiplayerTransport } from './cap-rush-multiplayer-transport.js';
import { CapRushMultiplayerRunner } from './cap-rush-multiplayer-runner.js';

const POLL_MS = 1_000;

export interface CapRushBroadcastState {
  readonly gameId: string;
  readonly speed: 2 | 4;
  readonly kind: 'h2h' | 'season-simcast' | 'playoff';
  readonly slot: number | null;
  readonly input: HavocBattleInput;
  readonly result: HavocBattleResult;
  readonly tape: HavocBattleTape;
}

export class CapRushMultiplayerController {
  view = $state<CapRushMultiplayerSessionView | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  nowMs = $state(Date.now());
  loading = $state(true);
  broadcast = $state<CapRushBroadcastState | null>(null);
  broadcastLoading = $state(false);

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
      const data = await getCapRushMultiplayerData();
      const transport = getCapRushMultiplayerTransport();
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
      const output = await this.runner.simulateSlot({
        roomId: this.roomId,
        locked: state.locked,
        slot,
        tapeGameIds: [],
      });
      await session.acceptSlot(slot, output.games);
      const plan = state.season.block.plans.p1;
      if (!h2h.has(slot) && plan !== 'simcast') await session.ackSlot(slot);
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
      const output = await this.runner.simulatePlayoffStep({
        roomId: this.roomId,
        locked: state.locked,
        plans: plans.map((entry) => entry.plan),
        tapeGameIds: [],
      });
      await session.acceptPlayoffStep(round, output.games);
    });
  }

  async watchHeadToHead(gameId: string): Promise<void> {
    const state = this.state;
    const entry = state?.locked?.leagueSchedule.find((candidate) => candidate.gameId === gameId);
    const game = state?.season?.games.find((candidate) => candidate.gameId === gameId);
    if (entry === undefined || game === undefined) return;
    await this.loadTape({
      gameId,
      kind: 'h2h',
      speed: 2,
      slot: game.slot,
      entry,
    });
  }

  async watchOwnGame(): Promise<void> {
    const state = this.state;
    const locked = state?.locked;
    const season = state?.season;
    if (locked === null || locked === undefined || season === null || season === undefined) return;
    const slot = season.slotAcks[this.seat] + 1;
    const teamId = locked.seats[this.seat].franchise.franchiseId;
    const game = season.games.find(
      (candidate) =>
        candidate.slot === slot &&
        (candidate.homeTeamId === teamId || candidate.awayTeamId === teamId),
    );
    if (game === undefined) return;
    const entry = locked.leagueSchedule.find((candidate) => candidate.gameId === game.gameId);
    if (entry === undefined) return;
    await this.loadTape({
      gameId: game.gameId,
      kind: 'season-simcast',
      speed: 4,
      slot,
      entry,
    });
  }

  async watchPlayoffGame(): Promise<void> {
    const state = this.state;
    if (state === null || state.locked === null || state.postseason === null) {
      return;
    }
    const plans = capRushMultiplayerPlayoffPlans({
      locked: state.locked,
      state: state.postseason,
    });
    const entry = plans.find((candidate) => candidate.seat === this.seat) ?? plans[0];
    if (entry === undefined) return;
    await this.loadTape({
      gameId: `crp-${String(entry.plan.round)}-${String(entry.plan.seriesSlot)}-${String(entry.plan.gameOrdinal)}`,
      kind: 'playoff',
      speed: entry.plan.round === 4 && entry.seat !== null ? 2 : 4,
      plan: entry.plan,
    });
  }

  async completeBroadcast(): Promise<void> {
    const broadcast = this.broadcast;
    if (broadcast === null) return;
    const total = broadcast.tape.events.length + broadcast.tape.scoring.length;
    await this.run(async () => {
      const session = this.session;
      if (session === null) return;
      if (broadcast.kind === 'h2h') {
        await session.ackBroadcast({
          gameId: broadcast.gameId,
          cursor: total,
          total,
          resolved: true,
        });
        if (broadcast.slot !== null) await session.ackSlot(broadcast.slot);
        return;
      }
      if (broadcast.kind === 'season-simcast') {
        if (broadcast.slot !== null) await session.ackSlot(broadcast.slot);
        return;
      }
      await session.ackPlayoffPlayback({
        gameId: broadcast.gameId,
        cursor: total,
        total,
        resolved: true,
      });
    });
    this.broadcast = null;
  }

  closeBroadcast(): void {
    this.broadcast = null;
  }

  private async loadTape(input: {
    readonly gameId: string;
    readonly kind: CapRushBroadcastState['kind'];
    readonly speed: 2 | 4;
    readonly slot?: number;
    readonly entry?: CapRushLeagueScheduleEntry;
    readonly plan?: CapRushPlayoffGamePlan;
  }): Promise<void> {
    const locked = this.state?.locked;
    if (locked === null || locked === undefined) return;
    this.broadcastLoading = true;
    this.error = null;
    try {
      const output = await this.runner.tapeForGame({
        roomId: this.roomId,
        locked,
        ...(input.entry === undefined ? {} : { entry: input.entry }),
        ...(input.plan === undefined ? {} : { plan: input.plan }),
      });
      this.broadcast = {
        gameId: output.gameId,
        speed: input.speed,
        kind: input.kind,
        slot: input.slot ?? null,
        input: output.input,
        result: output.result,
        tape: output.tape,
      };
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the broadcast.';
    } finally {
      this.broadcastLoading = false;
    }
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
