import {
  advanceFullCourtPlayoffs,
  advanceFullCourtSeasonSlot,
  startFullCourtPlayoffs,
  startFullCourtSeason,
  submitFullCourtDraftCommand,
} from '@hoop-rush/application/full-court';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  idSchema,
  type FullCourtCommand,
  type FullCourtDraftState,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtRegularSeason,
  fullCourtDraftIndexOf,
  fullCourtPlayoffView,
  lockFullCourtRegularSeason,
  type FullCourtCatalogIndex,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';
import { errorMessageOf } from '#lib/errors.js';
import { newRequestId, newSeasonId, seasonRootSeed } from '#lib/ids.js';
import { getPersistence } from '#lib/persistence.js';
import { loadFullCourtAssets } from './full-court-assets.js';
import { createFullCourtWorkerRunner } from './full-court-worker-runner.js';

const ACTIVE_RUN_KEY = 'hoop-rush:full-court:active-run';

interface SeasonState {
  lock: FullCourtSeasonLock;
  checkpoint: FullCourtSeasonCheckpoint;
  scores: readonly FullCourtSeasonScore[];
}

type PlayoffState = Awaited<ReturnType<typeof startFullCourtPlayoffs>>;
type AdvanceOutcome = Awaited<
  ReturnType<typeof advanceFullCourtSeasonSlot> | ReturnType<typeof advanceFullCourtPlayoffs>
>;

export class FullCourtController {
  index = $state.raw<FullCourtCatalogIndex | null>(null);
  draft = $state.raw<FullCourtDraftState | null>(null);
  season = $state.raw<SeasonState | null>(null);
  playoffs = $state.raw<PlayoffState | null>(null);
  error = $state<string | null>(null);
  pendingForfeit = $state(false);
  busy = $state(false);
  simulating = $state(false);
  stopRequested = $state(false);

  #disposed = false;
  #assets: Awaited<ReturnType<typeof loadFullCourtAssets>> | null = null;
  #repositories = getPersistence();
  #worker: ReturnType<typeof createFullCourtWorkerRunner> | null = null;

  dispose(): void {
    this.#disposed = true;
    this.#worker?.dispose();
  }

