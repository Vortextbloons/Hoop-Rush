import {
  advanceFullCourtPlayoffs,
  advanceFullCourtSeasonSlot,
  archiveFullCourtRun,
  buildFullCourtWatchedReplay,
  fullCourtRotationInputForPlan,
  saveFullCourtBlueprint,
  saveFullCourtCoaching,
  startFullCourtPlayoffs,
  startFullCourtSeason,
  submitFullCourtDraftCommand,
  type SaveFullCourtBlueprintOptions,
} from '@hoop-rush/application/full-court';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
  capRushPlayoffSeriesId,
  capRushSeriesWinner,
  capRushSeriesWins,
  fullCourtDefensiveMatchupsSchema,
  idSchema,
  type FullCourtBlueprint,
  type FullCourtCoachingPlan,
  type FullCourtCommand,
  type FullCourtDefensiveMatchupAssignment,
  type FullCourtDefensiveMatchups,
  type FullCourtDraftState,
  type FullCourtPlayoffCheckpoint,
  type FullCourtPracticeReport,
  type FullCourtReportTarget,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtTactics,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtRegularSeason,
  assertFullCourtCoachingRoster,
  fullCourtDraftIndexOf,
  fullCourtPlayoffView,
  fullCourtTrainingCampSeed,
  fullCourtUserNextPlayoffMatchup,
  validateFullCourtDefensiveMatchups,
  type FullCourtCatalogIndex,
  type FullCourtGameHealthOutcome,
  type FullCourtPlayoffLock,
  type FullCourtPlayoffOpponentPreview,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
  type FullCourtSeasonSlotOutcome,
} from '@hoop-rush/engine';
import { errorMessageOf } from '#lib/errors.js';
import { newRequestId, newSeasonId, seasonRootSeed } from '#lib/ids.js';
import { getPersistence, type Persistence } from '#lib/persistence.js';
import { FULL_COURT_ACTIVE_RUN_KEY } from './full-court-active-run.js';
import { loadFullCourtAssets } from './full-court-assets.js';
import { loadFullCourtHealthProfiles } from './full-court-health-profiles.js';
import { resolveFullCourtSeasonLock } from './full-court-season-lock.js';
import {
  fullCourtGameDayReadiness,
  fullCourtNextReviewSlot,
  fullCourtNextUserFixture,
  fullCourtPlayoffAdjustmentChanged,
  fullCourtSimulationNotice,
  fullCourtUserSeries,
  type FullCourtAdvanceOptions,
  type FullCourtSimulationNotice,
  type FullCourtSimulationStop,
  type FullCourtUserFixture,
} from './full-court-season-presenter.js';
import { createFullCourtWorkerRunner } from './full-court-worker-runner.js';

export interface FullCourtControllerDependencies {
  readonly loadAssets?: typeof loadFullCourtAssets;
  readonly loadHealthProfiles?: typeof loadFullCourtHealthProfiles;
  readonly repositories?: Persistence;
  readonly createWorker?: typeof createFullCourtWorkerRunner;
}

interface SeasonState {
  lock: FullCourtSeasonLock;
  checkpoint: FullCourtSeasonCheckpoint;
  scores: readonly FullCourtSeasonScore[];
  coaching: FullCourtCoachingPlan;
}

type PlayoffState = Awaited<ReturnType<typeof startFullCourtPlayoffs>>;
type PlayedGame = Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;
type RegularSimulatedOutcome = Extract<FullCourtSeasonSlotOutcome, { kind: 'simulated' }>;
type FullCourtWorker = ReturnType<typeof createFullCourtWorkerRunner>;

/** Pinned rest and matchup choices captured for the next user fixture. */
interface PinnedGamePlan {
  readonly restGameId: string | null;
  readonly restingPlayerIds: readonly string[];
  readonly matchupGameId: string | null;
  readonly matchupOpponentId: string | null;
  readonly matchupAssignments: readonly FullCourtDefensiveMatchupAssignment[];
}

interface AdvanceRunInput {
  readonly count: number;
  readonly acceptForfeit: boolean;
  readonly record: boolean;
  readonly options: FullCourtAdvanceOptions;
  readonly lock: FullCourtSeasonLock;
  readonly coaching: FullCourtCoachingPlan;
  readonly pinned: PinnedGamePlan;
  readonly worker: FullCourtWorker;
}

export class FullCourtController {
  index = $state.raw<FullCourtCatalogIndex | null>(null);
  draft = $state.raw<FullCourtDraftState | null>(null);
  season = $state.raw<SeasonState | null>(null);
  playoffs = $state.raw<PlayoffState | null>(null);
  latestGame = $state.raw<PlayedGame | null>(null);
  practice = $state.raw<FullCourtPracticeReport | null>(null);
  savedReplay = $state.raw<FullCourtWatchedReplay | null>(null);
  /** Why the last simulation batch returned control, when it stopped for a decision. */
  notice = $state.raw<FullCourtSimulationNotice | null>(null);
  error = $state<string | null>(null);
  pendingForfeit = $state(false);
  busy = $state(false);
  simulating = $state(false);
  stopRequested = $state(false);
  restingPlayerIds = $state.raw<readonly string[]>([]);
  restingForGameId = $state.raw<string | null>(null);
  defensiveMatchupAssignments = $state.raw<readonly FullCourtDefensiveMatchupAssignment[]>([]);
  defensiveMatchupsForGameId = $state.raw<string | null>(null);
  defensiveMatchupsOpponentId = $state.raw<string | null>(null);

