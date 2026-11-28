import {
  FullCourtAdvanceSession,
  advanceFullCourtPlayoffs,
  advanceFullCourtSeasonSlot,
  archiveFullCourtRun,
  fullCourtRotationInputForPlan,
  saveFullCourtBlueprint,
  saveFullCourtCoaching,
  startFullCourtPlayoffs,
  startFullCourtSeason,
  submitFullCourtDraftCommand,
  type FullCourtAdvanceOptions,
  type FullCourtAdvancePlayoffCommandInput,
  type FullCourtAdvancePlayoffState,
  type FullCourtAdvanceSeasonCommandInput,
  type FullCourtAdvanceSeasonState,
  type FullCourtPinnedGamePlan,
  type FullCourtPlayoffProgressionResult,
  type SaveFullCourtBlueprintOptions,
} from '@hoop-rush/application/full-court';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
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
  type FullCourtReportKind,
  type FullCourtReportTarget,
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
  fullCourtNextUserFixture,
  fullCourtSimulationNotice,
  type FullCourtSimulationNotice,
  type FullCourtUserFixture,
} from './full-court-season-presenter.js';
import { createFullCourtWorkerRunner } from './full-court-worker-runner.js';

export interface FullCourtControllerDependencies {
  readonly loadAssets?: typeof loadFullCourtAssets;
  readonly loadHealthProfiles?: typeof loadFullCourtHealthProfiles;
  readonly repositories?: Persistence;
  readonly createWorker?: typeof createFullCourtWorkerRunner;
}

type SeasonState = FullCourtAdvanceSeasonState;
type PlayoffState = FullCourtAdvancePlayoffState;
type PlayedGame = Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;

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
  simProgress = $state.raw<{ completed: number; total: number } | null>(null);
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
  #progression: FullCourtAdvanceSession;
  #nextGamePlanWrite = Promise.resolve();

  constructor(dependencies: FullCourtControllerDependencies = {}) {
    this.#loadAssets = dependencies.loadAssets ?? loadFullCourtAssets;
    this.#loadHealthProfiles = dependencies.loadHealthProfiles ?? loadFullCourtHealthProfiles;
    this.#repositories = dependencies.repositories ?? getPersistence();
    this.#createWorker = dependencies.createWorker ?? createFullCourtWorkerRunner;
    this.#progression = new FullCourtAdvanceSession({
      advanceSeasonSlot: (input) => this.#advanceSeasonSlot(input),
      advancePlayoffGame: (input) => this.#advancePlayoffGame(input),
      observer: {
        isActive: () => !this.#isDisposed(),
        stopRequested: () => this.stopRequested,
        progress: (completed, total) => {
          this.simProgress = { completed, total };
        },
        seasonCommitted: (commit) => {
          const season = this.season;
          if (season === null) return;
          this.season = {
            ...season,
            checkpoint: commit.checkpoint,
            scores: [...season.scores, ...commit.scores],
          };
        },
        playoffsCommitted: (commit) => {
          this.playoffs = commit.state;
        },
        publishedGame: (game, watchedReplay) => {
          this.#publishCommittedUserGame(game, watchedReplay);
        },
        clearGamePlan: (input) =>
          this.#clearCommittedGamePlan(input.runId, input.gameId, input.pinned),
        archiveRun: (lock, checkpoint) => this.#archiveCompletedRun(lock, checkpoint),
      },
    });
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
    variant: 'standard' = 'standard',
    perks: readonly FullCourtReportKind[] = [],
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

  abandonRun(): Promise<void> {
    return this.#act(async () => {
      const runId =
        this.draft?.runId ??
        this.season?.lock.season.runId ??
        localStorage.getItem(FULL_COURT_ACTIVE_RUN_KEY);
      localStorage.removeItem(FULL_COURT_ACTIVE_RUN_KEY);
      if (runId !== null) {
        await this.#nextGamePlanWrite;
        await this.#repositories.fullCourtNextGamePlanRepository.clear(runId);
      }
      this.draft = null;
      this.season = null;
      this.playoffs = null;
      this.latestGame = null;
      this.practice = null;
      this.savedReplay = null;
      this.notice = null;
      this.pendingForfeit = false;
      this.#progression.reset();
      this.#clearRest();
      this.#clearDefensiveMatchups();
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
    plan: FullCourtPinnedGamePlan,
  ): Promise<void> {
    if (gameId === null) return;
    if (plan.restGameId === gameId) this.#clearRest();
    if (plan.matchupGameId === gameId) this.#clearDefensiveMatchups();
    if (plan.restGameId !== gameId && plan.matchupGameId !== gameId) return;
    try {
      await this.#repositories.fullCourtNextGamePlanRepository.clear(runId, gameId);
    } catch (error) {
      if (!this.#isDisposed()) this.error ??= errorMessageOf(error);
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
      if (checkpoint.completedThroughSlot > 0) {
        throw new Error('Training camp practice closes before the first regular-season game.');
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
      const pinned: FullCourtPinnedGamePlan = {
        restGameId: this.restingForGameId,
        restingPlayerIds: this.restingPlayerIds,
        matchupGameId: this.defensiveMatchupsForGameId,
        matchupOpponentId: this.defensiveMatchupsOpponentId,
        matchupAssignments: this.defensiveMatchupAssignments,
      };
      const { lock } = season;
      const outcome = await this.#progression.advance({
        count,
        acceptForfeit,
        record,
        options,
        season,
        playoffs: this.playoffs,
        pinned,
      });
      if (this.#isDisposed()) return;
      if (outcome.kind === 'decision') {
        this.pendingForfeit = outcome.reason === 'confirm-forfeit';
        if (!this.pendingForfeit) this.error = 'The current lineup cannot play this game.';
        return;
      }
      if (outcome.kind === 'stale') {
        await this.#openRun(lock.season.runId);
        this.error = 'This run advanced in another tab. The latest results are loaded.';
        return;
      }
      const stop = outcome.stop;
      if (stop === null) return;
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

  #publishCommittedUserGame(
    game: PlayedGame | null,
    watchedReplay: FullCourtWatchedReplay | null,
  ): void {
    this.practice = null;
    this.latestGame = game;
    if (watchedReplay !== null) this.savedReplay = watchedReplay;
  }

  #advanceSeasonSlot(input: FullCourtAdvanceSeasonCommandInput) {
    const worker = (this.#worker ??= this.#createWorker());
    return advanceFullCourtSeasonSlot(input, {
      repository: this.#repositories.fullCourtSeasonRepository,
      simulateSlot: (...args) => worker.simulateSlot(...args),
    });
  }

  async #advancePlayoffGame(
    input: FullCourtAdvancePlayoffCommandInput,
  ): Promise<FullCourtPlayoffProgressionResult> {
    const worker = (this.#worker ??= this.#createWorker());
    const outcome = await advanceFullCourtPlayoffs(input, {
      repository: this.#repositories.fullCourtPlayoffRepository,
      simulateGame: (...args) => worker.simulateGame(...args),
    });
    return outcome.kind === 'simulated'
      ? { ...outcome, view: fullCourtPlayoffView(input.lock, outcome.checkpoint) }
      : outcome;
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
    this.#progression.reset();
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
    this.#progression.reset();
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
        this.simProgress = null;
        this.stopRequested = false;
      }
    }
  }
}
