import type {
  FixedFiveCompetitionRun,
  FixedFiveShared82H2HGameOutput,
  FixedFiveWorkerResultEntry,
  FixedFiveWorkerTeam,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  assembleCompetitionRun,
  computeCompetitionDigest,
  findWeakestOpponent,
  h2hGameNumbersFor,
  summarizeWorkerEntries,
  type FixedFivePickRef,
} from '@hoop-rush/engine';
import { FixedFiveSimulationGate, type FixedFiveSimulationReason } from './simulation-gate.ts';
import { refsForParticipant } from './pick-refs.ts';
import type {
  FixedFiveFlowContext,
  FixedFiveLocalResult,
  FixedFiveRoomSessionDeps,
  FixedFiveRoomSessionSnapshot,
  FixedFiveRunnerPort,
} from './session.ts';

const SIM_SHOWDOWN_MIN_MS = 7000;
const SIM_SHOWDOWN_REDUCED_MS = 400;

type CompetitionSnapshot = Pick<
  FixedFiveRoomSessionSnapshot,
  | 'simStarted'
  | 'simDone'
  | 'simError'
  | 'progress'
  | 'simEntries'
  | 'revealedEntries'
  | 'revealedThroughGameNumber'
  | 'statsEntries'
  | 'statsBuilding'
  | 'localResult'
>;

interface CompetitionHost {
  context(): FixedFiveFlowContext;
  isDisposed(): boolean;
  publish(): void;
  recomputePhase(): void;
  runAutoFlows(): void;
  shared82H2HGame(output: FixedFiveShared82H2HGameOutput): void;
  resetVerification(): void;
  sync(): Promise<void>;
}

interface SimulationContext {
  p1Refs: FixedFivePickRef[];
  p2Refs: FixedFivePickRef[];
  p1Team: FixedFiveWorkerTeam;
  p2Team: FixedFiveWorkerTeam;
}

export class FixedFiveCompetitionFlow {
  private readonly simulationGate = new FixedFiveSimulationGate();
  private simulationReason: FixedFiveSimulationReason = 'initial';
  private simStarted = false;
  private simStartAt = 0;
  private simDone = false;
  private simError: string | null = null;
  private progress: { completed: number; total: number } | null = null;
  private simEntries: FixedFiveWorkerResultEntry[] = [];
  private revealedThroughGameNumber = 0;
  private pendingRun: FixedFiveCompetitionRun | null = null;
  private seasonResult: FixedFiveLocalResult | null = null;
  private seasonWorkerComplete = false;
  private statsEntries: FixedFiveWorkerResultEntry[] = [];
  private statsState: 'idle' | 'requested' | 'running' | 'settled' = 'idle';
  private localResult: FixedFiveLocalResult | null = null;
  private runner: FixedFiveRunnerPort | null = null;
  private statsRunner: FixedFiveRunnerPort | null = null;

  private readonly deps: Pick<
    FixedFiveRoomSessionDeps,
    'roomId' | 'repository' | 'createRunner' | 'buildTeam' | 'now' | 'prefersReducedMotion'
  >;
  private readonly host: CompetitionHost;

  constructor(
    deps: Pick<
      FixedFiveRoomSessionDeps,
      'roomId' | 'repository' | 'createRunner' | 'buildTeam' | 'now' | 'prefersReducedMotion'
    >,
    host: CompetitionHost,
  ) {
    this.deps = deps;
    this.host = host;
  }

  private get roomId() {
    return this.deps.roomId;
  }
  private get room() {
    return this.host.context().room;
  }
  private get assets() {
    return this.host.context().assets;
  }
  private get replay() {
    return this.host.context().replay;
  }
  private get commands() {
    return this.host.context().commands;
  }
  private get selfId() {
    return this.host.context().selfId;
  }
  private get phase() {
    return this.host.context().phase;
  }

