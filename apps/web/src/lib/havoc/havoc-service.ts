import {
  HAVOC_GAME_COUNT,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  canonicalJson,
  havocAbandonRunCommandSchema,
  havocAcceptGameCommandSchema,
  havocAcceptNormalGameCommandSchema,
  havocCommandResultSchema,
  havocCompleteComparisonCommandSchema,
  havocCreateDraftCommandSchema,
  havocLockLineupCommandSchema,
  havocPickCardCommandSchema,
  havocRerollOfferCommandSchema,
  havocWorkerSimulateRequestSchema,
  havocWorkerTapeRequestSchema,
  idSchema,
  seasonDigestHex,
  type HavocCatalogSource,
  type HavocCatalog,
  type HavocCommand,
  type HavocCommandResult,
  type HavocComparison,
  type HavocGameResult,
  type HavocGameSummary,
  type HavocLockedInputs,
  type HavocReport,
  type HavocRunState,
  type HavocVariant,
  type HavocVersionSet,
  type HavocWorkerCompleteMessage,
  type HavocWorkerGameMessage,
  type HavocWorkerSimulateRequest,
  type HavocWorkerTapeMessage,
  type HavocWorkerTapeRequest,
  type HoopRushManifest,
  type EraSimulationProfile,
  type OpponentBracket,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  AdaptHavocCatalog,
  ApplyHavocCommand,
  CreateHavocRunState,
  ENGINE_VERSION,
  HavocStateDigest,
  compareHavocSeasons,
  createHavocCommandEnvironment,
  deriveHavocReport,
  havocGameResultDigest,
  havocGameSummaryOf,
  type HavocStoredGame,
} from '@hoop-rush/engine';
import { DexieHavocRepository, HavocLoadError, type HavocRepository } from '@hoop-rush/persistence';
import { getManifest } from '$lib/data';
import { newRequestId, newSeasonId, seasonRootSeed } from '$lib/ids';
import { loadRunPreamble } from '$lib/run-preamble';
import { loadSeasonDraftCatalog } from '$lib/season/season-assets';
import { HavocRunner, type HavocBatchHandlers } from './havoc-runner';
import {
  HavocServiceError,
  type HavocActiveSnapshot,
  type HavocBatchResult,
  type HavocHistoryView,
  type HavocLineupSlotView,
  type HavocRunView,
  type HavocService,
  type HavocServiceEvent,
  type HavocSimulationProgress,
  type HavocWatchSession,
} from './havoc-service-contract';

interface HavocAssets {
  catalog: HavocCatalog;
  catalogSource: HavocCatalogSource;
  versionSet: HavocVersionSet;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
}

export interface HavocRunnerLike {
  startBatch(
    request: HavocWorkerSimulateRequest,
    handlers: HavocBatchHandlers,
  ): Promise<HavocWorkerCompleteMessage>;
  runTape(request: HavocWorkerTapeRequest): Promise<HavocWorkerTapeMessage>;
  cancel(): void;
  dispose(): void;
}

export interface CreateHavocServiceOptions {
  repository?: HavocRepository;
  runner?: HavocRunnerLike;
  loadCatalog?: () => Promise<SeasonDraftCatalog>;
  loadPreamble?: () => Promise<{ profile: EraSimulationProfile; bracket: OpponentBracket }>;
  loadManifest?: () => Promise<HoopRushManifest>;
  newRunId?: () => string;
  newCommandId?: () => string;
}