  #disposed = false;
  #assets: Awaited<ReturnType<typeof loadFullCourtAssets>> | null = null;
  #loadAssets: typeof loadFullCourtAssets;
  #loadHealthProfiles: typeof loadFullCourtHealthProfiles;
  #repositories: Persistence;
  #createWorker: typeof createFullCourtWorkerRunner;
  #worker: ReturnType<typeof createFullCourtWorkerRunner> | null = null;
  #nextGamePlanWrite = Promise.resolve();
  /**
   * The next-round series whose opponent change was already surfaced. It lets
   * the next sim play that series instead of stopping on the same boundary.
   */
  #controlReturnedForSeriesId: string | null = null;

  constructor(dependencies: FullCourtControllerDependencies = {}) {
    this.#loadAssets = dependencies.loadAssets ?? loadFullCourtAssets;
    this.#loadHealthProfiles = dependencies.loadHealthProfiles ?? loadFullCourtHealthProfiles;
    this.#repositories = dependencies.repositories ?? getPersistence();
    this.#createWorker = dependencies.createWorker ?? createFullCourtWorkerRunner;
  }

  dispose(): void {
    this.#disposed = true;
    this.#worker?.dispose();
  }

  #isDisposed(): boolean {
    return this.#disposed;
  }

  load(): Promise<void> {
    return this.#act(async () => {
      const assets = (this.#assets ??= await this.#loadAssets());
      if (this.#isDisposed()) return;
      this.index ??= fullCourtDraftIndexOf(assets.catalog, assets.catalogSource);
      const runId = localStorage.getItem(FULL_COURT_ACTIVE_RUN_KEY);
      if (runId !== null) await this.#openRun(runId);
    });
  }

  #practiceRunCount = 0;

  startDraft(
    variant: 'standard' | 'roulette' = 'standard',
    perks: readonly ('lineup-fit' | 'opponent-film' | 'training-camp')[] = [],
  ): Promise<void> {
    return this.#act(async () => {
      if (this.#assets === null) return;
      const runId = idSchema.parse(newRequestId('full-court'));
      await this.#submit({
        command: 'create-full-court-draft',
        commandId: newSeasonId('command'),
        runId,
        runSeed: seasonRootSeed(),
        variant,
        catalog: this.#assets.catalogSource,
      });
      for (const perk of perks) {
        if (this.draft === null) break;
        const target: FullCourtReportTarget = { kind: perk };
        await this.#submit({
          command: 'purchase-full-court-report',
          commandId: newSeasonId('command'),
          runId,
          expectedRevision: this.draft.revision,
          target,
        });
      }
      localStorage.setItem(FULL_COURT_ACTIVE_RUN_KEY, runId);
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

  clearNotice(): void {
    this.notice = null;
  }

  /** Rest choices stay pinned to the next user fixture and clear once it is played. */
  setRestingPlayers(playerIds: readonly string[]): void {
    this.#setRestingPlayers(playerIds, true);
  }

  #setRestingPlayers(playerIds: readonly string[], persist: boolean): void {
    const fixture = this.#nextUserFixture();
    if (fixture === null) {
      if (playerIds.length > 0) this.error = 'No Full Court game is ready for rest choices.';
      this.#clearRest();
      return;
    }
    const team = this.#userTeam();
    if (team === undefined) return;
    const rosterIds = new Set<string>(team.roster.map((player) => player.playerId));
    const unique = [...new Set(playerIds)];
    if (unique.some((playerId) => !rosterIds.has(playerId))) {
      this.error = 'A rest choice is not on your Full Court roster.';
      return;
    }
    if (unique.length > 0) {
      const readiness = this.#gameDayReadiness(fixture, unique);
      if (readiness?.restConflict === true) {
        this.error = `Resting ${String(unique.length)} players leaves fewer than five available. Choose a legal plan.`;
        return;
      }
    }
    this.restingForGameId = fixture.gameId;
    this.restingPlayerIds = unique;
    this.error = null;
    if (persist) this.#saveNextGamePlan(fixture);
  }

  #userTeam() {
    const season = this.season;
    if (season === null) return undefined;
    return season.lock.season.teams.find((team) => team.teamId === season.lock.season.userTeamId);
  }

  #userTeamHealth() {
    const season = this.season;
    if (season === null) return null;
    const userTeamId = season.lock.season.userTeamId;
    return (
      (this.playoffs?.checkpoint.healthByTeam ?? season.checkpoint.healthByTeam)[userTeamId] ?? null
    );
  }

  #nextUserFixture() {
    const season = this.season;
    if (season === null) return null;
    return fullCourtNextUserFixture(season.lock, season.checkpoint, this.playoffs?.view ?? null);
  }

  #gameDayReadiness(fixture: FullCourtUserFixture, restingPlayerIds: readonly string[]) {
    const team = this.#userTeam();
    if (team === undefined) return null;
    return fullCourtGameDayReadiness({
      roster: team.roster,
      availability: team.availability,
      health: this.#userTeamHealth(),
      fixture,
      restingPlayerIds,
    });
  }

  #clearRest(): void {
    this.restingPlayerIds = [];
    this.restingForGameId = null;
  }

  #clearDefensiveMatchups(): void {
    this.defensiveMatchupAssignments = [];
    this.defensiveMatchupsForGameId = null;
    this.defensiveMatchupsOpponentId = null;
  }

  /**
   * Defensive matchup assignments stay pinned to the next user fixture and
   * opponent, validate against both locked rosters, and clear once played.
   */
  setDefensiveMatchups(assignments: readonly FullCourtDefensiveMatchupAssignment[]): boolean {
    return this.#setDefensiveMatchups(assignments, true);
  }

  #setDefensiveMatchups(
    assignments: readonly FullCourtDefensiveMatchupAssignment[],
    persist: boolean,
  ): boolean {
    const season = this.season;
    const fixture = this.#nextUserFixture();
    const userTeam = this.#userTeam();
    if (season === null || fixture === null || userTeam === undefined) {
      if (assignments.length > 0) {
        this.error = 'No Full Court game is ready for defensive matchup assignments.';
      }
      this.#clearDefensiveMatchups();
      return assignments.length === 0;
    }
    const opponentTeamId =
      fixture.homeTeamId === userTeam.teamId ? fixture.awayTeamId : fixture.homeTeamId;
    const opponentTeam = season.lock.season.teams.find((team) => team.teamId === opponentTeamId);
    if (opponentTeam === undefined) {
      this.#clearDefensiveMatchups();
      this.error = 'The next opponent roster is unavailable.';
      return false;
    }
    if (assignments.length === 0) {
      this.#clearDefensiveMatchups();
      if (season.checkpoint.completedThroughSlot === 0) this.practice = null;
      this.error = null;
      if (persist) this.#saveNextGamePlan(fixture);
      return true;
    }
    const candidate = fullCourtDefensiveMatchupsSchema.safeParse({
      gameId: fixture.gameId,
      opponentTeamId,
      assignments,
    });
    if (!candidate.success) {
      this.error = candidate.error.issues[0]?.message ?? 'Invalid defensive matchup assignment.';
      return false;
    }
    const errors = validateFullCourtDefensiveMatchups({
      userRoster: userTeam.roster,
      opponentTeamId,
      opponentRoster: opponentTeam.roster,
      gameId: fixture.gameId,
      matchups: candidate.data,
    });
    if (errors.length > 0) {
      this.error = errors[0] ?? 'Invalid defensive matchup assignment.';
      return false;
    }
    this.defensiveMatchupsForGameId = fixture.gameId;
    this.defensiveMatchupsOpponentId = opponentTeamId;
    this.defensiveMatchupAssignments = candidate.data.assignments.map((entry) => ({ ...entry }));
    if (season.checkpoint.completedThroughSlot === 0) this.practice = null;
    this.error = null;
    if (persist) this.#saveNextGamePlan(fixture);
    return true;
  }

  clearDefensiveMatchups(): void {
    this.#setDefensiveMatchups([], true);
  }

  #activeDefensiveMatchupsFor(
    gameId: string,
    opponentTeamId: string,
  ): FullCourtDefensiveMatchups | undefined {
    if (
      this.defensiveMatchupsForGameId !== gameId ||
      this.defensiveMatchupsOpponentId !== opponentTeamId ||
      this.defensiveMatchupAssignments.length === 0
    ) {
      return undefined;
    }
    return {
      gameId,
      opponentTeamId,
      assignments: [...this.defensiveMatchupAssignments],
    };
  }

  #saveNextGamePlan(fixture: FullCourtUserFixture): void {
    const season = this.season;
    if (season === null) return;
    const { runId, userTeamId } = season.lock.season;
    const opponentTeamId =
      fixture.homeTeamId === userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    const gameId = fixture.gameId;
    const restingPlayerIds = this.restingForGameId === gameId ? [...this.restingPlayerIds] : [];
    const defensiveMatchups = this.#activeDefensiveMatchupsFor(gameId, opponentTeamId);
    const repository = this.#repositories.fullCourtNextGamePlanRepository;
    this.#nextGamePlanWrite = this.#nextGamePlanWrite
      .then(() =>
        restingPlayerIds.length === 0 && defensiveMatchups === undefined
          ? repository.clear(runId, gameId)
          : repository.save(runId, {
              schemaVersion: FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
              gameId,
              opponentTeamId,
              restingPlayerIds,
              defensiveMatchups,
            }),
      )
      .catch((error: unknown) => {
        if (!this.#isDisposed() && this.draft?.runId === runId) {
          this.error = errorMessageOf(error);
        }
      });
  }

  async #restoreNextGamePlan(runId: string): Promise<void> {
    const repository = this.#repositories.fullCourtNextGamePlanRepository;
    const plan = await repository.load(runId);
    if (plan === null || this.#isDisposed()) return;
    const fixture = this.#nextUserFixture();
    const userTeamId = this.season?.lock.season.userTeamId;
    const opponentId =
      fixture?.homeTeamId === userTeamId ? fixture?.awayTeamId : fixture?.homeTeamId;
    if (fixture?.gameId !== plan.gameId || opponentId !== plan.opponentTeamId) {
      await repository.clear(runId, plan.gameId);
      return;
    }
    this.#setRestingPlayers(plan.restingPlayerIds, false);
    if (plan.defensiveMatchups !== undefined) {
      const restError = this.error;
      this.#setDefensiveMatchups(plan.defensiveMatchups.assignments, false);
      this.error ??= restError;
    }
  }

  async #clearCommittedGamePlan(
    runId: string,
    gameId: string | null,
    plan: PinnedGamePlan,
  ): Promise<void> {
    if (gameId === null) return;
    if (plan.restGameId === gameId) this.#clearRest();
    if (plan.matchupGameId === gameId) this.#clearDefensiveMatchups();
    if (plan.restGameId === gameId || plan.matchupGameId === gameId) {
      await this.#repositories.fullCourtNextGamePlanRepository.clear(runId, gameId);
    }
  }

  nextPlayoffPreview(): FullCourtPlayoffOpponentPreview | null {
    const season = this.season;
    const playoffs = this.playoffs;
    if (season === null || playoffs === null) return null;
    return fullCourtUserNextPlayoffMatchup({
      userTeamId: season.lock.season.userTeamId,
      runSeed: season.lock.season.runSeed,
      series: playoffs.view.series,
    });
  }

  nextFilmTarget(): Extract<FullCourtReportTarget, { kind: 'opponent-film' }> | null {
    const season = this.season;
    if (season === null) return null;
    if (this.playoffs !== null) {
      const nextPlayoff = this.nextPlayoffPreview();
      return nextPlayoff === null
        ? null
        : {
            kind: 'opponent-film',
            gameId: nextPlayoff.gameId,
            opponentTeamId: nextPlayoff.opponentTeamId,
          };
    }
    const { userTeamId, games } = season.lock.season;
    const next = games.find(
      (game) =>
        game.slot === season.checkpoint.completedThroughSlot + 1 &&
        (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
    );
    if (!next) return null;
    const opponentTeamId =
      next.homeTeamId === userTeamId
        ? next.awayTeamId
        : next.awayTeamId === userTeamId
          ? next.homeTeamId
          : null;
    return opponentTeamId === null
      ? null
      : { kind: 'opponent-film', gameId: next.gameId, opponentTeamId };
  }

  purchaseReport(target: FullCourtReportTarget): Promise<void> {
    return this.#act(async () => {
      const draft = this.draft;
      if (draft === null) return;
      if (target.kind === 'opponent-film' && target.gameId !== undefined) {
        const next = this.nextFilmTarget();
        if (
          next === null ||
          next.gameId !== target.gameId ||
          next.opponentTeamId !== target.opponentTeamId
        ) {
          throw new Error('Film study is available for your next game.');
        }
      }
      await this.#submit({
        command: 'purchase-full-court-report',
        commandId: newSeasonId('command'),
        runId: draft.runId,
        expectedRevision: draft.revision,
        target,
      });
    });
  }

  runPractice(requestedOpponentId?: string): Promise<void> {
    return this.#act(async () => {
      const season = this.season;
      const draft = this.draft;
      if (season === null || draft === null) return;
      const runId = season.lock.season.runId;
      const [savedDraft, checkpoint] = await Promise.all([
        this.#repositories.fullCourtDraftRepository.load(runId),
        this.#repositories.fullCourtSeasonRepository.load(runId),
      ]);
      if (this.#isDisposed()) return;
      if (savedDraft !== null) this.draft = savedDraft;
      const currentDraft = savedDraft ?? draft;
      if (checkpoint === null || checkpoint.lockDigest !== season.lock.digest) {
        throw new Error('Training camp practice needs the saved season. Reload the run.');
      }
      const camp = (currentDraft.reports ?? []).find((report) => report.kind === 'training-camp');
      if (camp === undefined) {
        throw new Error('Unlock training camp before running a scrimmage.');
      }
      const opponents = season.lock.season.teams.filter(
        (team) => team.teamId !== season.lock.season.userTeamId,
      );
      if (opponents.length === 0) throw new Error('No practice opponent is available.');
      const pickedOpponent =
        requestedOpponentId && requestedOpponentId !== 'random'
          ? opponents.find((team) => team.teamId === requestedOpponentId)
          : opponents[Math.floor(Math.random() * opponents.length)];
      const opponentTeamId = (pickedOpponent ?? opponents[0])?.teamId;
      if (opponentTeamId === undefined) throw new Error('No practice opponent is available.');
      const worker = (this.#worker ??= this.#createWorker());
      const simulatePractice = worker.simulatePractice?.bind(worker);
      if (simulatePractice === undefined) {
        throw new Error('Training camp practice is unavailable in this worker.');
      }
      this.#practiceRunCount += 1;
      const fixture = fullCourtNextUserFixture(
        season.lock,
        checkpoint,
        this.playoffs?.view ?? null,
      );
      const defensiveMatchups =
        fixture === null
          ? undefined
          : this.#activeDefensiveMatchupsFor(fixture.gameId, opponentTeamId);
      const report = await simulatePractice(season.lock, {
        seed: fullCourtTrainingCampSeed(
          season.lock.season.runSeed,
          `${camp.reportId}:${opponentTeamId}:${String(this.#practiceRunCount)}`,
        ),
        opponentTeamId,
        options: {
          rotation: fullCourtRotationInputForPlan(season.coaching),
          tactics: season.coaching.tactics,
          rules: season.coaching.rules,
          hierarchy: season.coaching.hierarchy,
          ...(defensiveMatchups === undefined ? {} : { defensiveMatchups }),
        },
      });
      if (this.#isDisposed()) return;
      this.practice = report;
    });
  }

  purchaseSpin(purchase: 'standard' | 'surge', targetPlayerVersionId: string): Promise<void> {
    return this.#act(async () => {
      const draft = this.draft;
      if (draft === null) return;
      await this.#submit({
        command: 'purchase-full-court-spin',
        commandId: newSeasonId('command'),
        runId: draft.runId,
        expectedRevision: draft.revision,
        purchase,
        targetPlayerVersionId,
      });
    });
  }

  skipSpin(): Promise<void> {
    return this.#act(async () => {
      const draft = this.draft;
      if (draft === null) return;
      await this.#submit({
        command: 'skip-full-court-spin',
        commandId: newSeasonId('command'),
        runId: draft.runId,
        expectedRevision: draft.revision,
      });
    });
  }

  finalizeRoulette(): Promise<void> {
    return this.#act(async () => {
      const draft = this.draft;
      if (draft === null) return;
      await this.#submit({
        command: 'finalize-full-court-roulette',
        commandId: newSeasonId('command'),
        runId: draft.runId,
        expectedRevision: draft.revision,
      });
      await this.#openRun(draft.runId);
    });
  }

  listBlueprints(): Promise<FullCourtBlueprint[]> {
    return this.#repositories.fullCourtBlueprintRepository.list();
  }

  saveBlueprint(
    name: string,
    tactics: FullCourtTactics,
    options?: SaveFullCourtBlueprintOptions,
  ): Promise<FullCourtBlueprint> {
    return saveFullCourtBlueprint(
      name,
      tactics,
      this.#repositories.fullCourtBlueprintRepository,
      options,
    );
  }

  removeBlueprint(name: string): Promise<void> {
    return this.#repositories.fullCourtBlueprintRepository.remove(name);
  }

  async saveCoaching(plan: FullCourtCoachingPlan): Promise<boolean> {
    let saved = false;
    await this.#act(async () => {
      const season = this.season;
      if (season === null) return;
      const coaching = await saveFullCourtCoaching(
        { command: 'set-full-court-coaching', runId: season.lock.season.runId, plan },
        season.lock,
        this.#repositories.fullCourtCoachingRepository,
      );
      if (this.#isDisposed()) return;
      this.season = { ...season, coaching };
      this.practice = null;
      this.pendingForfeit = false;
      saved = true;
    });
    return saved;
  }

  advance(
    count: number,
    acceptForfeit = false,
    record = false,
    options: FullCourtAdvanceOptions = {},
  ): Promise<void> {
    return this.#act(async () => {
      const season = this.season;
      if (season === null) return;
      this.simulating = true;
      await this.#nextGamePlanWrite;
      if (this.#isDisposed()) return;
      this.notice = null;
      this.pendingForfeit = false;
      const nextFixture = this.#nextUserFixture();
      if (this.restingForGameId !== null && this.restingForGameId !== nextFixture?.gameId) {
        this.#clearRest();
      }
      const nextOpponentId =
        nextFixture === null
          ? null
          : nextFixture.homeTeamId === season.lock.season.userTeamId
            ? nextFixture.awayTeamId
            : nextFixture.homeTeamId;
      if (
        this.defensiveMatchupsForGameId !== null &&
        (this.defensiveMatchupsForGameId !== nextFixture?.gameId ||
          this.defensiveMatchupsOpponentId !== nextOpponentId)
      ) {
        this.#clearDefensiveMatchups();
      }
      if (nextFixture !== null && this.restingPlayerIds.length > 0) {
        const readiness = this.#gameDayReadiness(nextFixture, this.restingPlayerIds);
        if (readiness?.restConflict === true) {
          this.error = 'Your rest plan leaves fewer than five available. Uncheck rest to continue.';
          return;
        }
      }
      const pinned: PinnedGamePlan = {
        restGameId: this.restingForGameId,
        restingPlayerIds: this.restingPlayerIds,
        matchupGameId: this.defensiveMatchupsForGameId,
        matchupOpponentId: this.defensiveMatchupsOpponentId,
        matchupAssignments: this.defensiveMatchupAssignments,
      };
      const { lock, coaching } = season;
      const worker = (this.#worker ??= this.#createWorker());
      const input: AdvanceRunInput = {
        count,
        acceptForfeit,
        record,
        options,
        lock,
        coaching,
        pinned,
        worker,
      };
      const stop =
        this.playoffs !== null
          ? await this.#advancePlayoffGames(input)
          : await this.#advanceRegularSeason(input);
      if (this.#isDisposed() || stop === null) return;
      const playerNames = new Map<string, string>(
        (
          lock.season.teams.find((team) => team.teamId === lock.season.userTeamId)?.roster ?? []
        ).map((player) => [player.playerId, player.displayName]),
      );
      this.notice = fullCourtSimulationNotice(
        stop,
        (teamId) => lock.season.teams.find((team) => team.teamId === teamId)?.displayName ?? teamId,
        (playerId) => playerNames.get(playerId) ?? playerId,
      );
    });
  }

  #slotOptions(input: {
    readonly coaching: FullCourtCoachingPlan;
    readonly pinned: PinnedGamePlan;
    readonly userGameId: string | null;
    readonly acceptForfeit: boolean;
    readonly record: boolean;
  }): FullCourtSeasonSlotOptions {
    const { coaching, pinned, userGameId } = input;
    const matchupGameId = pinned.matchupGameId;
    const matchupOpponentId = pinned.matchupOpponentId;
    return {
      acceptForfeit: input.acceptForfeit,
      rotation: fullCourtRotationInputForPlan(coaching),
      tactics: coaching.tactics,
      rules: coaching.rules,
      hierarchy: coaching.hierarchy,
      record: input.record,
      ...(pinned.restGameId !== null &&
      pinned.restGameId === userGameId &&
      pinned.restingPlayerIds.length > 0
        ? { restingPlayerIds: pinned.restingPlayerIds }
        : {}),
      ...(matchupGameId !== null &&
      matchupOpponentId !== null &&
      matchupGameId === userGameId &&
      pinned.matchupAssignments.length > 0
        ? {
            defensiveMatchups: {
              gameId: matchupGameId,
              opponentTeamId: matchupOpponentId,
              assignments: [...pinned.matchupAssignments],
            },
          }
        : {}),
    };
  }

  #regularInjuryStop(
    outcome: RegularSimulatedOutcome,
    lock: FullCourtSeasonLock,
  ): FullCourtSimulationStop | null {
    if (outcome.userGame.kind !== 'played') return null;
    const userTeamId = lock.season.userTeamId;
    const injuries = outcome.userGame.injuries.filter((injury) => injury.teamId === userTeamId);
    if (injuries.length === 0) return null;
    const nextFixture = fullCourtNextUserFixture(lock, outcome.checkpoint, null);
    const actionable = injuries.filter(
      (injury) => nextFixture === null || injury.availableFromDay > nextFixture.dayOffset,
    );
    if (actionable.length === 0) return null;
    return {
      kind: 'injury',
      slot: outcome.checkpoint.completedThroughSlot,
      playerIds: [...new Set(actionable.map((injury) => injury.playerId))],
      availableFromDay: Math.max(...actionable.map((injury) => injury.availableFromDay)),
    };
  }

  async #advanceRegularSeason(input: AdvanceRunInput): Promise<FullCourtSimulationStop | null> {
    const { lock, coaching, pinned, worker } = input;
    const userTeamId = lock.season.userTeamId;
    const repository = this.#repositories.fullCourtSeasonRepository;
    let acceptNextForfeit = input.acceptForfeit;
    let played = 0;
    while (!this.#isDisposed()) {
      if (this.stopRequested) {
        return { kind: 'stopped', userGames: played, bracketGames: 0 };
      }
      const season = this.season;
      if (season === null) return null;
      if (season.checkpoint.completedThroughSlot >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
        return input.count > 1 && played > 0
          ? { kind: 'game-limit', userGames: played, bracketGames: 0 }
          : null;
      }
      if (played >= input.count) {
        return input.count > 1 && played > 0
          ? { kind: 'game-limit', userGames: played, bracketGames: 0 }
          : null;
      }
      const slot = season.checkpoint.completedThroughSlot + 1;
      const userFixture = lock.season.games.find(
        (game) =>
          game.slot === slot && (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
      );
      const userGameId = userFixture?.gameId ?? null;
      const slotOptions = this.#slotOptions({
        coaching,
        pinned,
        userGameId,
        acceptForfeit: acceptNextForfeit,
        record: input.record && input.count === 1,
      });
      const outcome = await advanceFullCourtSeasonSlot(
        { lock, expectedThroughSlot: season.checkpoint.completedThroughSlot, options: slotOptions },
        { repository, simulateSlot: (...args) => worker.simulateSlot(...args) },
      );
      if (this.#isDisposed()) return null;
      if (outcome.kind === 'decision') {
        this.pendingForfeit = outcome.reason === 'confirm-forfeit';
        if (!this.pendingForfeit) this.error = 'The current lineup cannot play this game.';
        return null;
      }
      if (outcome.kind === 'stale') {
        await this.#openRun(lock.season.runId);
        this.error = 'This run advanced in another tab. The latest results are loaded.';
        return null;
      }
      if (outcome.kind === 'season-complete') return null;

      acceptNextForfeit = false;
      played += 1;
      await this.#clearCommittedGamePlan(lock.season.runId, userGameId, pinned);
      this.practice = null;
      this.latestGame = outcome.userGame.kind === 'played' ? outcome.userGame : null;
      if (
        slotOptions.record &&
        outcome.userGame.kind === 'played' &&
        outcome.userGame.tape !== null
      ) {
        const playedFixture = lock.season.games.find(
          (game) =>
            game.slot === outcome.checkpoint.completedThroughSlot &&
            (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
        );
        if (playedFixture !== undefined) {
          this.savedReplay = buildFullCourtWatchedReplay({
            phase: 'regular',
            runId: lock.season.runId,
            seasonLockDigest: lock.digest,
            lockDigest: lock.digest,
            gameId: playedFixture.gameId,
            slot: playedFixture.slot,
            dayOffset: playedFixture.dayOffset,
            userTeamId,
            game: outcome.userGame,
          });
        }
      }
      this.season = {
        ...season,
        checkpoint: outcome.checkpoint,
        scores: [...season.scores, ...outcome.scores],
      };
      const completed = outcome.checkpoint.completedThroughSlot;
      if (completed >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
        if (input.options.stopAtReview === true) return { kind: 'review', slot: completed };
        return input.count > 1 ? { kind: 'game-limit', userGames: played, bracketGames: 0 } : null;
      }
      if (input.options.stopAtInjury === true) {
        const injury = this.#regularInjuryStop(outcome, lock);
        if (injury !== null) return injury;
      }
      if (
        input.options.stopAtReview === true &&
        fullCourtNextReviewSlot(season.checkpoint.completedThroughSlot) === completed
      ) {
        return { kind: 'review', slot: completed };
      }
    }
    return input.count > 1 && played > 0
      ? { kind: 'game-limit', userGames: played, bracketGames: 0 }
      : null;
  }

  async #advancePlayoffGames(input: AdvanceRunInput): Promise<FullCourtSimulationStop | null> {
    const { lock, coaching, pinned, worker } = input;
    const userTeamId = lock.season.userTeamId;
    const repository = this.#repositories.fullCourtPlayoffRepository;
    let acceptNextForfeit = input.acceptForfeit;
    let userGames = 0;
    let bracketGames = 0;
    while (!this.#isDisposed()) {
      if (this.stopRequested) {
        return { kind: 'stopped', userGames, bracketGames };
      }
      const playoffs = this.playoffs;
      if (playoffs === null) return null;
      const view = playoffs.view;
      if (view.nextGame === null) {
        await this.#archiveCompletedRun(playoffs.lock, playoffs.checkpoint);
        return {
          kind: 'playoffs-complete',
          championTeamId: view.championTeamId ?? '',
          userTeamId,
        };
      }
      const userAlive = view.userOutcome.status === 'pending';
      if (userAlive ? userGames >= input.count : bracketGames >= input.count) {
        return input.count > 1 ? { kind: 'game-limit', userGames, bracketGames } : null;
      }
      const fixture = view.nextGame;
      const nextIsUser = fixture.userSide !== null;
      if (userAlive && nextIsUser && !input.record) {
        const preview = fullCourtUserNextPlayoffMatchup({
          userTeamId,
          runSeed: lock.season.runSeed,
          series: view.series,
        });
        const lastDecided = view.series
          .filter(
            (series) =>
              (series.highTeamId === userTeamId || series.lowTeamId === userTeamId) &&
              capRushSeriesWinner(series) !== null,
          )
          .at(-1);
        const nextSeriesId =
          preview === null ? null : capRushPlayoffSeriesId(preview.round, preview.seriesSlot);
        if (
          preview !== null &&
          nextSeriesId !== null &&
          preview.gameOrdinal === 1 &&
          lastDecided !== undefined &&
          lastDecided.seriesId !== nextSeriesId &&
          this.#controlReturnedForSeriesId !== nextSeriesId
        ) {
          this.#controlReturnedForSeriesId = nextSeriesId;
          return {
            kind: 'opponent-change',
            round: preview.round,
            opponentTeamId: preview.opponentTeamId,
            gameOrdinal: preview.gameOrdinal,
          };
        }
      }
      const userGameId = nextIsUser ? fixture.gameId : null;
      const slotOptions = this.#slotOptions({
        coaching,
        pinned,
        userGameId,
        acceptForfeit: acceptNextForfeit && nextIsUser,
        record: input.record && input.count === 1 && nextIsUser,
      });
      const outcome = await advanceFullCourtPlayoffs(
        {
          lock: playoffs.lock,
          expectedGames: playoffs.checkpoint.games.length,
          options: slotOptions,
        },
        { repository, simulateGame: (...args) => worker.simulateGame(...args) },
      );
      if (this.#isDisposed()) return null;
      if (outcome.kind === 'decision') {
        this.pendingForfeit = outcome.reason === 'confirm-forfeit';
        if (!this.pendingForfeit) this.error = 'The current lineup cannot play this game.';
        return null;
      }
      if (outcome.kind === 'stale') {
        await this.#openRun(lock.season.runId);
        this.error = 'This run advanced in another tab. The latest results are loaded.';
        return null;
      }
      if (outcome.kind === 'playoffs-complete') {
        return {
          kind: 'playoffs-complete',
          championTeamId: view.championTeamId ?? '',
          userTeamId,
        };
      }

      bracketGames += 1;
      const nextView = fullCourtPlayoffView(playoffs.lock, outcome.checkpoint);
      this.playoffs = { ...playoffs, checkpoint: outcome.checkpoint, view: nextView };
      if (!nextIsUser) {
        if (nextView.nextGame === null) {
          await this.#archiveCompletedRun(playoffs.lock, outcome.checkpoint);
          return {
            kind: 'playoffs-complete',
            championTeamId: nextView.championTeamId ?? '',
            userTeamId,
          };
        }
        continue;
      }

      userGames += 1;
      acceptNextForfeit = false;
      this.#controlReturnedForSeriesId = null;
      await this.#clearCommittedGamePlan(lock.season.runId, userGameId, pinned);
      this.practice = null;
      this.latestGame = outcome.game.kind === 'played' ? outcome.game : null;
      if (
        slotOptions.record &&
        fixture.userSide !== null &&
        outcome.game.kind === 'played' &&
        outcome.game.tape !== null
      ) {
        this.savedReplay = buildFullCourtWatchedReplay({
          phase: 'playoff',
          runId: lock.season.runId,
          seasonLockDigest: lock.digest,
          lockDigest: playoffs.lock.digest,
          gameId: fixture.gameId,
          slot: null,
          dayOffset: fixture.dayOffset,
          userTeamId,
          game: outcome.game,
        });
      }
      if (nextView.nextGame === null) {
        await this.#archiveCompletedRun(playoffs.lock, outcome.checkpoint);
        return {
          kind: 'playoffs-complete',
          championTeamId: nextView.championTeamId ?? '',
          userTeamId,
        };
      }

      const series = fullCourtUserSeries(nextView.series, userTeamId);
      if (
        series !== null &&
        series.games.at(-1)?.gameId === fixture.gameId &&
        capRushSeriesWinner(series) !== null
      ) {
        const opponentTeamId =
          series.highTeamId === userTeamId ? series.lowTeamId : series.highTeamId;
        return {
          kind: 'series-complete',
          round: series.round,
          opponentTeamId,
          won: capRushSeriesWinner(series) === userTeamId,
          userWins: capRushSeriesWins(series, userTeamId),
          opponentWins: capRushSeriesWins(series, opponentTeamId),
        };
      }

      const nextPreview = fullCourtUserNextPlayoffMatchup({
        userTeamId,
        runSeed: lock.season.runSeed,
        series: nextView.series,
      });
      const opponentSide = fixture.userSide === 'home' ? 'away' : 'home';
      const applied = outcome.checkpoint.games.at(-1)?.adaptations?.[opponentSide];
      if (
        input.options.ignoreOpponentAdjustment !== true &&
        nextPreview?.adaptation !== null &&
        nextPreview?.adaptation !== undefined &&
        fullCourtPlayoffAdjustmentChanged(applied, nextPreview.adaptation)
      ) {
        return {
          kind: 'opponent-adjustment',
          round: nextPreview.round,
          opponentTeamId: nextPreview.opponentTeamId,
          gameOrdinal: nextPreview.gameOrdinal,
          adaptation: nextPreview.adaptation,
        };
      }

      if (userGames >= input.count && input.count > 1) {
        return { kind: 'game-limit', userGames, bracketGames };
      }
    }
    return { kind: 'stopped', userGames, bracketGames };
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
    await this.#nextGamePlanWrite;
    const draft = await this.#repositories.fullCourtDraftRepository.load(runId);
    if (this.#isDisposed()) return;
    this.draft = draft;
    this.pendingForfeit = false;
    this.notice = null;
    this.#controlReturnedForSeriesId = null;
    this.latestGame = null;
    this.practice = null;
    this.savedReplay = null;
    this.#clearRest();
    this.#clearDefensiveMatchups();
    if (draft?.stage !== 'complete') {
      this.season = null;
      this.playoffs = null;
      return;
    }
    if (
      draft.variant === 'roulette' &&
      draft.roulette !== undefined &&
      draft.roulette.status !== 'finalized'
    ) {
      this.season = null;
      this.playoffs = null;
      return;
    }

    const assets = this.#assets;
    const regular = this.#repositories.fullCourtSeasonRepository;
    const reused = this.season?.lock.season.runId === runId ? this.season.lock : null;
    const existing = reused === null ? await regular.load(runId) : null;
    if (this.#isDisposed()) return;
    const lock =
      reused ??
      (await resolveFullCourtSeasonLock({
        season: buildFullCourtRegularSeason({ ...assets, draft }),
        checkpoint: existing,
        catalogAssetHash: assets.catalogAssetHash,
        loadProfiles: () => this.#loadHealthProfiles(assets.catalogAssetHash),
      }));
    const [checkpoint, savedCoaching, savedReplay] = await Promise.all([
      startFullCourtSeason(lock, regular),
      this.#repositories.fullCourtCoachingRepository.load(runId),
      this.#repositories.fullCourtWatchedReplayRepository.load(runId),
    ]);
    if (
      savedReplay !== null &&
      (savedReplay.identity.seasonLockDigest !== lock.digest ||
        savedReplay.identity.userTeamId !== lock.season.userTeamId)
    ) {
      throw new Error('Full Court watched replay does not match the locked season');
    }
    const coaching = savedCoaching ?? FULL_COURT_DEFAULT_COACHING_PLAN;
    const userTeam = lock.season.teams.find((team) => team.teamId === lock.season.userTeamId);
    if (userTeam === undefined) throw new Error('The Full Court roster is unavailable.');
    assertFullCourtCoachingRoster(coaching, userTeam.roster);
    const scores = (await regular.listScores(runId)).filter(
      (score) => score.slot <= checkpoint.completedThroughSlot,
    );
    const playoffSave =
      checkpoint.completedThroughSlot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM
        ? await this.#repositories.fullCourtPlayoffRepository.load(runId)
        : null;
    if (this.#isDisposed()) return;
    this.season = { lock, checkpoint, scores, coaching };
    this.savedReplay = savedReplay;
    if (playoffSave === null) this.playoffs = null;
    else await this.#openPlayoffs(lock);
    if (!this.#isDisposed()) await this.#restoreNextGamePlan(runId);
  }

  async #openPlayoffs(lock: FullCourtSeasonLock): Promise<void> {
    const state = await startFullCourtPlayoffs(lock, {
      regular: this.#repositories.fullCourtSeasonRepository,
      playoffs: this.#repositories.fullCourtPlayoffRepository,
    });
    if (this.#isDisposed()) return;
    this.#controlReturnedForSeriesId = null;
    this.playoffs = state;
    if (state.view.nextGame === null) {
      await this.#archiveCompletedRun(state.lock, state.checkpoint);
    }
  }

  async #archiveCompletedRun(
    lock: FullCourtPlayoffLock,
    checkpoint: FullCourtPlayoffCheckpoint,
  ): Promise<void> {
    const draft = this.draft;
    const season = this.season;
    if (draft === null || season === null || draft.runId !== lock.seasonLock.season.runId) return;
    await archiveFullCourtRun(
      {
        draft,
        coaching: season.coaching,
        lock,
        checkpoint,
      },
      this.#repositories.fullCourtHistoryRepository,
    );
    await this.#repositories.fullCourtNextGamePlanRepository.clear(draft.runId);
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