  getSnapshot(): CompetitionSnapshot {
    return {
      simStarted: this.simStarted,
      simDone: this.simDone,
      simError: this.simError,
      progress: this.progress,
      simEntries: this.simEntries,
      revealedEntries: this.simEntries.filter(
        (entry) => entry.game.gameNumber <= this.revealedThroughGameNumber,
      ),
      revealedThroughGameNumber: this.revealedThroughGameNumber,
      statsEntries: this.statsEntries,
      statsBuilding: this.statsState === 'running',
      localResult: this.localResult,
    };
  }

  dispose(): void {
    this.stopSimulation();
    this.statsRunner?.dispose();
    this.statsRunner = null;
  }

  stopSimulation(): void {
    this.runner?.dispose();
    this.runner = null;
  }

  setDuelEntries(entries: FixedFiveWorkerResultEntry[]): void {
    this.simEntries = entries;
    this.progress = { completed: entries.length, total: 7 };
  }

  acceptDuelResult(result: FixedFiveLocalResult): void {
    this.localResult = result;
    this.simDone = true;
  }

  setError(message: string): void {
    this.simError = message;
  }

  retry(): void {
    if (this.host.isDisposed()) return;
    this.simStarted = false;
    this.simError = null;
    this.host.publish();
    this.maybeStart();
  }

  requestStatsRebuild(): void {
    if (this.statsState !== 'running') this.statsState = 'requested';
    void this.rebuildStatsEntries();
  }

  maybeStart(): void {
    if (this.host.isDisposed()) return;
    const shared82 = this.room?.settings.mode !== 'duel';
    const canSimulate =
      this.phase === 'simulating' ||
      (shared82 && (this.phase === 'broadcasting' || this.phase === 'game-results'));
    if (canSimulate && !this.simStarted && !this.simError && this.room?.rootSeed) {
      void this.startSimulation(this.simulationReason);
    }
  }

  advanceSeasonReveal(): number | null {
    const room = this.room;
    const assets = this.assets;
    if (!room || room.settings.mode === 'duel' || !assets) return null;
    const gameNumbers = h2hGameNumbersFor(
      assets.bracket,
      findWeakestOpponent(assets.bracket).opponentId,
    );
    const lastCompleted = room.seasonBroadcast?.lastCompletedGameNumber ?? 0;
    const activeGameNumber = room.broadcast?.gameNumber ?? null;
    const before = this.revealedThroughGameNumber;
    if (activeGameNumber !== null) {
      this.advanceRevealThrough(activeGameNumber - 1, gameNumbers);
      if (before !== this.revealedThroughGameNumber) this.host.publish();
      return activeGameNumber;
    }
    this.advanceRevealThrough(lastCompleted, gameNumbers);
    let h2hTarget: number | null = null;
    for (let count = 0; count < 4 && this.revealedThroughGameNumber < 82; count += 1) {
      const gameNumber = this.revealedThroughGameNumber + 1;
      if (gameNumbers.includes(gameNumber) && gameNumber > lastCompleted) {
        h2hTarget = gameNumber;
        break;
      }
      if (!this.hasCompleteEntry(gameNumber, gameNumbers)) break;
      this.revealedThroughGameNumber = gameNumber;
    }
    if (before !== this.revealedThroughGameNumber) {
      this.finishShared82IfReady();
      this.host.publish();
    }
    return h2hTarget;
  }

  revealSeasonBroadcast(gameNumber: number): void {
    if (this.host.isDisposed()) return;
    const room = this.room;
    const assets = this.assets;
    if (!room || room.settings.mode === 'duel' || !assets) return;
    const gameNumbers = h2hGameNumbersFor(
      assets.bracket,
      findWeakestOpponent(assets.bracket).opponentId,
    );
    this.advanceRevealThrough(gameNumber, gameNumbers);
    this.finishShared82IfReady();
    this.host.publish();
  }

  private advanceRevealThrough(targetGameNumber: number, h2hGameNumbers: number[]): void {
    while (this.revealedThroughGameNumber < targetGameNumber) {
      const gameNumber = this.revealedThroughGameNumber + 1;
      if (!this.hasCompleteEntry(gameNumber, h2hGameNumbers)) return;
      this.revealedThroughGameNumber = gameNumber;
    }
  }

