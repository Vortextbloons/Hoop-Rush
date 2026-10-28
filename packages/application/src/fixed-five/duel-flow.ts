import type { FixedFiveDuelGameOutput, Seed } from '@hoop-rush/data-contracts';
import {
  assembleCompetitionRun,
  computeCompetitionDigest,
  summarizeWorkerEntries,
} from '@hoop-rush/engine';
import { refsForParticipant } from './pick-refs.ts';
import type { FixedFiveCompetitionFlow } from './competition-flow.ts';
import type {
  FixedFiveFlowContext,
  FixedFiveRoomSessionDeps,
  FixedFiveRunnerPort,
} from './session.ts';

interface DuelHost {
  context(): FixedFiveFlowContext;
  isDisposed(): boolean;
  isDuelBroadcast(): boolean;
  publish(): void;
  runAutoFlows(): void;
  recomputePhase(): void;
  competition: FixedFiveCompetitionFlow;
}

export class FixedFiveDuelFlow {
  outputs: Record<number, FixedFiveDuelGameOutput> = {};
  simulatingGame: number | null = null;
  error: string | null = null;
  private runner: FixedFiveRunnerPort | null = null;
  private readonly deps: Pick<
    FixedFiveRoomSessionDeps,
    'roomId' | 'buildTeam' | 'createRunner' | 'repository'
  >;
  private readonly host: DuelHost;

  constructor(
    deps: Pick<FixedFiveRoomSessionDeps, 'roomId' | 'buildTeam' | 'createRunner' | 'repository'>,
    host: DuelHost,
  ) {
    this.deps = deps;
    this.host = host;
  }

  dispose(): void {
    this.runner?.dispose();
    this.runner = null;
  }

  private duelPipelineTarget(): number | null {
    const room = this.host.context().room;
    const series = room?.series;
    if (!room || !series) return null;
    if (
      room.phase === 'preparing-game' ||
      room.phase === 'broadcasting' ||
      room.phase === 'game-results'
    ) {
      const current = series.currentGameNumber;
      if (current !== null && !this.outputs[current]) return current;
      return null;
    }
    if (room.phase === 'awaiting-confirmation') {
      const missing = series.games.find((game) => !this.outputs[game.gameNumber]);
      if (missing) return missing.gameNumber;
    }
    return null;
  }

  private refreshDuelEntries(): void {
    const entries = Object.values(this.outputs)
      .sort((a, b) => a.gameNumber - b.gameNumber)
      .map((output) => ({ tag: 'duel' as const, game: output.result }));
    if (entries.length === 0) return;
    this.host.competition.setDuelEntries(entries);
  }

  start(): void {
    if (this.host.isDisposed() || !this.host.isDuelBroadcast()) return;
    if (this.simulatingGame !== null) return;
    if (
      !this.host.context().room?.rootSeed ||
      !this.host.context().assets ||
      !this.host.context().replay
    )
      return;
    const target = this.duelPipelineTarget();
    if (target === null) return;
    this.simulatingGame = target;
    this.error = null;
    this.host.publish();
    void (async () => {
      try {
        const output = await this.simulateDuelGame(target);
        if (this.host.isDisposed()) return;
        this.outputs = { ...this.outputs, [output.gameNumber]: output };
        this.refreshDuelEntries();
      } catch (error) {
        if (this.host.isDisposed()) return;
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (this.host.isDisposed()) return;
        this.simulatingGame = null;
        this.host.publish();
        if (this.error === null) this.host.runAutoFlows();
      }
    })();
  }