function lockedDigestOf(locked: HavocLockedInputs): string {
  return seasonDigestHex(`havoc-locked-v1:${canonicalJson(locked)}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown havoc service failure';
}

class HavocAppService implements HavocService {
  private readonly repository: HavocRepository;
  private readonly runner: HavocRunnerLike;
  private readonly loadCatalog: () => Promise<SeasonDraftCatalog>;
  private readonly loadPreamble: () => Promise<{
    profile: EraSimulationProfile;
    bracket: OpponentBracket;
  }>;
  private readonly loadManifest: () => Promise<HoopRushManifest>;
  private readonly newRunId: () => string;
  private readonly newCommandId: () => string;
  private readonly listeners = new Set<(event: HavocServiceEvent) => void>();
  private run: HavocRunState | null = null;
  private lastRunId: string | null = null;
  private lastAcceptedResult: HavocCommandResult | null = null;
  private lastWatched: {
    runId: string;
    gameNumber: number;
    variant: HavocVariant;
    result: HavocGameResult;
  } | null = null;
  private assetsPromise: Promise<HavocAssets> | null = null;

  constructor(options: CreateHavocServiceOptions) {
    this.repository = options.repository ?? new DexieHavocRepository();
    this.runner = options.runner ?? new HavocRunner();
    this.loadCatalog = options.loadCatalog ?? loadSeasonDraftCatalog;
    this.loadPreamble = options.loadPreamble ?? loadRunPreamble;
    this.loadManifest = options.loadManifest ?? getManifest;
    this.newRunId = options.newRunId ?? (() => idSchema.parse(newSeasonId('havoc-run')));
    this.newCommandId = options.newCommandId ?? (() => newSeasonId('havoc-cmd'));
  }

  subscribe(listener: (event: HavocServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async loadActive(): Promise<HavocActiveSnapshot> {
    return this.guard(async () => {
      const active = await this.repository.loadActiveRun();
      if (active !== null) {
        this.run = active;
        this.lastRunId = active.runId;
        return { run: this.buildRunView(active), draft: active.draft };
      }
      const resumable = await this.findResumableCompleted();
      if (resumable !== null) {
        this.run = resumable;
        this.lastRunId = resumable.runId;
        return { run: this.buildRunView(resumable), draft: null };
      }
      this.run = null;
      return { run: null, draft: null };
    });
  }

  private async findResumableCompleted(): Promise<HavocRunState | null> {
    if (this.lastRunId !== null) {
      const completed = await this.repository.readCompletedRun(this.lastRunId);
      if (completed !== null) return completed.state;
    }
    const history = await this.repository.listHistory();
    const candidate = history.find(
      (entry) =>
        entry.completionState !== 'abandoned' &&
        entry.completionState !== 'complete' &&
        entry.comparisonStatus !== 'complete',
    );
    if (candidate === undefined) return null;
    const completed = await this.repository.readCompletedRun(candidate.runId);
    return completed?.state ?? null;
  }

  async listHistory(): Promise<HavocHistoryView[]> {
    return this.guard(async () => {
      const entries = await this.repository.listHistory();
      return entries.map((entry) => ({ ...entry }));
    });
  }

  async readCompletedRun(runId: string): Promise<{
    run: HavocRunView;
    report: HavocReport | null;
    comparison: HavocComparison | null;
  } | null> {
    return this.guard(async () => {
      const completed = await this.repository.readCompletedRun(runId);
      if (completed === null) return null;
      const comparison = await this.repository.readComparison(runId);
      return {
        run: this.buildRunView(completed.state),
        report: completed.report,
        comparison,
      };
    });
  }

  async createDraft(): Promise<HavocCommandResult> {
    return this.guard(async () => {
      const active = await this.repository.loadActiveRun();
      if (active !== null) {
        throw new HavocServiceError('invalid-phase', 'an active havoc run already exists');
      }
      const assets = await this.loadAssets();
      const runId = this.newRunId();
      const command = havocCreateDraftCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: this.newCommandId(),
        runId,
        command: 'create-havoc-draft',
        runSeed: seasonRootSeed(),
        versionSet: assets.versionSet,
        catalog: assets.catalogSource,
      });
      const environment = createHavocCommandEnvironment(assets.catalog);
      const state = CreateHavocRunState(command, assets.catalog, environment);
      const result = havocCommandResultSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: command.commandId,
        runId,
        status: 'accepted',
        revisionBefore: 0,
        revisionAfter: state.revision,
        stateDigest: HavocStateDigest(state),
        rejection: null,
      });
      const applied = await this.repository.applyOutcome({
        outcome: { state, result },
        command,
      });
      if (applied.status === 'accepted') {
        this.run = state;
        this.lastRunId = state.runId;
      }
      return applied;
    });
  }

  async rerollOffer(): Promise<HavocCommandResult> {
    return this.dispatch((state) => {
      if (state.draft === null) {
        throw new HavocServiceError('invalid-phase', 'the run is not drafting');
      }
      return havocRerollOfferCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: this.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        command: 'reroll-havoc-offer',
        offerId: state.draft.offerId,
      });
    });
  }

  async pickCard(cardId: string): Promise<HavocCommandResult> {
    return this.dispatch((state) => {
      if (state.draft === null) {
        throw new HavocServiceError('invalid-phase', 'the run is not drafting');
      }
      return havocPickCardCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: this.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        command: 'pick-havoc-card',
        offerId: state.draft.offerId,
        cardId,
      });
    });
  }

  async lockLineup(): Promise<HavocCommandResult> {
    return this.dispatch((state) => {
      if (state.draft === null || state.draft.status !== 'complete') {
        throw new HavocServiceError('invalid-phase', 'the draft is not complete');
      }
      return havocLockLineupCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: this.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        command: 'lock-havoc-lineup',
        picks: state.draft.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
      });
    });
  }

  async simulateRange(input: {
    variant: HavocVariant;
    count: number | 'remaining';
  }): Promise<HavocBatchResult> {
    return this.guard(async () => {
      const state = this.requireRun();
      if (state.locked === null) {
        throw new HavocServiceError('invalid-phase', 'the lineup is not locked');
      }
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets);
      if (input.variant === 'normal' && state.havocCursor < HAVOC_GAME_COUNT) {
        throw new HavocServiceError(
          'invalid-phase',
          'the normal season starts only after havoc game 82',
        );
      }
      const cursor = input.variant === 'havoc' ? state.havocCursor : state.normalCursor;
      const remaining = HAVOC_GAME_COUNT - cursor;
      if (remaining <= 0) {
        return { accepted: 0, cancelled: false, nextCursor: cursor };
      }
      const requested =
        input.count === 'remaining' ? remaining : Math.max(1, Math.min(input.count, remaining));
      const requestId = newRequestId('havoc-sim');
      const request = havocWorkerSimulateRequestSchema.parse({
        schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
        type: 'havoc-simulate',
        requestId,
        runId: state.runId,
        revision: state.revision,
        inputDigest: lockedDigestOf(state.locked),
        variant: input.variant,
        cursor,
        count: requested,
        locked: state.locked,
      });
      let accepted = 0;
      const handlers: HavocBatchHandlers = {
        onGame: async (message) => {
          const recomputed = havocGameResultDigest(message.result);
          if (recomputed !== message.resultDigest) {
            throw new HavocServiceError(
              'simulation',
              `game ${String(message.cursor)} failed digest verification`,
            );
          }
          await this.acceptStreamedGame(message);
          accepted += 1;
          this.emit({ type: 'game-accepted', summary: message.summary });
        },
        onProgress: (message) => {
          const progress: HavocSimulationProgress = {
            variant: message.variant,
            gamesCompleted: message.gamesCompleted,
            gamesTotal: message.gamesTotal,
            latestGameNumber: null,
          };
          this.emit({ type: 'progress', progress });
        },
        onError: (message) => {
          this.emit({
            type: 'error',
            code: message.code === 'cancelled' ? 'cancelled' : 'simulation',
            message: message.message,
          });
        },
      };
      let complete: HavocWorkerCompleteMessage;
      try {
        complete = await this.runner.startBatch(request, handlers);
      } catch (error) {
        if (error instanceof HavocServiceError) throw error;
        throw new HavocServiceError('simulation', messageOf(error));
      }
      const nextState = this.requireRun();
      const nextCursor = input.variant === 'havoc' ? nextState.havocCursor : nextState.normalCursor;
      return { accepted, cancelled: complete.cancelled, nextCursor };
    });
  }

  cancelSimulation(): Promise<void> {
    this.runner.cancel();
    return Promise.resolve();
  }

  async watchGame(input: {
    gameNumber: number;
    variant: HavocVariant;
  }): Promise<HavocWatchSession> {
    return this.guard(async () => {
      const state = this.requireRun();
      if (state.locked === null) {
        throw new HavocServiceError('invalid-phase', 'the lineup is not locked');
      }
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets);
      const cursor = input.variant === 'havoc' ? state.havocCursor : state.normalCursor;
      if (input.gameNumber !== cursor + 1) {
        throw new HavocServiceError('invalid-phase', 'only the next game can be watched');
      }
      const request = havocWorkerTapeRequestSchema.parse({
        schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
        type: 'havoc-tape',
        requestId: newRequestId('havoc-tape'),
        runId: state.runId,
        revision: state.revision,
        inputDigest: lockedDigestOf(state.locked),
        variant: input.variant,
        gameNumber: input.gameNumber,
        locked: state.locked,
      });
      const message = await this.runner.runTape(request);
      this.lastWatched = {
        runId: state.runId,
        gameNumber: message.gameNumber,
        variant: message.variant,
        result: message.result,
      };
      return {
        gameNumber: message.gameNumber,
        variant: message.variant,
        seed: message.tape.seed,
        tape: message.tape,
        summary: message.summary,
        result: message.result,
      };
    });
  }

  async acceptGame(input: {
    gameNumber: number;
    variant: HavocVariant;
  }): Promise<HavocCommandResult> {
    return this.guard(async () => {
      const state = this.requireRun();
      const cursor = input.variant === 'havoc' ? state.havocCursor : state.normalCursor;
      if (input.gameNumber <= cursor) {
        const existing = await this.repository.readRunGame(
          state.runId,
          input.variant,
          input.gameNumber,
        );
        if (existing !== null) {
          return this.syntheticAccepted(state);
        }
        throw new HavocServiceError('invalid-phase', 'the game is not part of this run');
      }
      if (input.gameNumber !== cursor + 1) {
        throw new HavocServiceError('invalid-phase', 'games must be accepted in order');
      }
      this.lastAcceptedResult = null;
      const batch = await this.simulateRange({ variant: input.variant, count: 1 });
      const acceptedResult = this.takeLastAcceptedResult();
      if (batch.accepted !== 1 || acceptedResult === null) {
        throw new HavocServiceError('simulation', 'the game was not accepted');
      }
      return acceptedResult;
    });
  }

  async listGames(variant: HavocVariant): Promise<HavocGameSummary[]> {
    return this.guard(async () => {
      const runId = this.requireRunId();
      const results = await this.repository.listRunGames(runId, variant);
      return results
        .map((result) => {
          const digest = havocGameResultDigest(result);
          return havocGameSummaryOf(result, digest);
        })
        .sort((a, b) => a.gameNumber - b.gameNumber);
    });
  }

  async readGame(input: {
    gameNumber: number;
    variant: HavocVariant;
  }): Promise<HavocGameResult | null> {
    return this.guard(async () => {
      const runId = this.requireRunId();
      const stored = await this.repository.readRunGame(runId, input.variant, input.gameNumber);
      if (stored !== null) return stored.result;
      if (
        this.lastWatched !== null &&
        this.lastWatched.runId === runId &&
        this.lastWatched.variant === input.variant &&
        this.lastWatched.gameNumber === input.gameNumber
      ) {
        return this.lastWatched.result;
      }
      return null;
    });
  }

  async startNormalSeason(): Promise<HavocBatchResult> {
    return this.simulateRange({ variant: 'normal', count: 'remaining' });
  }

  async finalizeComparison(): Promise<HavocComparison> {
    return this.guard(async () => {
      const state = this.requireRun();
      if (state.havocCursor < HAVOC_GAME_COUNT || state.normalCursor < HAVOC_GAME_COUNT) {
        throw new HavocServiceError(
          'invalid-phase',
          'both matched seasons must be complete before finalizing',
        );
      }
      const existing = await this.repository.readComparison(state.runId);
      if (existing !== null) return existing;
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets);
      const havocGames = await this.storedGames(state.runId, 'havoc');
      const normalGames = await this.storedGames(state.runId, 'normal');
      const comparison = compareHavocSeasons({
        runId: state.runId,
        locked: state.locked ?? this.throwLocked(),
        havocGames,
        normalGames,
      });
      const report = deriveHavocReport({
        state,
        havocGames,
        normalGames,
        comparison,
      });
      const command = havocCompleteComparisonCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: this.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        command: 'complete-havoc-comparison',
        comparisonDigest: seasonDigestHex(`havoc-comparison-v1:${canonicalJson(comparison)}`),
        reportDigest: seasonDigestHex(`havoc-report-v1:${canonicalJson(report)}`),
        mvp: comparison.mvp,
      });
      const environment = createHavocCommandEnvironment(assets.catalog);
      const outcome = ApplyHavocCommand(state, command, environment, {
        bracket: assets.bracket,
        profile: assets.profile,
      });
      if (outcome.result.status === 'rejected') {
        throw new HavocServiceError(
          'invalid-phase',
          outcome.result.rejection?.message ?? 'comparison finalization was rejected',
        );
      }
      await this.repository.applyOutcome({ outcome, command, comparison, report });
      this.run = outcome.state;
      this.emit({ type: 'comparison-updated', comparison });
      return comparison;
    });
  }

  async readComparison(): Promise<HavocComparison | null> {
    return this.guard(async () => {
      const runId = this.requireRunId();
      return this.repository.readComparison(runId);
    });
  }

  async readReport(): Promise<HavocReport | null> {
    return this.guard(async () => {
      const runId = this.requireRunId();
      return this.repository.readReport(runId);
    });
  }

  async abandon(): Promise<HavocCommandResult> {
    return this.dispatch((state) =>
      havocAbandonRunCommandSchema.parse({
        schemaVersion: HAVOC_SCHEMA_VERSION,
        commandId: this.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        command: 'abandon-havoc-run',
      }),
    );
  }

  async discardStaleActiveRun(): Promise<void> {
    return this.guard(async () => {
      await this.repository.clearActiveRun();
      this.run = null;
      this.lastRunId = null;
      this.lastAcceptedResult = null;
      this.lastWatched = null;
    });
  }

  dispose(): void {
    this.runner.dispose();
    this.listeners.clear();
  }

  private throwLocked(): HavocLockedInputs {
    throw new HavocServiceError('invalid-phase', 'the lineup is not locked');
  }

  private requireRun(): HavocRunState {
    if (this.run === null) {
      throw new HavocServiceError('no-active-run', 'there is no active havoc run');
    }
    return this.run;
  }

  private requireRunId(): string {
    if (this.run !== null) return this.run.runId;
    if (this.lastRunId !== null) return this.lastRunId;
    throw new HavocServiceError('no-active-run', 'there is no havoc run to read');
  }

  private takeLastAcceptedResult(): HavocCommandResult | null {
    const result = this.lastAcceptedResult;
    this.lastAcceptedResult = null;
    return result;
  }

  private syntheticAccepted(state: HavocRunState): HavocCommandResult {
    return havocCommandResultSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: this.newCommandId(),
      runId: state.runId,
      status: 'accepted',
      revisionBefore: state.revision,
      revisionAfter: state.revision,
      stateDigest: HavocStateDigest(state),
      rejection: null,
    });
  }

  private async storedGames(runId: string, variant: HavocVariant): Promise<HavocStoredGame[]> {
    const results = await this.repository.listRunGames(runId, variant);
    return results
      .map((result) => ({
        gameNumber: result.gameNumber,
        result,
        resultDigest: havocGameResultDigest(result),
      }))
      .sort((a, b) => a.gameNumber - b.gameNumber);
  }

  private assertSupportedVersion(state: HavocRunState, assets: HavocAssets): void {
    const locked = state.locked?.versionSet ?? null;
    if (locked === null) return;
    const current = assets.versionSet;
    if (
      locked.engineVersion !== current.engineVersion ||
      locked.catalogVersion !== current.catalogVersion ||
      locked.catalogHash !== current.catalogHash ||
      locked.profileVersion !== current.profileVersion ||
      locked.profileHash !== current.profileHash ||
      locked.bracketHash !== current.bracketHash
    ) {
      throw new HavocServiceError(
        'unsupported-version',
        'this run was created with a different engine or data version and cannot be replayed',
      );
    }
  }

  private async acceptStreamedGame(message: HavocWorkerGameMessage): Promise<void> {
    const state = this.requireRun();
    const assets = await this.loadAssets();
    this.assertSupportedVersion(state, assets);
    const command: HavocCommand =
      message.variant === 'havoc'
        ? havocAcceptGameCommandSchema.parse({
            schemaVersion: HAVOC_SCHEMA_VERSION,
            commandId: this.newCommandId(),
            runId: state.runId,
            expectedRevision: state.revision,
            command: 'accept-havoc-game',
            cursor: message.cursor,
            inputDigest: message.inputDigest,
            resultDigest: message.resultDigest,
            summary: message.summary,
          })
        : havocAcceptNormalGameCommandSchema.parse({
            schemaVersion: HAVOC_SCHEMA_VERSION,
            commandId: this.newCommandId(),
            runId: state.runId,
            expectedRevision: state.revision,
            command: 'accept-havoc-normal-game',
            cursor: message.cursor,
            inputDigest: message.inputDigest,
            resultDigest: message.resultDigest,
            summary: message.summary,
          });
    const environment = createHavocCommandEnvironment(assets.catalog);
    const outcome = ApplyHavocCommand(state, command, environment, {
      bracket: assets.bracket,
      profile: assets.profile,
    });
    if (outcome.result.status === 'rejected') {
      throw new HavocServiceError(
        'simulation',
        outcome.result.rejection?.message ?? 'the accepted game was rejected',
      );
    }
    const applied = await this.repository.applyOutcome({
      outcome,
      command,
      game: {
        result: message.result,
        inputDigest: message.inputDigest,
        resultDigest: message.resultDigest,
      },
    });
    if (applied.status !== 'accepted') {
      throw new HavocServiceError(
        'simulation',
        applied.rejection?.message ?? 'the accepted game was rejected',
      );
    }
    this.run = outcome.state;
    this.lastAcceptedResult = applied;
    if (
      this.lastWatched !== null &&
      this.lastWatched.variant === message.variant &&
      this.lastWatched.gameNumber === message.cursor
    ) {
      this.lastWatched = null;
    }
  }

  private async dispatch(
    build: (state: HavocRunState) => HavocCommand,
  ): Promise<HavocCommandResult> {
    return this.guard(async () => {
      const state = this.requireRun();
      const command = build(state);
      const existing = await this.repository.loadCommandResult(command.commandId);
      if (existing !== null) return existing;
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets);
      const environment = createHavocCommandEnvironment(assets.catalog);
      const outcome = ApplyHavocCommand(state, command, environment, {
        bracket: assets.bracket,
        profile: assets.profile,
      });
      const applied = await this.repository.applyOutcome({ outcome, command });
      if (applied.status === 'accepted') {
        this.run = outcome.state;
        if (outcome.state.completionState === 'abandoned') {
          this.run = null;
        }
      }
      return applied;
    });
  }

  private loadAssets(): Promise<HavocAssets> {
    if (this.assetsPromise === null) {
      this.assetsPromise = this.buildAssets();
    }
    return this.assetsPromise;
  }

  private async buildAssets(): Promise<HavocAssets> {
    const manifest = await this.loadManifest();
    const catalogEntry = manifest.season?.draftCatalog;
    const profileEntry = manifest.eraSimulationProfiles.find((entry) => entry.eraId === '2010s');
    const bracketEntry = manifest.bracket;
    if (catalogEntry === undefined || profileEntry === undefined || bracketEntry === undefined) {
      throw new HavocServiceError('storage', 'the havoc data assets are unavailable');
    }
    const [seasonCatalog, preamble] = await Promise.all([this.loadCatalog(), this.loadPreamble()]);
    const catalogSource: HavocCatalogSource = {
      catalogVersion: seasonCatalog.catalogVersion,
      catalogHash: catalogEntry.contentHash,
      dataVersion: seasonCatalog.dataVersion,
      ratingsVersion: seasonCatalog.ratingsVersion,
      playerVersionIdVersion: seasonCatalog.playerVersionIdVersion,
      positionNormalizationVersion: seasonCatalog.positionNormalizationVersion,
    };
    const versionSet: HavocVersionSet = {
      schemaVersion: HAVOC_SCHEMA_VERSION,
      rulesVersion: HAVOC_RULES_VERSION,
      mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
      seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
      engineVersion: ENGINE_VERSION,
      profileVersion: preamble.profile.profileVersion,
      dataVersion: seasonCatalog.dataVersion,
      catalogVersion: seasonCatalog.catalogVersion,
      catalogHash: catalogEntry.contentHash,
      bracketHash: bracketEntry.contentHash,
      profileHash: profileEntry.contentHash,
    };
    return {
      catalog: AdaptHavocCatalog(seasonCatalog, catalogSource),
      catalogSource,
      versionSet,
      profile: preamble.profile,
      bracket: preamble.bracket,
    };
  }

  private buildRunView(state: HavocRunState): HavocRunView {
    const lineup: HavocLineupSlotView[] =
      state.locked === null
        ? []
        : state.locked.picks.map((pick) => ({
            slot: pick.slot,
            displayName: pick.card.source.displayName,
            nickname: pick.card.nickname,
            playerVersionId: pick.card.source.playerVersionId,
            playerId: pick.card.source.playerId,
            franchiseId: pick.card.source.franchiseId,
            seasonKey: pick.card.source.seasonKey,
            tier: pick.card.tier,
            overall: pick.card.source.originalOverall,
            mutations: pick.card.mutations,
          }));
    let nextOpponentDisplayName: string | null = null;
    let nextHumanHome: boolean | null = null;
    let nextGameNumber: number | null = null;
    if (state.locked !== null && state.havocCursor < HAVOC_GAME_COUNT) {
      const entry = state.locked.schedule[state.havocCursor];
      if (entry !== undefined) {
        nextGameNumber = entry.gameNumber;
        nextHumanHome = entry.humanHome;
        nextOpponentDisplayName =
          state.locked.opponents.find((opponent) => opponent.opponentId === entry.opponentId)?.team
            .displayName ?? null;
      }
    }
    return {
      runId: state.runId,
      revision: state.revision,
      phase: state.phase,
      havocCursor: state.havocCursor,
      normalCursor: state.normalCursor,
      havocWins: state.havocAggregate.wins,
      havocLosses: state.havocAggregate.losses,
      normalWins: state.normalAggregate.wins,
      normalLosses: state.normalAggregate.losses,
      perfectSeason: state.perfectSeason,
      comparisonStatus: state.comparisonStatus,
      completionState: state.completionState,
      lineup,
      nextGameNumber,
      nextOpponentDisplayName,
      nextHumanHome,
    };
  }

  private emit(event: HavocServiceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HavocServiceError) throw error;
      if (error instanceof HavocLoadError && error.code === 'unsupported') {
        throw new HavocServiceError('unsupported-version', messageOf(error));
      }
      throw new HavocServiceError('storage', messageOf(error));
    }
  }
}

export function createHavocService(options: CreateHavocServiceOptions = {}): HavocService {
  return new HavocAppService(options);
}

let activeService: HavocService | null = null;

export function setHavocService(service: HavocService | null): void {
  activeService = service;
}

export function getHavocService(): HavocService {
  if (activeService === null) {
    activeService = createHavocService();
  }
  return activeService;
}
