import type {
  FixedFiveShared82H2HGameOutput,
  FixedFiveWorkerTeam,
  Seed,
} from '@hoop-rush/data-contracts';
import { refsForParticipant } from './pick-refs.ts';
import type {
  FixedFiveFlowContext,
  FixedFiveRoomSessionDeps,
  FixedFiveRunnerPort,
} from './session.ts';

interface Shared82Host {
  context(): FixedFiveFlowContext;
  isDisposed(): boolean;
  isShared82Broadcast(): boolean;
  publish(): void;
  tickReveal(): void;
}

export class FixedFiveShared82GameFlow {
  outputs: Record<number, FixedFiveShared82H2HGameOutput> = {};
  simulatingGame: number | null = null;
  error: string | null = null;
  private runner: FixedFiveRunnerPort | null = null;
  private readonly deps: Pick<FixedFiveRoomSessionDeps, 'roomId' | 'buildTeam' | 'createRunner'>;
  private readonly host: Shared82Host;

  constructor(
    deps: Pick<FixedFiveRoomSessionDeps, 'roomId' | 'buildTeam' | 'createRunner'>,
    host: Shared82Host,
  ) {
    this.deps = deps;
    this.host = host;
  }

  accept(output: FixedFiveShared82H2HGameOutput): void {
    this.outputs = { ...this.outputs, [output.gameNumber]: output };
    if (this.simulatingGame === output.gameNumber) this.stop();
    this.error = null;
  }

  reset(gameNumber: number): void {
    this.outputs = Object.fromEntries(
      Object.entries(this.outputs).filter(([key]) => Number(key) !== gameNumber),
    );
    this.error = null;
    this.stop();
  }

  stop(): void {
    this.runner?.dispose();
    this.runner = null;
    this.simulatingGame = null;
  }

  start(gameNumber: number): void {
    if (
      this.host.isDisposed() ||
      !this.host.isShared82Broadcast() ||
      this.outputs[gameNumber] ||
      this.simulatingGame !== null
    ) {
      return;
    }
    const room = this.host.context().room;
    const assets = this.host.context().assets;
    const replay = this.host.context().replay;
    if (!room?.rootSeed || !assets || !replay) return;
    const rootSeed: Seed = room.rootSeed;
    this.simulatingGame = gameNumber;
    this.error = null;
    this.host.publish();
    void (async () => {
      try {
        const p1Refs = refsForParticipant(replay, assets, 'p1');
        const p2Refs = refsForParticipant(replay, assets, 'p2');
        if (p1Refs.length !== 5 || p2Refs.length !== 5) {
          throw new Error('both lineups must be complete before simulating');
        }
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
        const active = this.deps.createRunner((event) => {
          if (this.host.isDisposed() || this.simulatingGame !== gameNumber) return;
          if (event.kind === 'shared82-h2h-game') {
            this.outputs = {
              ...this.outputs,
              [gameNumber]: event.output,
            };
            this.error = null;
            this.runner?.dispose();
            this.runner = null;
            this.simulatingGame = null;
            this.host.publish();
            this.host.tickReveal();
          } else if (event.kind === 'error') {
            this.error = event.message;
            this.runner?.dispose();
            this.runner = null;
            this.simulatingGame = null;
            this.host.publish();
          }
        });
        this.runner = active;
        active.runShared82H2HGame({
          roomId: this.deps.roomId,
          gameNumber,
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: room.settings.versions.dataVersion,
          engineVersion: room.settings.versions.engineVersion,
        });
      } catch (error) {
        if (this.host.isDisposed()) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.simulatingGame = null;
        this.runner?.dispose();
        this.runner = null;
        this.host.publish();
      }
    })();
  }
}