  private async simulateDuelGame(gameNumber: number): Promise<FixedFiveDuelGameOutput> {
    const room = this.host.context().room;
    const assets = this.host.context().assets;
    const replay = this.host.context().replay;
    if (!room || !assets || !replay || !room.rootSeed) {
      throw new Error('Duel game inputs are incomplete.');
    }
    const p1Refs = refsForParticipant(replay, assets, 'p1');
    const p2Refs = refsForParticipant(replay, assets, 'p2');
    if (p1Refs.length !== 5 || p2Refs.length !== 5) {
      throw new Error('both lineups must be complete before simulating');
    }
    const p1Team = await this.deps.buildTeam(assets.manifest, 'p1', 'Player 1', p1Refs);
    if (this.host.isDisposed()) throw new Error('the room session was disposed');
    const p2Team = await this.deps.buildTeam(assets.manifest, 'p2', 'Player 2', p2Refs);
    if (this.host.isDisposed()) throw new Error('the room session was disposed');
    const versions = room.settings.versions;
    return await new Promise<FixedFiveDuelGameOutput>((resolve, reject) => {
      const active = this.deps.createRunner((event) => {
        if (this.host.isDisposed()) return;
        if (event.kind === 'duel-game') {
          active.dispose();
          if (this.runner === active) this.runner = null;
          resolve(event.output);
        } else if (event.kind === 'error') {
          active.dispose();
          if (this.runner === active) this.runner = null;
          reject(new Error(event.message));
        }
      });
      this.runner = active;
      active.runDuelGame({
        roomId: this.deps.roomId,
        gameNumber,
        rootSeed: room.rootSeed as Seed,
        p1Team,
        p2Team,
        profile: assets.profile,
        dataVersion: versions.dataVersion,
        engineVersion: versions.engineVersion,
      });
    });
  }

  finalizeIfReady(): void {
    if (this.host.isDisposed() || !this.host.isDuelBroadcast()) return;
    const room = this.host.context().room;
    const series = room?.series;
    if (!room || !series || !series.champion) return;
    if (room.phase !== 'awaiting-confirmation') return;
    if (this.host.competition.getSnapshot().localResult) return;
    if (this.duelPipelineTarget() !== null) return;
    const played = series.games.map((game) => this.outputs[game.gameNumber]);
    if (played.some((output) => output === undefined)) return;
    void this.finalizeDuelSeries(played as FixedFiveDuelGameOutput[]);
  }

  private async finalizeDuelSeries(outputs: FixedFiveDuelGameOutput[]): Promise<void> {
    const room = this.host.context().room;
    const assets = this.host.context().assets;
    const replay = this.host.context().replay;
    if (!room || !assets || !replay || !room.rootSeed) return;
    try {
      const rootSeed: Seed = room.rootSeed;
      const p1Refs = refsForParticipant(replay, assets, 'p1');
      const p2Refs = refsForParticipant(replay, assets, 'p2');
      const p1Team = await this.deps.buildTeam(assets.manifest, 'p1', 'Player 1', p1Refs);
      if (this.host.isDisposed()) return;
      const p2Team = await this.deps.buildTeam(assets.manifest, 'p2', 'Player 2', p2Refs);
      if (this.host.isDisposed()) return;
      const summary = summarizeWorkerEntries({
        mode: room.settings.mode,
        bracket: assets.bracket,
        rootSeed,
        p1TeamId: 'p1',
        p2TeamId: 'p2',
        p1PlayerIds: p1Team.players.map((player) => player.playerId),
        p2PlayerIds: p2Team.players.map((player) => player.playerId),
        entries: outputs.map((output) => ({ tag: 'duel' as const, game: output.result })),
      });
      const digest = computeCompetitionDigest({
        rootSeed,
        versions: room.settings.versions,
        p1: { refs: p1Refs, players: [...p1Team.players] },
        p2: { refs: p2Refs, players: [...p2Team.players] },
        commands: this.host.context().commands,
        result: summary.result,
      });
      const run = assembleCompetitionRun({
        roomId: this.deps.roomId,
        sourceMode: room.settings.sourceMode,
        competition: 'duel',
        rootSeed,
        versions: room.settings.versions,
        commands: this.host.context().commands,
        p1: { refs: p1Refs, players: [...p1Team.players] },
        p2: { refs: p2Refs, players: [...p2Team.players] },
        result: summary.result,
        resultDigest: digest,
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      });
      await this.deps.repository.savePendingResult(
        this.deps.roomId,
        run,
        this.host.context().selfId,
      );
      if (this.host.isDisposed()) return;
      this.host.competition.acceptDuelResult({
        result: summary.result,
        digest,
        p1: { refs: p1Refs, players: [...p1Team.players] },
        p2: { refs: p2Refs, players: [...p2Team.players] },
        weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
      });
      this.host.recomputePhase();
      this.host.publish();
      this.host.runAutoFlows();
    } catch (error) {
      if (this.host.isDisposed()) return;
      this.host.competition.setError(error instanceof Error ? error.message : String(error));
      this.host.publish();
    }
  }
}
