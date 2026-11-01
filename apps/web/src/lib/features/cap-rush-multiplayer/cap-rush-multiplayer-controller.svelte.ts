import type {
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerPhase,
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
import { loadCapRushArt, type CapRushArt } from '../cap-rush/cap-rush-art.js';
import { getCapRushMultiplayerData } from './cap-rush-multiplayer-assets.js';
import { commandErrorLabel, type CapRushBidAttempt } from './cap-rush-multiplayer-presentation.js';
import { getCapRushMultiplayerTransport } from './cap-rush-multiplayer-transport.js';
import { CapRushMultiplayerRunner } from './cap-rush-multiplayer-runner.js';

const POLL_MS = 1_000;

export interface CapRushBroadcastState {
  readonly gameId: string;
  readonly speed: 2 | 4;
  readonly kind: 'h2h' | 'season-simcast' | 'playoff' | 'review';
  readonly slot: number | null;
  readonly input: HavocBattleInput;
  readonly result: HavocBattleResult;
  readonly tape: HavocBattleTape;
}

export type { CapRushBidAttempt };

export class CapRushMultiplayerController {
  view = $state.raw<CapRushMultiplayerSessionView | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  nowMs = $state(Date.now());
  loading = $state(true);
  art = $state.raw<CapRushArt | null>(null);
  bidAttempt = $state.raw<CapRushBidAttempt | null>(null);
  franchiseReveal = $state(false);
  broadcast = $state.raw<CapRushBroadcastState | null>(null);
  broadcastLoading = $state(false);

  private session: CapRushMultiplayerSession | null = null;
  private readonly runner = new CapRushMultiplayerRunner();
  private timer: ReturnType<typeof setInterval> | null = null;
  private followUpTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private roomId: string;
  private lastPhase: CapRushMultiplayerPhase | null = null;
  private suppressedError: string | null = null;

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
    if (this.isDisposed()) return;
    this.loading = true;
    try {
      const dataPromise = getCapRushMultiplayerData();
      // Keep a rejected asset load from surfacing before presence finishes; it is awaited below.
      void dataPromise.catch(() => {});
      void loadCapRushArt()
        .then((art) => {
          if (!this.isDisposed()) this.art = art;
        })
        .catch(() => {
          // Presentation art is optional; the room still runs without it.
        });
      const transport = getCapRushMultiplayerTransport();
      const membership = await transport.resume(this.roomId);
      if (this.isDisposed()) return;
      const [data, initialSync] = await Promise.all([dataPromise, transport.sync(this.roomId)]);
      if (this.isDisposed()) return;
      this.session = new CapRushMultiplayerSession({
        transport,
        environment: data.environment,
        roomId: this.roomId,
        seat: membership.participantId,
        newCommandId: () => newSeasonId('cap-rush-mp-cmd'),
      });
      this.session.subscribe(() => {
        this.sync();
      });
      await this.session.attach({ resume: false, initialSync });
      if (this.isDisposed()) return;
      this.sync();
      void this.tick();
    } catch (error) {
      if (this.isDisposed()) return;
      this.error = error instanceof Error ? error.message : 'Could not open the room.';
    } finally {
      if (!this.isDisposed()) this.loading = false;
    }
  }

  start(): void {
    if (this.disposed || this.timer !== null) return;
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
    if (this.followUpTimer !== null) {
      clearTimeout(this.followUpTimer);
      this.followUpTimer = null;
    }
    this.runner.dispose();
    this.session?.dispose();
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  async startLeague(): Promise<void> {
    await this.run(() => this.session?.start());
  }

  async placeBid(input: {
    readonly round: number;
    readonly playerId: string;
    readonly totalDollars: number;
  }): Promise<boolean> {
    if (this.busy || this.isDisposed() || this.session === null) return false;
    this.suppressedError = null;
    this.bidAttempt = { ...input, state: 'pending', code: null };
    this.busy = true;
    this.error = null;
    try {
      const receipt = await this.session.bid(input.round, input.playerId, input.totalDollars);
      if (receipt.accepted) {
        this.bidAttempt = null;
        return true;
      }
      this.bidAttempt = { ...input, state: 'rejected', code: receipt.rejectionCode };
      return false;
    } catch (error) {
      this.bidAttempt = { ...input, state: 'rejected', code: 'connection' };
      if (!this.isDisposed()) {
        this.error = error instanceof Error ? error.message : 'Could not place the bid. Try again.';
      }
      return false;
    } finally {
      if (!this.isDisposed()) {
        this.busy = false;
        this.sync();
      }
    }
  }

  async endAuctionEarly(round: number, agree: boolean): Promise<void> {
    await this.run(() => this.session?.endAuctionEarly(round, agree));
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
      const nextH2H = state.season.h2hSlots.find((entry) => entry >= slot);
      const throughSlot = Math.min(
        slot + 4,
        state.season.block.endpoint,
        nextH2H === slot ? slot : (nextH2H ?? 83) - 1,
      );
      const output = await this.runner.simulateSlot({
        roomId: this.roomId,
        locked: state.locked,
        slot,
        throughSlot,
        tapeGameIds: [],
      });
      await session.acceptSlot(slot, output.games, throughSlot);
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

  async reviewGame(gameId: string): Promise<void> {
    const state = this.state;
    const entry = state?.locked?.leagueSchedule.find((candidate) => candidate.gameId === gameId);
    const game = state?.season?.games.find((candidate) => candidate.gameId === gameId);
    if (entry === undefined || game === undefined) return;
    await this.loadTape({ gameId, kind: 'review', speed: 4, entry });
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
    if (broadcast.kind === 'review') {
      this.broadcast = null;
      return;
    }
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

  dismissBidAttempt(): void {
    this.suppressedError = this.session?.error ?? null;
    this.bidAttempt = null;
    this.error = null;
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
    if (
      this.isDisposed() ||
      this.busy ||
      this.broadcastLoading ||
      locked === null ||
      locked === undefined
    )
      return;
    this.broadcastLoading = true;
    this.error = null;
    try {
      const output = await this.runner.tapeForGame({
        roomId: this.roomId,
        locked,
        ...(input.entry === undefined ? {} : { entry: input.entry }),
        ...(input.plan === undefined ? {} : { plan: input.plan }),
      });
      if (this.isDisposed()) return;
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
      if (this.isDisposed()) return;
      this.error = error instanceof Error ? error.message : 'Could not load the broadcast.';
    } finally {
      if (!this.isDisposed()) this.broadcastLoading = false;
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
    const progressed = await this.advance();
    if (progressed && !this.isDisposed()) this.scheduleFollowUp();
  }

  private scheduleFollowUp(): void {
    if (this.disposed || this.followUpTimer !== null) return;
    this.followUpTimer = setTimeout(() => {
      this.followUpTimer = null;
      void this.tick();
    }, 0);
  }

  private async advance(): Promise<boolean> {
    const state = this.state;
    if (state?.phase === 'recruiting') {
      const deadline = this.session?.deadline() ?? null;
      if (deadline !== null && Date.parse(deadline.atIso) <= this.nowMs) {
        const before = this.revision();
        await this.run(() => this.session?.closeDueAuctions());
        return this.revision() > before;
      }
    }
    if (state?.phase === 'season' && state.season !== null) {
      const season = state.season;
      if (season.block.status === 'choosing' && season.block.plans[this.seat] === null) {
        return this.progressed(() => this.chooseBlock('sim'));
      }
      const pending = this.session?.pendingH2H() ?? null;
      if (pending !== null) {
        if (pending.missing.includes(this.seat) && this.broadcast === null) {
          await this.watchHeadToHead(pending.gameId);
        }
        return false;
      }
      const accepted = season.games.reduce((highest, game) => Math.max(highest, game.slot), 0);
      if (season.slotAcks[this.seat] < accepted) {
        return this.progressed(() => this.ackSlot());
      }
      if (this.isHost && season.block.status === 'running' && this.session?.nextSlot() !== null) {
        return this.progressed(() => this.simulateNextSlot());
      }
    }
    try {
      await this.session?.refresh(false);
    } catch {
      // The transport surfaces its own connection error.
    }
    return false;
  }

  private revision(): number {
    return this.session?.room?.revision ?? -1;
  }

  private async progressed(action: () => Promise<void>): Promise<boolean> {
    const before = this.revision();
    await action();
    if (this.disposed) return false;
    return this.revision() > before;
  }

  private async run(action: () => Promise<unknown> | undefined): Promise<void> {
    if (this.busy || this.isDisposed()) return;
    this.busy = true;
    this.bidAttempt = null;
    this.suppressedError = null;
    this.error = null;
    try {
      await action();
    } catch (error) {
      if (this.isDisposed()) return;
      this.error = error instanceof Error ? error.message : 'The room rejected that action.';
    } finally {
      if (!this.isDisposed()) {
        this.busy = false;
        this.sync();
      }
    }
  }

  private sync(): void {
    if (this.disposed) return;
    this.view = this.session?.view() ?? null;
    const phase = this.view?.state.phase ?? null;
    if (phase !== null) {
      if (phase === 'recruiting' && this.lastPhase === 'lobby') this.franchiseReveal = true;
      else if (phase !== 'recruiting') this.franchiseReveal = false;
      this.lastPhase = phase;
    }
    const viewError = this.view?.error ?? null;
    if (viewError === null) return;
    if (this.bidAttempt !== null || viewError === this.suppressedError) {
      this.error = null;
      return;
    }
    this.error = commandErrorLabel(viewError);
  }
}