  private hasCompleteEntry(gameNumber: number, h2hGameNumbers: number[]): boolean {
    const entryCount = this.simEntries.filter(
      (entry) => entry.game.gameNumber === gameNumber,
    ).length;
    return entryCount >= (h2hGameNumbers.includes(gameNumber) ? 1 : 2);
  }

  maybeRebuildStats(): void {
    if (!this.localResult || !this.room) return;
    if (this.phase !== 'awaiting-confirmation' && this.phase !== 'completed') return;
    if (this.statsSource().length > 0 || this.statsState !== 'idle') return;
    this.statsState = 'requested';
    void this.rebuildStatsEntries();
  }

  private statsSource(): FixedFiveWorkerResultEntry[] {
    return this.statsEntries.length > 0 ? this.statsEntries : this.simEntries;
  }

  private async startSimulation(reason: FixedFiveSimulationReason): Promise<void> {
    if (this.host.isDisposed()) return;
    if (this.simStarted || !this.room || !this.assets || !this.room.rootSeed || !this.replay)
      return;
    if (!this.simulationGate.tryStart(reason)) return;
    this.simStarted = true;
    this.simError = null;
    this.host.publish();
    try {
      const room = this.room;
      const assets = this.assets;
      const replay = this.replay;
      if (!room.rootSeed) throw new Error('the room is not ready to simulate');
      const rootSeed: Seed = room.rootSeed;
      const p1Refs = refsForParticipant(replay, assets, 'p1');
      const p2Refs = refsForParticipant(replay, assets, 'p2');
      if (p1Refs.length !== 5 || p2Refs.length !== 5) {
        throw new Error('both lineups must be complete before simulating');
      }
      const pending = await this.deps.repository.loadPendingResult(this.roomId).catch(() => null);
      const p1Team: FixedFiveWorkerTeam = await this.deps.buildTeam(
        assets.manifest,
        'p1',
        'Player 1',
        p1Refs,
      );
      if (this.host.isDisposed()) return;
      const p2Team: FixedFiveWorkerTeam = await this.deps.buildTeam(
        assets.manifest,
        'p2',
        'Player 2',
        p2Refs,
      );
      if (this.host.isDisposed()) return;
      if (pending) {
        this.pendingRun = pending.run;
        const pendingResult: FixedFiveLocalResult = {
          result: pending.run.result,
          digest: pending.run.resultDigest,
          p1: { refs: p1Refs, players: [...p1Team.players] },
          p2: { refs: p2Refs, players: [...p2Team.players] },
          weakestReplacedOpponentId: pending.run.authorityFacts.weakestReplacedOpponentId,
        };
        const h2hGameNumbers =
          room.settings.mode === 'duel'
            ? []
            : h2hGameNumbersFor(assets.bracket, findWeakestOpponent(assets.bracket).opponentId);
        const broadcastsComplete =
          h2hGameNumbers.length > 0 &&
          h2hGameNumbers.every(
            (gameNumber) => gameNumber <= (room.seasonBroadcast?.lastCompletedGameNumber ?? 0),
          );
        if (room.settings.mode === 'duel' || (room.broadcast === null && broadcastsComplete)) {
          this.localResult = pendingResult;
          if (room.settings.mode !== 'duel') this.revealedThroughGameNumber = 82;
          this.simulationGate.finish();
          this.simDone = true;
          this.host.recomputePhase();
          this.host.publish();
          this.host.runAutoFlows();
          return;
        }
      }
      this.simEntries = [];
      this.seasonResult = null;
      this.seasonWorkerComplete = false;
      this.revealedThroughGameNumber = Math.max(
        this.revealedThroughGameNumber,
        room.seasonBroadcast?.lastCompletedGameNumber ?? 0,
      );
      this.progress = { completed: 0, total: room.settings.mode === 'duel' ? 7 : 161 };
      this.simStartAt = this.deps.now();
      this.host.publish();
      const simulationContext: SimulationContext = { p1Refs, p2Refs, p1Team, p2Team };
      const active = this.deps.createRunner((event) => {
        if (this.host.isDisposed()) return;
        if (event.kind === 'progress') {
          this.progress = { completed: event.completedGames, total: event.totalGames };
          this.host.publish();
        } else if (event.kind === 'results') {
          this.simEntries = [...this.simEntries, ...event.entries];
          this.progress = {
            completed: this.simEntries.length,
            total: this.progress?.total ?? this.simEntries.length,
          };
          this.host.publish();
        } else if (event.kind === 'shared82-h2h-game') {
          this.host.shared82H2HGame(event.output);
        } else if (event.kind === 'complete') {
          void this.finalizeSimulation(simulationContext);
        } else if (event.kind === 'error') {
          this.simulationGate.fail();
          this.simError = event.message;
          this.host.publish();
        }
      });
      this.runner = active;
      const versions = room.settings.versions;
      if (room.settings.mode === 'duel') {
        active.runDuel({
          rootSeed,
          p1Team,
          p2Team,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      } else {
        active.runShared82({
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
          recordH2H: true,
        });
      }
    } catch (e) {
      this.simulationGate.fail();
      if (this.host.isDisposed()) return;
      this.simError = e instanceof Error ? e.message : String(e);
      this.simStarted = false;
      this.host.publish();
    }
  }

  private async finalizeSimulation(context: SimulationContext): Promise<void> {
    if (this.host.isDisposed()) return;
    const room = this.room;
    const assets = this.assets;
    if (!room || !assets || !room.rootSeed) return;
    try {
      const rootSeed: Seed = room.rootSeed;
      const summary = summarizeWorkerEntries({
        mode: room.settings.mode,
        bracket: assets.bracket,
        rootSeed,
        p1TeamId: 'p1',
        p2TeamId: 'p2',
        p1PlayerIds: context.p1Team.players.map((player) => player.playerId),
        p2PlayerIds: context.p2Team.players.map((player) => player.playerId),
        entries: this.simEntries,
      });
      const digest = computeCompetitionDigest({
        rootSeed,
        versions: room.settings.versions,
        p1: { refs: context.p1Refs, players: [...context.p1Team.players] },
        p2: { refs: context.p2Refs, players: [...context.p2Team.players] },
        commands: this.commands,
        result: summary.result,
      });
      const run = assembleCompetitionRun({
        roomId: this.roomId,
        sourceMode: room.settings.sourceMode,
        competition: room.settings.mode === 'duel' ? 'duel' : 'shared-82',
        rootSeed,
        versions: room.settings.versions,
        commands: this.commands,
        p1: { refs: context.p1Refs, players: [...context.p1Team.players] },
        p2: { refs: context.p2Refs, players: [...context.p2Team.players] },
        result: summary.result,
        resultDigest: digest,
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      });
      if (this.pendingRun && this.pendingRun.resultDigest !== digest) {
        throw new Error('the saved season result does not match the reconstructed games');
      }
      if (!this.pendingRun)
        await this.deps.repository.savePendingResult(this.roomId, run, this.selfId);
      if (this.host.isDisposed()) return;
      const minShow = this.deps.prefersReducedMotion()
        ? SIM_SHOWDOWN_REDUCED_MS
        : SIM_SHOWDOWN_MIN_MS;
      const waitMs = Math.max(0, this.simStartAt + minShow - this.deps.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (this.host.isDisposed()) return;
      const localResult: FixedFiveLocalResult = {
        result: summary.result,
        digest,
        p1: { refs: context.p1Refs, players: [...context.p1Team.players] },
        p2: { refs: context.p2Refs, players: [...context.p2Team.players] },
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      };
      this.simulationGate.finish();
      if (room.settings.mode === 'duel') {
        this.localResult = localResult;
        this.simDone = true;
        this.host.recomputePhase();
        this.host.publish();
        this.host.runAutoFlows();
      } else {
        this.seasonResult = localResult;
        this.seasonWorkerComplete = true;
        this.finishShared82IfReady();
        this.host.publish();
      }
    } catch (e) {
      this.simulationGate.fail();
      if (this.host.isDisposed()) return;
      this.simError = e instanceof Error ? e.message : String(e);
      this.host.publish();
    }
  }

  private finishShared82IfReady(): void {
    if (!this.seasonWorkerComplete || this.revealedThroughGameNumber < 82 || !this.seasonResult) {
      return;
    }
    const room = this.room;
    const assets = this.assets;
    if (!room || !assets) return;
    const gameNumbers = h2hGameNumbersFor(
      assets.bracket,
      findWeakestOpponent(assets.bracket).opponentId,
    );
    const lastCompleted = room.seasonBroadcast?.lastCompletedGameNumber ?? 0;
    if (gameNumbers.some((gameNumber) => gameNumber > lastCompleted)) return;
    this.localResult = this.seasonResult;
    this.simDone = true;
    this.host.recomputePhase();
    this.host.runAutoFlows();
  }

  async rerun(): Promise<void> {
    try {
      this.simulationReason = 'mismatch-rerun';
      if (!this.simulationGate.canStart(this.simulationReason)) return;
      this.runner?.dispose();
      this.runner = null;
      this.statsRunner?.dispose();
      this.statsRunner = null;
      await this.deps.repository.clearPendingResult(this.roomId).catch(() => {});
      if (this.host.isDisposed()) return;
      this.host.resetVerification();
      this.simStarted = false;
      this.simDone = false;
      this.localResult = null;
      this.simEntries = [];
      this.pendingRun = null;
      this.seasonResult = null;
      this.seasonWorkerComplete = false;
      this.statsEntries = [];
      this.statsState = 'idle';
      this.progress = null;
      this.simError = null;
      this.host.recomputePhase();
      this.host.publish();
      await this.host.sync();
      if (this.host.isDisposed()) return;
      void this.startSimulation(this.simulationReason);
    } catch (e) {
      if (!this.host.isDisposed()) {
        this.simError = e instanceof Error ? e.message : String(e);
        this.host.publish();
      }
    }
  }

  private async rebuildStatsEntries(): Promise<void> {
    const room = this.room;
    const assets = this.assets;
    const localResult = this.localResult;
    if (
      this.statsState === 'running' ||
      !room ||
      !assets ||
      !room.rootSeed ||
      !this.replay ||
      !localResult
    ) {
      return;
    }
    this.statsState = 'running';
    this.host.publish();
    try {
      const rootSeed: Seed = room.rootSeed;
      const p1Team: FixedFiveWorkerTeam = await this.deps.buildTeam(
        assets.manifest,
        'p1',
        'Player 1',
        localResult.p1.refs,
      );
      const p2Team: FixedFiveWorkerTeam = await this.deps.buildTeam(
        assets.manifest,
        'p2',
        'Player 2',
        localResult.p2.refs,
      );
      if (this.host.isDisposed()) {
        this.statsState = 'settled';
        return;
      }
      this.statsRunner?.dispose();
      const collected: FixedFiveWorkerResultEntry[] = [];
      const active = this.deps.createRunner((event) => {
        if (this.host.isDisposed()) return;
        if (event.kind === 'results') {
          for (const entry of event.entries) collected.push(entry);
        } else if (event.kind === 'complete') {
          this.statsEntries = collected;
          this.statsState = 'settled';
          this.statsRunner?.dispose();
          this.statsRunner = null;
          this.host.publish();
        } else if (event.kind === 'error') {
          this.statsState = 'settled';
          this.statsRunner?.dispose();
          this.statsRunner = null;
          this.host.publish();
        }
      });
      this.statsRunner = active;
      const versions = room.settings.versions;
      if (room.settings.mode === 'duel') {
        active.runDuel({
          rootSeed,
          p1Team,
          p2Team,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      } else {
        active.runShared82({
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      }
    } catch {
      if (!this.host.isDisposed()) {
        this.statsState = 'settled';
        this.host.publish();
      }
    }
  }
}