  #isDisposed(): boolean {
    return this.#disposed;
  }

  load(): Promise<void> {
    return this.#act(async () => {
      const assets = (this.#assets ??= await loadFullCourtAssets());
      if (this.#isDisposed()) return;
      this.index ??= fullCourtDraftIndexOf(assets.catalog, assets.catalogSource);
      const runId = localStorage.getItem(ACTIVE_RUN_KEY);
      if (runId !== null) await this.#openRun(runId);
    });
  }

  startDraft(): Promise<void> {
    return this.#act(async () => {
      if (this.#assets === null) return;
      const runId = idSchema.parse(newRequestId('full-court'));
      await this.#submit({
        command: 'create-full-court-draft',
        commandId: newSeasonId('command'),
        runId,
        runSeed: seasonRootSeed(),
        variant: 'standard',
        catalog: this.#assets.catalogSource,
      });
      localStorage.setItem(ACTIVE_RUN_KEY, runId);
      await this.#openRun(runId);
    });
  }

  editDraft(
    command: 'pick-full-court-player' | 'remove-full-court-player' | 'finish-full-court-draft',
    playerVersionId?: string,
  ): Promise<void> {
    return this.#act(async () => {
      if (this.draft === null) return;
      const stamp = {
        commandId: newSeasonId('command'),
        runId: this.draft.runId,
        expectedRevision: this.draft.revision,
      };
      if (command === 'finish-full-court-draft') {
        await this.#submit({ command, ...stamp });
        await this.#openRun(stamp.runId);
      } else if (playerVersionId !== undefined) {
        await this.#submit({ command, ...stamp, playerVersionId });
      }
    });
  }

  startPlayoffs(): Promise<void> {
    return this.#act(async () => {
      if (this.season !== null) await this.#openPlayoffs(this.season.lock);
    });
  }

  stopAfterGame(): void {
    if (this.simulating) this.stopRequested = true;
  }

  advance(count: number, acceptForfeit = false): Promise<void> {
    return this.#act(async () => {
      if (this.season === null) return;
      this.simulating = true;
      const worker = (this.#worker ??= createFullCourtWorkerRunner());
      const regular = this.#repositories.fullCourtSeasonRepository;
      const playoffsRepo = this.#repositories.fullCourtPlayoffRepository;
      const { lock } = this.season;
      for (let step = 0; step < count && !this.#isDisposed() && !this.stopRequested; step++) {
        const options = { acceptForfeit: step === 0 && acceptForfeit };
        const playoffs: PlayoffState | null = this.playoffs;
        const current: SeasonState = this.season;
        const outcome: AdvanceOutcome = playoffs
          ? await advanceFullCourtPlayoffs(
              { lock: playoffs.lock, expectedGames: playoffs.checkpoint.games.length, options },
              { repository: playoffsRepo, simulateGame: (...args) => worker.simulateGame(...args) },
            )
          : await advanceFullCourtSeasonSlot(
              { lock, expectedThroughSlot: current.checkpoint.completedThroughSlot, options },
              { repository: regular, simulateSlot: (...args) => worker.simulateSlot(...args) },
            );
        if (this.#isDisposed()) return;
        this.pendingForfeit = outcome.kind === 'decision' && outcome.reason === 'confirm-forfeit';
        switch (outcome.kind) {
          case 'simulated':
            if ('scores' in outcome) {
              this.season = {
                lock,
                checkpoint: outcome.checkpoint,
                scores: [...current.scores, ...outcome.scores],
              };
              if (outcome.checkpoint.completedThroughSlot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
                return;
              }
            } else if (playoffs !== null) {
              const view = fullCourtPlayoffView(playoffs.lock, outcome.checkpoint);
              this.playoffs = { ...playoffs, checkpoint: outcome.checkpoint, view };
              if (view.nextGame === null) return;
            }
            break;
          case 'stale':
            await this.#openRun(lock.season.runId);
            this.error = 'This run advanced in another tab. The latest results are loaded.';
            return;
          case 'decision':
            if (!this.pendingForfeit) this.error = 'The current lineup cannot play this game.';
            return;
          default:
            return;
        }
      }
    });
  }

  async #submit(command: FullCourtCommand): Promise<void> {
    if (this.index === null) return;
    const repository = this.#repositories.fullCourtDraftRepository;
    const outcome = await submitFullCourtDraftCommand(command, { repository, index: this.index });
    const latest = await repository.load(command.runId);
    if (this.#isDisposed()) return;
    if (latest === null) throw new Error('The draft could not be saved.');
    this.draft = latest;
    if (outcome.rejection !== null) throw new Error(outcome.rejection.message);
  }

  async #openRun(runId: string): Promise<void> {
    if (this.#assets === null || this.#isDisposed()) return;
    const draft = await this.#repositories.fullCourtDraftRepository.load(runId);
    if (this.#isDisposed()) return;
    this.draft = draft;
    this.pendingForfeit = false;
    if (draft?.stage !== 'complete') {
      this.season = null;
      this.playoffs = null;
      return;
    }

    const regular = this.#repositories.fullCourtSeasonRepository;
    const lock =
      this.season?.lock.season.runId === runId
        ? this.season.lock
        : lockFullCourtRegularSeason(buildFullCourtRegularSeason({ ...this.#assets, draft }));
    const checkpoint = await startFullCourtSeason(lock, regular);
    const scores = (await regular.listScores(runId)).filter(
      (score) => score.slot <= checkpoint.completedThroughSlot,
    );
    const playoffSave =
      checkpoint.completedThroughSlot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM
        ? await this.#repositories.fullCourtPlayoffRepository.load(runId)
        : null;
    if (this.#isDisposed()) return;
    this.season = { lock, checkpoint, scores };
    if (playoffSave === null) this.playoffs = null;
    else await this.#openPlayoffs(lock);
  }

  async #openPlayoffs(lock: FullCourtSeasonLock): Promise<void> {
    const state = await startFullCourtPlayoffs(lock, {
      regular: this.#repositories.fullCourtSeasonRepository,
      playoffs: this.#repositories.fullCourtPlayoffRepository,
    });
    if (!this.#isDisposed()) this.playoffs = state;
  }

  async #act(action: () => Promise<void>): Promise<void> {
    if (this.busy || this.#isDisposed()) return;
    this.busy = true;
    this.error = null;
    try {
      await action();
    } catch (error) {
      if (!this.#isDisposed()) this.error = errorMessageOf(error);
    } finally {
      if (!this.#isDisposed()) {
        this.busy = false;
        this.simulating = false;
        this.stopRequested = false;
      }
    }
  }
}
