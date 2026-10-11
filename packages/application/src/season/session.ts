import {
  humanFranchiseIdOf,
  SEASON_RUN_SCHEMA_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  postseasonGameIdSchema,
  seasonSubmitBlockCommandSchema,
  SeasonRunCommandStaleStateError,
  SeasonRunLoadError,
} from '@hoop-rush/data-contracts';
import type {
  CommandId,
  EraSimulationProfile,
  FranchiseId,
  Id,
  SeasonAcceptedBlock,
  SeasonActiveRunIndex,
  SeasonCandidateCheckpoint,
  SeasonDraftCatalog,
  SeasonEffectsState,
  SeasonFreeAgencyIndex,
  SeasonFreeAgencyRoleExpectation,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonHomeCourtProfile,
  SeasonInvalidRosterInterruption,
  SeasonPendingBlockCandidate,
  SeasonPostseasonRotationPayload,
  SeasonPostseasonScoreline,
  SeasonPostseasonSummary,
  SeasonRetainedGameDetail,
  SeasonRosterTargets,
  SeasonRotation,
  SeasonRun,
  SeasonRunCommand,
  SeasonRunCommandRejection,
  SeasonSchedule,
  SeasonScoreline,
  SeasonSpendInfluenceCommand,
  SeasonSubmitBlockCommand,
  SeasonTradeBoardTeamProfile,
  SeasonTradeNegotiation,
  SeasonTradeRosterChange,
  SeasonTradeState,
  SeasonTradeValueTrend,
  SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import {
  completeSeasonBlockCommit,
  handleSeasonRunCommand,
  seasonNextBlockIndex,
  seasonRotationSetDigest,
  type SeasonRunCommandContext,
} from '@hoop-rush/engine';
import { seasonFranchiseLegalFiveFacts } from '@hoop-rush/engine';
import type {
  CommitPostseasonAdvancementInput,
  SeasonRunPlayerSliceEntry,
  SeasonRunSnapshot,
  SeasonWindowOpenResult,
} from '@hoop-rush/persistence';
import { runSubmission } from '../submission.ts';
import {
  acceptWorkerResult,
  type SeasonBlockStartInput,
  type SeasonRunnerEvent,
} from './block-wire.ts';
import {
  assembleCommittedSnapshot,
  challengesWithSuccess,
  dedupeNewByGameId,
  mergeSortedByGameId,
  objectivesWithSuccess,
} from './block-state.ts';
import type { SeasonPostseasonEvent } from './postseason-wire.ts';
import {
  seasonPostseasonCommitResultDigest,
  seasonPostseasonTransactionIdsOf,
} from './postseason-wire.ts';
import { SEASON_BLOCK_POLICY, SEASON_COMMAND_POLICY, canResubmitBlock } from './policies.ts';
import type {
  SeasonAssetPort,
  SeasonBlockRunnerPort,
  SeasonClockPort,
  SeasonDraftCleanerPort,
  SeasonIdPort,
  SeasonNotifierPort,
  SeasonPostseasonRunnerFactory,
  SeasonPostseasonRunnerPort,
  SeasonRunMutation,
  SeasonRunRepositoryPort,
} from './ports.ts';
import { SeasonSnapshotCache, rosterKeyOfSnapshotRun } from './state-cache.ts';
export type BlockPhase = 'idle' | 'running' | 'interrupted' | 'cancelled' | 'failed' | 'complete';
export interface BlockRunState {
  requestId: string | null;
  blockIndex: number | null;
  phase: BlockPhase;
  gamesCompleted: number;
  gamesTotal: number;
  latestGameId: string | null;
  latestResult: SeasonScoreline | null;
  isHumanGame: boolean;
  humanRecordInBlock: { wins: number; losses: number };
  humanResults: SeasonScoreline[];
  leaguePulse: {
    closest: SeasonScoreline | null;
    blowout: SeasonScoreline | null;
    highestScoring: SeasonScoreline | null;
  };
  error: {
    code: string;
    message: string;
    seed: string | null;
    gameId: string | null;
  } | null;
  command: SeasonSubmitBlockCommand | null;
  startInput: SeasonBlockStartInput | null;
}
export interface SubmitBlockEnvelope {
  command: SeasonSubmitBlockCommand;
  start: SeasonBlockStartInput;
}
interface BlockRequestFacts {
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: CommandId;
  rotations: SeasonRotation[];
  run: SeasonRun;
  humanFranchiseId: FranchiseId | null;
  resumePending: SeasonPendingBlockCandidate | null;
  catalogUrl: string;
}
interface BlockResumeBase {
  runId: Id;
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: CommandId;
  rotations: SeasonRotation[];
  humanFranchiseId: FranchiseId | null;
  homeCourt: SeasonHomeCourtProfile;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}
interface BlockCheckpointFacts {
  runId: string;
  revision: number;
  completedRounds: number;
  commandIds: Set<string>;
  summaries: SeasonGameSummary[];
  blocks: SeasonAcceptedBlock[];
  retainedDetails: SeasonRetainedGameDetail[];
  effects: SeasonEffectsState | null;
  health: SeasonHealthState | null;
  stateRevision: number;
  stateDigest: string;
}
export interface SeasonRunCommandError {
  command: SeasonRunCommand['command'];
  rejection: SeasonRunCommandRejection | null;
  message: string;
}
export interface SeasonTradeReceipt {
  command: SeasonRunCommand['command'];
  windowIndex: number | null;
  inquiryId: string | null;
  offerId: string | null;
  rosterChanges: SeasonTradeRosterChange[] | null;
  stateRevision: number;
}
const TRADE_COMMANDS: ReadonlySet<SeasonRunCommand['command']> = new Set([
  'open-trade-inquiry',
  'submit-trade-proposal',
  'respond-to-trade-counter',
  'walk-away-from-trade',
  'purchase-trade-inquiry',
  'accept-trade-offer',
  'decline-trade-offer',
]);
export type SeasonSpendInfluencePurpose = SeasonSpendInfluenceCommand['purpose'];
export type SeasonPostseasonPhase = 'idle' | 'running' | 'cancelled' | 'failed' | 'complete';
export interface SeasonPostseasonProgress {
  phase: SeasonPostseasonPhase;
  gamesCompleted: number;
  gamesTotal: number;
  latestGameId: string | null;
  latestResult: SeasonPostseasonScoreline | null;
  error: {
    code: string;
    message: string;
  } | null;
}
export interface SeasonSessionOptions {
  repository: SeasonRunRepositoryPort;
  blockRunner: SeasonBlockRunnerPort;
  postseasonRunner?: SeasonPostseasonRunnerPort;
  postseasonRunnerFactory?: SeasonPostseasonRunnerFactory;
  assets: SeasonAssetPort;
  notifier: SeasonNotifierPort;
  clock: SeasonClockPort;
  ids: SeasonIdPort;
  draftCleaner: SeasonDraftCleanerPort;
}
export interface SeasonExternalChange {
  kind: SeasonRunMutation['kind'];
  message: string;
}
export interface SeasonSessionView {
  readonly snapshot: SeasonRunSnapshot | null;
  readonly index: SeasonActiveRunIndex | null;
  readonly block: BlockRunState;
  readonly postseason: SeasonPostseasonProgress;
  readonly pending: SeasonPendingBlockCandidate | null;
  readonly interruption: SeasonInvalidRosterInterruption | null;
  readonly commandError: SeasonRunCommandError | null;
  readonly commandReceipt: SeasonTradeReceipt | null;
  readonly externalChange: SeasonExternalChange | null;
  readonly error: SeasonRunLoadDiagnostic | null;
}
export interface SeasonRunLoadDiagnostic {
  code: string;
  message: string;
  failures: readonly string[];
}
export function seasonRunLoadDiagnosticOf(
  error: unknown,
  fallbackCode = 'SEASON_RUN_LOAD_FAILED',
): SeasonRunLoadDiagnostic {
  if (error instanceof SeasonRunLoadError) {
    return {
      code: error.code,
      message: error.message,
      failures: error.failures,
    };
  }
  const candidate = error as { code?: unknown; failures?: unknown } | null;
  const failures =
    Array.isArray(candidate?.failures) &&
    candidate.failures.every((item) => typeof item === 'string')
      ? candidate.failures
      : [];
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    failures,
  };
}
function postCommandEffects(run: SeasonRun, prior: SeasonEffectsState): SeasonEffectsState {
  const withEffects = run as SeasonRun & {
    effects?: SeasonEffectsState;
  };
  return withEffects.effects ?? prior;
}
const handleRunCommand = handleSeasonRunCommand;
type RunCommandOutput = ReturnType<typeof handleRunCommand>;
type RunCommandSubmission =
  | { kind: 'accepted'; output: RunCommandOutput }
  | { kind: 'rejected'; output: RunCommandOutput; rejection: SeasonRunCommandRejection };
const STALE_SEASON_COMMAND_MESSAGE =
  'The season changed before this action was saved. Refresh and try again.';
const IDLE_BLOCK: BlockRunState = {
  requestId: null,
  blockIndex: null,
  phase: 'idle',
  gamesCompleted: 0,
  gamesTotal: 0,
  latestGameId: null,
  latestResult: null,
  isHumanGame: false,
  humanRecordInBlock: { wins: 0, losses: 0 },
  humanResults: [],
  leaguePulse: { closest: null, blowout: null, highestScoring: null },
  error: null,
  command: null,
  startInput: null,
};
const IDLE_POSTSEASON: SeasonPostseasonProgress = {
  phase: 'idle',
  gamesCompleted: 0,
  gamesTotal: 0,
  latestGameId: null,
  latestResult: null,
  error: null,
};
export class SeasonSession {
  private readonly repo: SeasonRunRepositoryPort;
  private readonly runner: SeasonBlockRunnerPort;
  private readonly assets: SeasonAssetPort;
  private readonly notifier: SeasonNotifierPort;
  private readonly clock: SeasonClockPort;
  private readonly ids: SeasonIdPort;
  private readonly draftCleaner: SeasonDraftCleanerPort;
  private readonly postseasonRunnerFactory: SeasonPostseasonRunnerFactory | null;
  private readonly cache = new SeasonSnapshotCache();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private isDisposed(): boolean {
    return this.disposed;
  }
  private unsubscribeRunner: (() => void) | null = null;
  private postseasonRunner: SeasonPostseasonRunnerPort | null = null;
  private postseasonRunnerPromise: Promise<SeasonPostseasonRunnerPort> | null = null;
  private unsubscribePostseasonRunner: (() => void) | null = null;
  private postseasonRequestId: string | null = null;
  private profilePromise: Promise<EraSimulationProfile> | null = null;
  private schedulePromise: Promise<SeasonSchedule> | null = null;
  private blockRunToken = 0;
  private blockCancelRequested = false;
  private activeBlock: BlockRequestFacts | null = null;
  private blockFacts: BlockCheckpointFacts | null = null;
  private unsubscribeChannel: (() => void) | null = null;
  private externalReloading = false;
  externalChange: SeasonExternalChange | null = null;
  snapshot: SeasonRunSnapshot | null = null;
  index: SeasonActiveRunIndex | null = null;
  block: BlockRunState = { ...IDLE_BLOCK };
  postseason: SeasonPostseasonProgress = { ...IDLE_POSTSEASON };
  error: SeasonRunLoadDiagnostic | null = null;
  pending: SeasonPendingBlockCandidate | null = null;
  interruption: SeasonInvalidRosterInterruption | null = null;
  commandError: SeasonRunCommandError | null = null;
  commandReceipt: SeasonTradeReceipt | null = null;
  catalog: SeasonDraftCatalog | null = null;
  freeAgencyIndex: SeasonFreeAgencyIndex | null = null;
  freeAgencyTargets: SeasonRosterTargets | null = null;
  constructor(options: SeasonSessionOptions) {
    this.repo = options.repository;
    this.runner = options.blockRunner;
    this.assets = options.assets;
    this.notifier = options.notifier;
    this.clock = options.clock;
    this.ids = options.ids;
    this.draftCleaner = options.draftCleaner;
    this.postseasonRunnerFactory = options.postseasonRunnerFactory ?? null;
    this.unsubscribeRunner = this.runner.subscribe((event) => {
      this.onRunnerEvent(event);
    });
    if (options.postseasonRunner !== undefined) {
      this.attachPostseasonRunner(options.postseasonRunner);
    }
    this.unsubscribeChannel = this.notifier.onMutation((mutation) => {
      void this.onExternalMutation(mutation);
    });
  }
  private lastProgressEmitAt = 0;
  getSnapshot(): SeasonSessionView {
    return {
      snapshot: this.snapshot,
      index: this.index,
      block: this.block,
      postseason: this.postseason,
      pending: this.pending,
      interruption: this.interruption,
      commandError: this.commandError,
      commandReceipt: this.commandReceipt,
      externalChange: this.externalChange,
      error: this.error,
    };
  }
  private cancelInFlightRunners(): void {
    const blockRequestId = this.block.requestId;
    if (this.block.phase === 'running' && blockRequestId !== null) {
      try {
        this.runner.cancel(blockRequestId);
      } catch {}
    }
    if (this.block.phase === 'running') {
      this.blockCancelRequested = true;
    }
    const postseasonRunner = this.postseasonRunner;
    const postseasonRequestId = this.postseasonRequestId;
    if (
      postseasonRunner !== null &&
      this.postseason.phase === 'running' &&
      postseasonRequestId !== null
    ) {
      try {
        postseasonRunner.cancel(postseasonRequestId);
      } catch {}
    }
  }
  private resetRunnerProgress(): void {
    this.activeBlock = null;
    this.blockCancelRequested = false;
    this.block = { ...IDLE_BLOCK };
    this.postseason = { ...IDLE_POSTSEASON };
    this.postseasonRequestId = null;
  }
  private teardownRunners(): void {
    this.cancelInFlightRunners();
    try {
      this.runner.terminate();
    } catch {}
    try {
      this.postseasonRunner?.terminate();
    } catch {}
    this.resetRunnerProgress();
  }
  destroy(): void {
    this.disposed = true;
    this.teardownRunners();
    this.unsubscribeRunner?.();
    this.unsubscribeRunner = null;
    this.unsubscribePostseasonRunner?.();
    this.unsubscribePostseasonRunner = null;
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.notifier.close();
    this.postseasonRunner = null;
    this.listeners.clear();
  }
  prewarm(): void {
    if (this.isDisposed()) return;
    this.runner.prewarm();
    this.postseasonRunner?.prewarm();
  }
  private attachPostseasonRunner(runner: SeasonPostseasonRunnerPort): void {
    if (this.isDisposed()) return;
    this.postseasonRunner = runner;
    this.unsubscribePostseasonRunner = runner.subscribe((event) => {
      this.onPostseasonRunnerEvent(event);
    });
  }
  private resolvePostseasonRunner(): Promise<SeasonPostseasonRunnerPort> {
    if (this.postseasonRunner !== null) return Promise.resolve(this.postseasonRunner);
    if (this.postseasonRunnerPromise === null) {
      const factory = this.postseasonRunnerFactory;
      if (factory === null) {
        return Promise.reject(new Error('no postseason runner is configured'));
      }
      this.postseasonRunnerPromise = factory();
      this.postseasonRunnerPromise
        .then((runner) => {
          if (this.postseasonRunner === null) this.attachPostseasonRunner(runner);
        })
        .catch(() => {
          this.postseasonRunnerPromise = null;
        });
    }
    return this.postseasonRunnerPromise;
  }
  private loadProfile(): Promise<EraSimulationProfile> {
    if (this.profilePromise === null) {
      this.profilePromise = this.assets.loadEraProfile();
      this.profilePromise.catch(() => {
        this.profilePromise = null;
      });
    }
    return this.profilePromise;
  }
  private async ensureFreeAgencyIndex(): Promise<SeasonFreeAgencyIndex> {
    if (this.freeAgencyIndex !== null) return this.freeAgencyIndex;
    const index = await this.assets.loadFreeAgencyIndex();
    this.freeAgencyIndex = index;
    return index;
  }
  private async ensureFreeAgencyTargets(): Promise<SeasonRosterTargets> {
    if (this.freeAgencyTargets !== null) return this.freeAgencyTargets;
    const targets = await this.assets.loadFreeAgencyTargets();
    this.freeAgencyTargets = targets;
    return targets;
  }
  private async ensureCatalog(): Promise<SeasonDraftCatalog> {
    if (this.catalog !== null) return this.catalog;
    const catalog = await this.assets.loadDraftCatalog();
    this.catalog = catalog;
    return catalog;
  }
  private loadSchedule(): Promise<SeasonSchedule> {
    if (this.schedulePromise === null) {
      this.schedulePromise = this.assets.loadSchedule();
      this.schedulePromise.catch(() => {
        this.schedulePromise = null;
      });
    }
    return this.schedulePromise;
  }
  private prefetchBlockAssets(input: SeasonBlockStartInput): void {
    void this.ensureCatalog().catch(() => null);
    if (input.blockIndex === 2 || input.blockIndex === 4 || input.blockIndex === 6) {
      void Promise.all([this.ensureFreeAgencyIndex(), this.ensureFreeAgencyTargets()]).catch(
        () => null,
      );
    }
    if (input.blockIndex === 3) {
      void Promise.all([this.loadProfile(), this.loadSchedule()]).catch(() => null);
    }
  }
  private adoptBlockFacts(snapshot: SeasonRunSnapshot): void {
    this.blockFacts = {
      runId: snapshot.run.runId,
      revision: snapshot.acceptedBlocks.length,
      completedRounds: snapshot.run.cursor.completedRounds,
      commandIds: new Set(snapshot.acceptedBlocks.map((block) => block.commandId)),
      summaries: snapshot.summaries,
      blocks: [...snapshot.acceptedBlocks],
      retainedDetails: [...snapshot.retainedDetails],
      effects: snapshot.effects,
      health: snapshot.run.health,
      stateRevision: snapshot.run.stateRevision,
      stateDigest: snapshot.run.stateDigest,
    };
  }
  private beginBlockRequest(): number {
    this.blockRunToken += 1;
    this.blockCancelRequested = false;
    this.activeBlock = null;
    return this.blockRunToken;
  }
  private settleCancelledBlock(requestId: string | null): void {
    if (this.isDisposed()) return;
    if (this.block.phase !== 'running') return;
    if (requestId !== null && this.block.requestId !== requestId) return;
    this.activeBlock = null;
    this.block.phase = 'cancelled';
    this.pending = null;
    this.interruption = null;
    this.emit();
  }
  private blockPipelineAbandoned(token: number, requestId: string | null): boolean {
    if (this.isDisposed()) return true;
    const live =
      this.blockRunToken === token &&
      this.block.phase === 'running' &&
      (requestId === null || this.block.requestId === requestId);
    if (live && !this.blockCancelRequested) return false;
    if (this.blockCancelRequested) this.settleCancelledBlock(requestId);
    return true;
  }
  private async reconcileBlockStart(input: SeasonBlockStartInput): Promise<void> {
    let facts = this.blockFacts;
    if (
      facts === null ||
      facts.runId !== input.run.runId ||
      input.expectedRevision !== facts.revision
    ) {
      const loaded = await this.repo.loadActiveRun();
      if (loaded === null) throw new Error('no active season run to advance');
      if (loaded.run.runId !== input.run.runId) {
        throw new Error('the active run does not match the submitted run');
      }
      const persistedRevision = loaded.acceptedBlocks.length;
      if (
        facts !== null &&
        facts.runId === input.run.runId &&
        input.expectedRevision !== persistedRevision
      ) {
        throw new Error(
          `stale cursor: the run is at revision ${String(persistedRevision)}, command expects ${String(input.expectedRevision)}`,
        );
      }
      this.adoptBlockFacts(loaded);
      facts = this.blockFacts;
    }
    if (facts === null) {
      throw new Error('no active season run to advance');
    }
    if (input.expectedRevision !== facts.revision) {
      throw new Error(
        `stale cursor: the run is at revision ${String(facts.revision)}, command expects ${String(input.expectedRevision)}`,
      );
    }
    if (facts.commandIds.has(input.commandId)) {
      throw new Error(`duplicate command ${input.commandId}`);
    }
    const next = seasonNextBlockIndex(facts.completedRounds);
    if (next === null || next !== input.blockIndex) {
      throw new Error(
        `non-boundary block: the run expects ${String(next)}, command submits ${String(input.blockIndex)}`,
      );
    }
    if (seasonRotationSetDigest(input.rotations) !== input.rotationDigest) {
      throw new Error('rotation digest does not match the submitted rotations');
    }
  }
  private async startBlockRequest(input: SeasonBlockStartInput, token: number): Promise<void> {
    try {
      await this.reconcileBlockStart(input);
      if (this.blockPipelineAbandoned(token, null)) return;
      const facts = this.blockFacts;
      this.activeBlock = {
        blockIndex: input.blockIndex,
        expectedRevision: input.expectedRevision,
        rotationDigest: input.rotationDigest,
        commandId: input.commandId,
        rotations: input.rotations,
        run: input.run,
        humanFranchiseId: input.humanFranchiseId,
        resumePending: null,
        catalogUrl: input.catalogUrl,
      };
      const knownSummaries =
        facts !== null && facts.runId === input.run.runId ? facts.summaries : [];
      const requestId = this.runner.startBlock({ ...input, knownSummaries });
      this.block.requestId = requestId;
    } catch (error) {
      if (this.blockPipelineAbandoned(token, null)) return;
      this.activeBlock = null;
      this.block.phase = 'failed';
      this.block.error = {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        seed: input.run.rootSeed,
        gameId: null,
      };
      this.emit();
    }
  }
  private async resumeBlockRequest(base: BlockResumeBase, token: number): Promise<void> {
    try {
      const loaded = await this.repo.loadActiveRun();
      if (this.blockPipelineAbandoned(token, null)) return;
      if (loaded === null) throw new Error('no active season run to resume');
      if (loaded.run.runId !== base.runId) {
        throw new Error('the active run does not match the resume request');
      }
      const storedPending = await this.repo.loadPendingBlock(base.runId);
      if (this.blockPipelineAbandoned(token, null)) return;
      if (storedPending === null) {
        throw new Error(`no pending block for run ${base.runId}`);
      }
      if (storedPending.blockIndex !== base.blockIndex) {
        throw new Error(
          `pending blockIndex ${String(storedPending.blockIndex)} does not match resume ${String(base.blockIndex)}`,
        );
      }
      if (storedPending.expectedRevision !== base.expectedRevision) {
        throw new Error('pending expectedRevision does not match the resume request');
      }
      if (storedPending.rotationDigest !== base.rotationDigest) {
        throw new Error('pending rotationDigest does not match the resume request');
      }
      if (this.blockFacts === null || this.blockFacts.runId !== loaded.run.runId) {
        this.adoptBlockFacts(loaded);
      }
      const facts = this.blockFacts;
      this.activeBlock = {
        blockIndex: base.blockIndex,
        expectedRevision: base.expectedRevision,
        rotationDigest: base.rotationDigest,
        commandId: base.commandId,
        rotations: base.rotations,
        run: loaded.run,
        humanFranchiseId: base.humanFranchiseId,
        resumePending: storedPending,
        catalogUrl: base.catalogUrl,
      };
      const requestId = this.runner.resumeBlock({
        ...base,
        run: loaded.run,
        effects: loaded.effects,
        pending: storedPending,
        knownSummaries: facts !== null ? facts.summaries : [],
      });
      this.block.requestId = requestId;
    } catch (error) {
      if (this.blockPipelineAbandoned(token, null)) return;
      this.activeBlock = null;
      this.block.phase = 'failed';
      this.block.error = {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        seed: null,
        gameId: null,
      };
      this.emit();
    }
  }
  private async acceptBlockCandidate(
    requestId: string,
    checkpoint: SeasonCandidateCheckpoint,
  ): Promise<void> {
    const state = this.activeBlock;
    if (state === null) return;
    const token = this.blockRunToken;
    if (this.blockCancelRequested) {
      this.settleCancelledBlock(requestId);
      return;
    }
    const failures = acceptWorkerResult(checkpoint, {
      runId: state.run.runId,
      blockIndex: state.blockIndex,
      revision: state.expectedRevision,
      rotationDigest: state.rotationDigest,
      expectedStateRevision: state.run.stateRevision,
      expectedStateDigest: state.run.stateDigest,
    });
    if (failures.length > 0) {
      if (this.blockPipelineAbandoned(token, requestId)) return;
      this.activeBlock = null;
      this.block.phase = 'failed';
      this.block.error = {
        code: 'invariant-failure',
        message: failures.join('; '),
        seed: state.run.rootSeed,
        gameId: null,
      };
      this.emit();
      return;
    }
    try {
      const authoritative = { ...checkpoint, freeAgency: state.run.freeAgency };
      const scheduleForSnapshot = await this.loadSchedule();
      if (this.blockPipelineAbandoned(token, requestId)) return;
      const needsCatalog =
        state.blockIndex === 2 ||
        state.blockIndex === 4 ||
        state.blockIndex === 5 ||
        state.blockIndex === 6;
      let catalog: SeasonDraftCatalog | undefined;
      try {
        catalog = await this.ensureCatalog();
      } catch (error) {
        if (needsCatalog) {
          throw new Error(
            `season block ${String(state.blockIndex)} requires the packaged draft catalog: season block catalog load failed for ${state.catalogUrl}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        catalog = undefined;
      }
      if (this.blockPipelineAbandoned(token, requestId)) return;
      const freeAgencyAssets =
        state.blockIndex === 2 || state.blockIndex === 4 || state.blockIndex === 6
          ? await Promise.all([this.ensureFreeAgencyIndex(), this.ensureFreeAgencyTargets()])
          : null;
      if (this.blockPipelineAbandoned(token, requestId)) return;
      const evolutionAssets =
        state.blockIndex === 3
          ? await Promise.all([this.loadProfile(), this.loadSchedule()])
              .then(([profile, schedule]) => ({ profile, schedule }))
              .catch(() => null)
          : null;
      if (this.blockPipelineAbandoned(token, requestId)) return;
      const candidateGameIds = new Set(
        authoritative.gameSummaries.map((summary) => summary.gameId),
      );
      const knownSummaries =
        this.blockFacts !== null && this.blockFacts.runId === state.run.runId
          ? this.blockFacts.summaries
          : [];
      const evolutionPriorSummaries = knownSummaries.filter(
        (summary) => !candidateGameIds.has(summary.gameId),
      );
      const committed = completeSeasonBlockCommit({
        run: { ...state.run, rotations: state.rotations },
        candidate: authoritative,
        commandId: state.commandId,
        rotationDigest: state.rotationDigest,
        humanFranchiseId: state.humanFranchiseId,
        catalog,
        effects: checkpoint.effects,
        freeAgencyIndex: freeAgencyAssets?.[0],
        freeAgencyTargets: freeAgencyAssets?.[1],
        profile: evolutionAssets?.profile,
        schedule: evolutionAssets?.schedule,
        priorSummaries: evolutionPriorSummaries,
      });
      const window: SeasonWindowOpenResult | null = committed.window;
      const retainedDetails = [
        ...(state.resumePending?.retainedDetails ?? []),
        ...dedupeNewByGameId(
          state.resumePending?.retainedDetails ?? [],
          checkpoint.retainedDetails,
        ),
      ];
      const objectives = objectivesWithSuccess(state.run, authoritative);
      const challenges = committed.challenges ?? challengesWithSuccess(state.run, authoritative);
      const campaign = committed.campaign ?? null;
      if (this.blockPipelineAbandoned(token, requestId)) return;
      await this.repo.commitSeasonBlock({
        runId: authoritative.runId,
        revision: authoritative.revision + 1,
        commandId: state.commandId,
        rotationDigest: authoritative.rotationDigest,
        checkpointDigest: authoritative.digest,
        completedRounds: authoritative.completedRounds,
        standings: authoritative.standings,
        teamAggregates: authoritative.teamAggregates,
        playerAggregates: authoritative.playerAggregates,
        summaries: authoritative.gameSummaries,
        retainedDetails,
        recap: authoritative.recap,
        rotations: window !== null ? window.rotations : state.rotations,
        effects: window !== null ? window.effects : authoritative.effects,
        freeAgency: committed.freeAgency,
        health: authoritative.health,
        transactions: window !== null ? window.transactions : authoritative.transactions,
        influence: window !== null ? window.influence : authoritative.influence,
        trade: window !== null ? window.trade : state.run.trade,
        objectives,
        challenges,
        campaign,
        evolution: committed.evolution,
        sponsors: committed.sponsors,
        checkpointState: committed.checkpointState,
        stateRevision: committed.stateRevision,
        stateDigest: committed.stateDigest,
        expectedStateRevision: state.run.stateRevision,
        expectedStateDigest: state.run.stateDigest,
        window,
      });
      if (this.blockPipelineAbandoned(token, requestId)) return;
      this.publishCommittedBlock(state, authoritative, committed, window, scheduleForSnapshot);
    } catch (error) {
      if (this.blockPipelineAbandoned(token, requestId)) return;
      this.activeBlock = null;
      this.block.phase = 'failed';
      this.block.error = {
        code: 'internal',
        message: `checkpoint commit failed: ${error instanceof Error ? error.message : String(error)}`,
        seed: state.run.rootSeed,
        gameId: null,
      };
      this.emit();
    }
  }
  private publishCommittedBlock(
    state: BlockRequestFacts,
    checkpoint: SeasonCandidateCheckpoint,
    committed: ReturnType<typeof completeSeasonBlockCommit>,
    window: SeasonWindowOpenResult | null,
    schedule: SeasonSchedule,
  ): void {
    this.activeBlock = null;
    if (this.activeRunId() !== checkpoint.runId) return;
    const priorSummaries =
      this.blockFacts !== null && this.blockFacts.runId === checkpoint.runId
        ? this.blockFacts.summaries
        : [];
    const priorAcceptedBlocks =
      this.blockFacts !== null && this.blockFacts.runId === checkpoint.runId
        ? this.blockFacts.blocks
        : [];
    const priorRetainedDetails =
      this.blockFacts !== null && this.blockFacts.runId === checkpoint.runId
        ? this.blockFacts.retainedDetails
        : [];
    if (this.blockFacts === null || this.blockFacts.runId !== checkpoint.runId) {
      this.blockFacts = {
        runId: checkpoint.runId,
        revision: checkpoint.revision,
        completedRounds: checkpoint.completedRounds,
        commandIds: new Set(),
        summaries: [],
        blocks: [],
        retainedDetails: [],
        effects: checkpoint.effects,
        health: checkpoint.health,
        stateRevision: state.run.stateRevision,
        stateDigest: state.run.stateDigest,
      };
    }
    this.blockFacts.revision = checkpoint.revision + 1;
    this.blockFacts.completedRounds = checkpoint.completedRounds;
    this.blockFacts.commandIds.add(state.commandId);
    this.blockFacts.summaries = [...this.blockFacts.summaries, ...checkpoint.gameSummaries];
    this.blockFacts.effects = window !== null ? window.effects : checkpoint.effects;
    this.blockFacts.health = window !== null ? window.health : checkpoint.health;
    this.blockFacts.stateRevision = committed.stateRevision;
    this.blockFacts.stateDigest = committed.stateDigest;
    const snapshot = assembleCommittedSnapshot({
      run: state.run,
      rotations: state.rotations,
      checkpoint,
      commandId: state.commandId,
      rotationDigest: state.rotationDigest,
      window,
      freeAgency: committed.freeAgency,
      campaign: committed.campaign,
      challenges: committed.challenges,
      evolution: committed.evolution,
      sponsors: committed.sponsors,
      checkpointState: committed.checkpointState,
      stateRevision: committed.stateRevision,
      stateDigest: committed.stateDigest,
      schedule,
      priorSummaries,
      priorAcceptedBlocks,
      priorRetainedDetails,
    });
    this.blockFacts.blocks = snapshot.acceptedBlocks;
    this.blockFacts.retainedDetails = snapshot.retainedDetails;
    this.block.latestGameId = null;
    this.block.latestResult = null;
    this.block.error = null;
    this.pending = null;
    this.interruption = null;
    this.snapshot = snapshot;
    this.index = indexAfterCommit(this.index, snapshot, () => this.clock.now());
    this.cache.set(snapshot);
    this.block = { ...IDLE_BLOCK };
    this.notifier.announce({
      kind: 'commit',
      runId: snapshot.run.runId,
      revision: snapshot.acceptedBlocks.length,
      committedAt: this.clock.now(),
    });
    this.emit();
  }
  private async acceptBlockInterruption(
    requestId: string,
    pending: SeasonPendingBlockCandidate,
  ): Promise<void> {
    const state = this.activeBlock;
    if (state === null) return;
    const token = this.blockRunToken;
    if (this.blockCancelRequested) {
      this.settleCancelledBlock(requestId);
      return;
    }
    try {
      if (pending.runId !== state.run.runId) {
        throw new Error('pending candidate runId mismatch');
      }
      if (pending.blockIndex !== state.blockIndex) {
        throw new Error('pending candidate blockIndex mismatch');
      }
      if (pending.commandId !== state.commandId) {
        throw new Error('pending candidate commandId mismatch');
      }
      if (pending.expectedRevision !== state.expectedRevision) {
        throw new Error('pending candidate expectedRevision mismatch');
      }
      if (pending.rotationDigest !== state.rotationDigest) {
        throw new Error('pending candidate rotationDigest mismatch');
      }
      if (state.humanFranchiseId === null) {
        throw new Error('invalid-roster interruption without a human franchise');
      }
      const availability = seasonFranchiseLegalFiveFacts(
        state.run,
        state.humanFranchiseId,
        pending.health,
      );
      const interruption: SeasonInvalidRosterInterruption = {
        code: 'invalid-roster',
        runId: pending.runId,
        blockIndex: pending.blockIndex,
        commandId: pending.commandId,
        nextGameId: pending.nextGameId,
        humanFranchiseId: franchiseIdSchema.parse(state.humanFranchiseId),
        unavailablePlayerVersionIds: availability.unavailablePlayerVersionIds,
      };
      const priorRetained = state.resumePending?.retainedDetails ?? [];
      const priorPendingSummaries = state.resumePending?.summaries ?? [];
      const mergedPending: typeof pending = {
        ...pending,
        summaries: mergeSortedByGameId(priorPendingSummaries, pending.summaries),
        retainedDetails: mergeSortedByGameId(
          priorRetained,
          dedupeNewByGameId(priorRetained, pending.retainedDetails),
        ),
      };
      await this.repo.savePendingBlock(mergedPending, interruption);
      if (this.blockPipelineAbandoned(token, requestId)) return;
      if (this.block.blockIndex !== mergedPending.blockIndex) return;
      if (this.activeRunId() !== mergedPending.runId) return;
      this.activeBlock = null;
      this.block.phase = 'interrupted';
      this.block.latestGameId = null;
      this.block.latestResult = null;
      this.block.isHumanGame = false;
      this.block.error = null;
      this.pending = mergedPending;
      this.interruption = interruption;
      this.commandError = null;
      this.emit();
    } catch (error) {
      if (this.blockPipelineAbandoned(token, requestId)) return;
      this.activeBlock = null;
      this.block.phase = 'failed';
      this.block.error = {
        code: 'internal',
        message: `interruption persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        seed: state.run.rootSeed,
        gameId: null,
      };
      this.emit();
    }
  }
  private async onExternalMutation(mutation: SeasonRunMutation): Promise<void> {
    if (this.isDisposed()) return;
    if (this.externalReloading) return;
    this.externalReloading = true;
    try {
      const localRunId = this.snapshot?.run.runId ?? this.index?.runId ?? null;
      const localAccepted = this.snapshot?.acceptedBlocks.length ?? this.index?.revision ?? -1;
      const localStateRevision = this.snapshot?.run.stateRevision ?? -1;
      if (
        mutation.kind === 'commit' &&
        mutation.runId === localRunId &&
        (mutation.revision === localAccepted || mutation.revision === localStateRevision)
      ) {
        return;
      }
      this.teardownRunners();
      this.cache.clear();
      this.externalChange = {
        kind: mutation.kind,
        message:
          mutation.kind === 'clear'
            ? 'The season was cleared in another tab.'
            : mutation.kind === 'replace'
              ? 'A new season replaced the active run in another tab.'
              : `The season advanced to block ${String(mutation.revision + 1)} in another tab.`,
      };
      await this.refresh();
      if (this.block.phase !== 'running') {
        this.emit();
      }
    } finally {
      this.externalReloading = false;
    }
  }
  acknowledgeExternalChange(): void {
    this.externalChange = null;
    this.emit();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async refresh(): Promise<void> {
    if (this.isDisposed()) return;
    try {
      const index = await this.repo.loadActiveRunIndex();
      if (this.isDisposed()) return;
      const local = this.snapshot;
      if (
        index !== null &&
        local !== null &&
        local.run.runId === index.runId &&
        local.acceptedBlocks.length === index.revision &&
        this.cache.matches(index.runId, index.revision, local.run.stateRevision)
      ) {
        this.snapshot = this.cache.get() ?? local;
        this.index = index;
        this.error = null;
        this.emit();
        return;
      }
      const snapshot: SeasonRunSnapshot | null = await this.repo.loadActiveRun();
      if (this.isDisposed()) return;
      this.snapshot = snapshot;
      this.index = index;
      if (snapshot !== null) {
        try {
          this.pending = await this.repo.loadPendingBlock(snapshot.run.runId);
          if (this.isDisposed()) return;
          if (this.pending === null) {
            this.interruption = null;
          } else {
            this.interruption = await this.repo.loadPendingInterruption(snapshot.run.runId);
            if (this.isDisposed()) return;
          }
        } catch {
          this.pending = null;
          this.interruption = null;
        }
      } else {
        this.pending = null;
        this.interruption = null;
      }
      if (
        snapshot !== null &&
        index !== null &&
        index.runId === snapshot.run.runId &&
        index.revision === snapshot.acceptedBlocks.length
      ) {
        this.cache.set(snapshot);
      }
      this.error =
        snapshot === null && index !== null
          ? {
              code: 'SEASON_RUN_CHECKPOINT_MISSING',
              message:
                'The active-run index exists, but the saved Season Run checkpoint is missing.',
              failures: [
                `run ${index.runId} is indexed at revision ${String(index.revision)} but has no checkpoint record`,
              ],
            }
          : null;
    } catch (error) {
      if (this.isDisposed()) return;
      this.snapshot = null;
      this.index = null;
      this.pending = null;
      this.interruption = null;
      this.cache.clear();
      this.error = seasonRunLoadDiagnosticOf(error);
    }
    this.emit();
  }
  async clearSeasonData(): Promise<{
    ok: boolean;
    error: string | null;
  }> {
    try {
      this.teardownRunners();
      await this.repo.forceClearActiveSeasonRun();
      await this.draftCleaner.clearDraftSave();
      this.cache.clear();
      this.snapshot = null;
      this.index = null;
      this.pending = null;
      this.interruption = null;
      this.block = { ...IDLE_BLOCK };
      this.error = null;
      this.notifier.announce({ kind: 'clear', runId: null, committedAt: this.clock.now() });
      await this.refresh();
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `could not clear season data: ${message}` };
    }
  }
  nextBlockIndex(): number | null {
    return this.snapshot?.acceptedBlocks.length ?? null;
  }
  loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]> {
    return this.repo.loadBlockSummaries(runId, blockIndex);
  }
  loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]> {
    return this.repo.loadRetainedDetails(runId);
  }
  loadPlayerSlice(runId: string): Promise<SeasonRunPlayerSliceEntry[] | null> {
    return this.repo.loadSeasonRunPlayerSlice(runId);
  }
  upsertPlayerSlice(runId: string, entries: SeasonRunPlayerSliceEntry[]): Promise<void> {
    return this.repo.upsertSeasonRunPlayerSlice(runId, entries);
  }
  startBlock(envelope: SubmitBlockEnvelope): void {
    const parsed = seasonSubmitBlockCommandSchema.safeParse(envelope.command);
    if (!parsed.success) {
      this.block = {
        ...IDLE_BLOCK,
        phase: 'failed',
        error: {
          code: 'invalid-command',
          message: 'the submit command fails the frozen schema',
          seed: null,
          gameId: null,
        },
      };
      this.emit();
      return;
    }
    if (this.block.phase === 'running') {
      this.block = {
        ...IDLE_BLOCK,
        requestId: null,
        blockIndex: envelope.command.blockIndex,
        phase: 'failed',
        gamesTotal: 0,
        command: envelope.command,
        startInput: envelope.start,
        error: {
          code: 'internal',
          message: 'a season block is already running; cancel it first',
          seed: null,
          gameId: null,
        },
      };
      this.emit();
      return;
    }
    this.block = {
      ...IDLE_BLOCK,
      requestId: null,
      blockIndex: envelope.command.blockIndex,
      phase: 'running',
      gamesTotal: 0,
      command: envelope.command,
      startInput: envelope.start,
    };
    const token = this.beginBlockRequest();
    this.prefetchBlockAssets(envelope.start);
    this.emit();
    void this.startBlockRequest(envelope.start, token);
  }
  async resumeBlock(): Promise<void> {
    const pending = this.pending;
    if (pending === null) return;
    if (this.block.phase === 'running') return;
    const submitted = this.block.startInput;
    let base: BlockResumeBase;
    if (submitted !== null) {
      base = {
        runId: submitted.run.runId,
        blockIndex: submitted.blockIndex,
        expectedRevision: submitted.expectedRevision,
        rotationDigest: submitted.rotationDigest,
        commandId: submitted.commandId,
        rotations: submitted.rotations,
        humanFranchiseId: submitted.humanFranchiseId,
        homeCourt: submitted.homeCourt,
        catalogUrl: submitted.catalogUrl,
        catalogHash: submitted.catalogHash,
        profileUrl: submitted.profileUrl,
        profileHash: submitted.profileHash,
      };
    } else {
      const run = this.snapshot?.run;
      if (run === undefined) return;
      const [homeCourt, urls] = await Promise.all([
        this.assets.loadHomeCourtProfile(),
        this.assets.loadArtifactUrls(),
      ]);
      const rawHumanResume = humanFranchiseIdOf(run.league);
      base = {
        runId: run.runId,
        blockIndex: pending.blockIndex,
        expectedRevision: pending.expectedRevision,
        rotationDigest: pending.rotationDigest,
        commandId: pending.commandId,
        rotations: run.rotations,
        humanFranchiseId: rawHumanResume === null ? null : franchiseIdSchema.parse(rawHumanResume),
        homeCourt,
        catalogUrl: urls.catalogUrl,
        catalogHash: urls.catalogHash,
        profileUrl: urls.profileUrl,
        profileHash: urls.profileHash,
      };
    }
    this.block = {
      ...IDLE_BLOCK,
      blockIndex: pending.blockIndex,
      phase: 'running',
      command: null,
      startInput: null,
    };
    const token = this.beginBlockRequest();
    this.emit();
    void this.resumeBlockRequest(base, token);
  }
  async selectFrontOffice(input: { executiveId: string }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('fo'),
      command: 'select-front-office',
      executiveId: input.executiveId as never,
    };
    await this.dispatch(command);
  }
  async selectCourtInnovation(input: { innovationId: string }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('ci'),
      command: 'select-court-innovation',
      innovationId: input.innovationId as never,
    };
    await this.dispatch(command);
  }
  async openTradeInquiry(input: { windowIndex: number; toFranchiseId: string }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('inq'),
      command: 'open-trade-inquiry',
      windowIndex: input.windowIndex,
      toFranchiseId: franchiseIdSchema.parse(input.toFranchiseId),
    };
    await this.dispatch(command);
  }
  async submitTradeProposal(input: {
    windowIndex: number;
    toFranchiseId: string;
    outgoingPlayerVersionIds: string[];
    incomingPlayerVersionIds: string[];
    influenceAmount: number;
    influenceFromSender: string | null;
  }): Promise<void> {
    try {
      await this.ensureCatalog();
    } catch (error) {
      this.failCommand(
        'submit-trade-proposal',
        `The draft catalog is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const command: SeasonRunCommand = {
      ...this.commandBase('prop'),
      command: 'submit-trade-proposal',
      windowIndex: input.windowIndex,
      toFranchiseId: franchiseIdSchema.parse(input.toFranchiseId),
      outgoingPlayerVersionIds: input.outgoingPlayerVersionIds,
      incomingPlayerVersionIds: input.incomingPlayerVersionIds,
      influenceAmount: input.influenceAmount,
      influenceFromSender: input.influenceFromSender as never,
    };
    await this.dispatch(command);
  }
  async respondToTradeCounter(input: {
    windowIndex: number;
    inquiryId: string;
    accept: boolean;
  }): Promise<void> {
    if (input.accept) {
      try {
        await this.ensureCatalog();
      } catch (error) {
        this.failCommand(
          'respond-to-trade-counter',
          `The draft catalog is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    }
    const command: SeasonRunCommand = {
      ...this.commandBase('resp'),
      command: 'respond-to-trade-counter',
      windowIndex: input.windowIndex,
      inquiryId: input.inquiryId,
      accept: input.accept,
    };
    await this.dispatch(command);
  }
  async walkAwayFromTrade(input: { windowIndex: number; inquiryId: string }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('walk'),
      command: 'walk-away-from-trade',
      windowIndex: input.windowIndex,
      inquiryId: input.inquiryId,
    };
    await this.dispatch(command);
  }
  async purchaseTradeInquiry(input: { windowIndex: number }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('purch'),
      command: 'purchase-trade-inquiry',
      windowIndex: input.windowIndex,
    };
    await this.dispatch(command);
  }
  async buySponsor(input: { instanceId: string }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('spon'),
      command: 'buy-sponsor',
      instanceId: input.instanceId,
    };
    await this.dispatch(command);
  }
  async applySponsor(input: {
    instanceId: string;
    playerVersionId: string;
    slot: 'shoe' | 'apparel' | 'fuel';
  }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('spon'),
      command: 'apply-sponsor',
      instanceId: input.instanceId,
      playerVersionId: input.playerVersionId,
      slot: input.slot,
    };
    await this.dispatch(command);
  }
  async spendInfluence(input: {
    purpose: SeasonSpendInfluencePurpose;
    windowIndex?: number;
    injuryId?: string;
  }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('inf'),
      command: 'spend-influence',
      franchiseId: this.requiredHumanFranchiseId(),
      purpose: input.purpose,
      ...(input.purpose === 'extra-trade-offer' ? { windowIndex: input.windowIndex } : {}),
      ...(input.purpose === 'risky-rehab' ? { injuryId: input.injuryId } : {}),
    };
    await this.dispatch(command);
  }
  async acceptTradeOffer(input: { windowIndex: number; offerId: string }): Promise<void> {
    try {
      await this.ensureCatalog();
    } catch (error) {
      this.failCommand(
        'accept-trade-offer',
        `The draft catalog is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const command: SeasonRunCommand = {
      ...this.commandBase('acc'),
      command: 'accept-trade-offer',
      windowIndex: input.windowIndex,
      offerId: input.offerId,
    };
    await this.dispatch(command);
  }
  async declineTradeOffer(input: { windowIndex: number; offerId: string }): Promise<void> {
    try {
      await this.ensureCatalog();
    } catch (error) {
      this.failCommand(
        'decline-trade-offer',
        `The draft catalog is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const command: SeasonRunCommand = {
      ...this.commandBase('dec'),
      command: 'decline-trade-offer',
      windowIndex: input.windowIndex,
      offerId: input.offerId,
    };
    await this.dispatch(command);
  }
  async forfeitInterruptedGame(): Promise<void> {
    const pending = this.pending;
    if (pending === null) return;
    const command: SeasonRunCommand = {
      ...this.commandBase('for'),
      command: 'forfeit-interrupted-game',
      blockIndex: pending.blockIndex,
      nextGameId: pending.nextGameId,
    };
    await this.dispatch(command);
  }
  async declareFreeAgentInterest(input: {
    windowIndex: number;
    targets: {
      playerVersionId: string;
      roleExpectation: SeasonFreeAgencyRoleExpectation;
      influence: number;
    }[];
  }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('fad'),
      command: 'declare-free-agent-interest',
      franchiseId: this.requiredHumanFranchiseId(),
      windowIndex: input.windowIndex,
      targets: input.targets,
    };
    await this.dispatch(command);
  }
  async skipFreeAgentMarket(input: { windowIndex: number }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('fas'),
      command: 'skip-free-agent-market',
      franchiseId: this.requiredHumanFranchiseId(),
      windowIndex: input.windowIndex,
    };
    await this.dispatch(command);
  }
  async resolveFreeAgentMarket(input: { windowIndex: number }): Promise<void> {
    const snapshot = this.snapshot;
    this.commandError = null;
    if (snapshot === null) {
      this.failCommand('resolve-free-agent-market', 'The active run is not loaded yet.');
      return;
    }
    try {
      await Promise.all([
        this.ensureFreeAgencyIndex(),
        this.ensureFreeAgencyTargets(),
        this.catalog === null ? this.assets.loadDraftCatalog() : Promise.resolve(null),
      ]).then(([index, targets, catalog]) => {
        this.freeAgencyIndex = index;
        this.freeAgencyTargets = targets;
        if (catalog !== null) this.catalog = catalog;
      });
    } catch (error) {
      this.failCommand(
        'resolve-free-agent-market',
        `The free-agency market assets are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const command: SeasonRunCommand = {
      ...this.commandBase('far'),
      command: 'resolve-free-agent-market',
      windowIndex: input.windowIndex,
    };
    await this.dispatch(command);
  }
  cancel(): void {
    if (this.block.phase !== 'running') return;
    this.blockCancelRequested = true;
    const requestId = this.block.requestId;
    if (requestId === null) return;
    this.runner.cancel(requestId);
  }
  async startPostseason(): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('pst'),
      command: 'start-postseason',
    };
    await this.dispatchPostseason(command);
  }
  async advancePostseason(input?: { targetGameId?: string }): Promise<void> {
    const command: SeasonRunCommand['command'] = 'advance-postseason';
    if (!this.requirePostseasonStage(command)) return;
    const runner = await this.resolvePostseasonRunner();
    if (this.isDisposed()) return;
    const rawHuman = this.humanFranchiseId();
    this.postseasonRequestId = runner.advancePostseason({
      runId: this.requiredRunId(),
      commandId: this.newCommandId('adv'),
      ...(input?.targetGameId !== undefined
        ? { targetGameId: postseasonGameIdSchema.parse(input.targetGameId) }
        : {}),
      humanFranchiseId: rawHuman === null ? null : franchiseIdSchema.parse(rawHuman),
    });
  }
  async forfeitPostseasonGame(input: { targetGameId: string }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('for'),
      command: 'advance-postseason',
      targetGameId: postseasonGameIdSchema.parse(input.targetGameId),
      forfeit: true,
    };
    if (!this.requirePostseasonStage(command.command)) return;
    await this.dispatchPostseason(command);
  }
  async submitPostseasonRotation(input: {
    targetGameId: string;
    rotation: SeasonPostseasonRotationPayload;
  }): Promise<void> {
    const command: SeasonRunCommand = {
      ...this.commandBase('sub'),
      command: 'submit-postseason-rotation',
      targetGameId: postseasonGameIdSchema.parse(input.targetGameId),
      rotation: input.rotation,
    };
    await this.dispatchPostseason(command);
  }
  async spectatePostseasonGame(input: { targetGameId: string }): Promise<void> {
    const command: SeasonRunCommand['command'] = 'spectate-postseason-game';
    if (!this.requirePostseasonStage(command)) return;
    const runner = await this.resolvePostseasonRunner();
    if (this.isDisposed()) return;
    const rawHumanSpectate = this.humanFranchiseId();
    this.postseasonRequestId = runner.spectatePostseasonGame({
      runId: this.requiredRunId(),
      commandId: this.newCommandId('spc'),
      targetGameId: postseasonGameIdSchema.parse(input.targetGameId),
      humanFranchiseId:
        rawHumanSpectate === null ? null : franchiseIdSchema.parse(rawHumanSpectate),
    });
  }
  async fastForwardPostseason(input?: { targetGameId?: string }): Promise<void> {
    const command: SeasonRunCommand['command'] = 'fast-forward-postseason';
    if (!this.requirePostseasonStage(command)) return;
    const runner = await this.resolvePostseasonRunner();
    if (this.isDisposed()) return;
    const rawHumanFf = this.humanFranchiseId();
    this.postseasonRequestId = runner.fastForwardPostseason({
      runId: this.requiredRunId(),
      commandId: this.newCommandId('ff'),
      ...(input?.targetGameId !== undefined
        ? { targetGameId: postseasonGameIdSchema.parse(input.targetGameId) }
        : {}),
      humanFranchiseId: rawHumanFf === null ? null : franchiseIdSchema.parse(rawHumanFf),
    });
  }
  cancelPostseason(): void {
    const requestId = this.postseasonRequestId;
    const runner = this.postseasonRunner;
    if (this.postseason.phase !== 'running' || requestId === null || runner === null) return;
    runner.cancel(requestId);
  }
  loadPostseasonSummaries(runId: string): Promise<SeasonPostseasonSummary[]> {
    return this.repo.loadPostseasonSummaries(runId);
  }
  loadPostseasonSummary(runId: string, gameId: string): Promise<SeasonPostseasonSummary | null> {
    return this.repo.loadPostseasonSummary(runId, gameId);
  }
  private newCommandId(prefix: string): CommandId {
    return commandIdSchema.parse(this.ids.id(prefix));
  }
  private failCommand(command: SeasonRunCommand['command'], message: string): void {
    this.commandError = { command, rejection: null, message };
    this.emit();
  }
  private rejectCommand(
    command: SeasonRunCommand['command'],
    rejection: SeasonRunCommandRejection,
  ): void {
    this.commandError = {
      command,
      rejection,
      message: describeCommandRejection(command, rejection),
    };
    this.emit();
  }
  private adoptCommittedRun(run: SeasonRun, effects: SeasonEffectsState): boolean {
    const snapshot = this.snapshot;
    if (snapshot === null) return false;
    this.snapshot = { ...snapshot, run, effects };
    this.cache.set(this.snapshot);
    return true;
  }
  private async executeRunCommand(
    command: SeasonRunCommand,
    hooks: {
      beforeExecute?: () => boolean;
      prepare?: () => Promise<boolean>;
      context: (snapshot: SeasonRunSnapshot) => SeasonRunCommandContext;
      apply: (output: RunCommandOutput, snapshot: SeasonRunSnapshot) => Promise<void>;
    },
  ): Promise<void> {
    const snapshot = this.snapshot;
    this.commandError = null;
    if (snapshot === null) {
      this.failCommand(command.command, 'The active run is not loaded yet.');
      return;
    }
    if (hooks.beforeExecute !== undefined && !hooks.beforeExecute()) return;
    if (hooks.prepare !== undefined && !(await hooks.prepare())) return;
    const report = await runSubmission(SEASON_COMMAND_POLICY, command, {
      submit: async (current): Promise<RunCommandSubmission> => {
        const output = handleRunCommand(current, hooks.context(snapshot));
        const envelope = output.result;
        if (envelope.result.status === 'rejected') {
          return { kind: 'rejected', output, rejection: envelope.result.rejection };
        }
        await hooks.apply(output, snapshot);
        return { kind: 'accepted', output };
      },
      classify: (submission) => (submission.kind === 'accepted' ? 'accepted' : 'rejected'),
      classifyError: (error) =>
        error instanceof SeasonRunCommandStaleStateError ? 'stale' : 'rejected',
    });
    if (report.disposition === 'accepted') return;
    if (report.disposition === 'stale') {
      this.failCommand(command.command, STALE_SEASON_COMMAND_MESSAGE);
      return;
    }
    const submission = report.receipt;
    if (submission !== null && submission.kind === 'rejected') {
      this.rejectCommand(command.command, submission.rejection);
      return;
    }
    this.failCommand(
      command.command,
      report.error instanceof Error ? report.error.message : String(report.error),
    );
  }
  private requirePostseasonStage(command: SeasonRunCommand['command']): boolean {
    const stage = this.snapshot?.run.stage ?? null;
    if (stage === 'play-in' || stage === 'playoffs') return true;
    this.rejectCommand(command, {
      code: 'invalid-stage',
      requiredStage: 'play-in',
      currentStage: stage ?? 'regular-season',
    });
    return false;
  }
  private async dispatchPostseason(command: SeasonRunCommand): Promise<void> {
    let profile: EraSimulationProfile | null = null;
    await this.executeRunCommand(command, {
      prepare: async () => {
        try {
          profile = await this.loadProfile();
          return true;
        } catch (error) {
          this.failCommand(
            command.command,
            `The season era profile is unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      },
      context: (snapshot) => ({
        run: snapshot.run,
        pending: null,
        humanFranchiseId: this.humanFranchiseId(),
        effects: snapshot.effects,
        catalog: this.catalog ?? undefined,
        profile: profile ?? undefined,
      }),
      apply: async (output, snapshot) => {
        const summaries = output.postseasonSummaries ?? [];
        const commitInput: CommitPostseasonAdvancementInput = {
          runId: snapshot.run.runId,
          run: output.run,
          summaries,
          effects: postCommandEffects(output.run, snapshot.effects),
          command,
          preStateRevision: command.expectedStateRevision,
          preStateDigest: command.expectedStateDigest,
          resultDigest: seasonPostseasonCommitResultDigest(command.commandId, [], summaries),
          relatedGameIds: summaries.map((summary) => summary.gameId),
          transactionIds: seasonPostseasonTransactionIdsOf(output.run, command.commandId),
        };
        await this.repo.commitPostseasonAdvancement(commitInput);
        this.commandError = null;
        if (this.adoptCommittedRun(output.run, postCommandEffects(output.run, snapshot.effects))) {
          this.emit();
        }
        await this.refresh();
      },
    });
  }
  private onPostseasonRunnerEvent(event: SeasonPostseasonEvent): void {
    if (this.isDisposed()) return;
    if (event.type === 'started') {
      this.postseasonRequestId = event.requestId;
    } else if (event.requestId !== this.postseasonRequestId) {
      return;
    }
    switch (event.type) {
      case 'started':
        this.postseason = {
          ...this.postseason,
          phase: 'running',
          gamesTotal: event.gamesTotal,
          error: null,
        };
        break;
      case 'progress':
        this.postseason = {
          ...this.postseason,
          gamesTotal: event.gamesTotal,
          latestGameId: event.latestGameId,
          latestResult: event.latestResult,
        };
        break;
      case 'committed': {
        if (this.activeRunId() !== event.runId) break;
        this.snapshot = event.snapshot;
        this.index = indexAfterCommit(this.index, event.snapshot, () => this.clock.now());
        this.cache.set(event.snapshot);
        this.postseason = {
          ...this.postseason,
          phase: 'running',
          gamesCompleted: this.postseason.gamesCompleted + event.gameIds.length,
        };
        this.notifier.announce({
          kind: 'replace',
          runId: event.runId,
          committedAt: this.clock.now(),
        });
        break;
      }
      case 'complete': {
        if (this.activeRunId() !== event.runId) break;
        const promoted = event.promoted;
        this.postseason = {
          ...this.postseason,
          phase: 'complete',
          latestGameId: null,
          latestResult: null,
          error: null,
        };
        if (promoted) {
          this.cache.clear();
          this.snapshot = null;
          this.index = null;
          this.pending = null;
          this.interruption = null;
          this.notifier.announce({
            kind: 'clear',
            runId: event.runId,
            committedAt: this.clock.now(),
          });
        } else if (event.snapshot !== null) {
          this.snapshot = event.snapshot;
          this.index = indexAfterCommit(this.index, event.snapshot, () => this.clock.now());
          this.cache.set(event.snapshot);
        }
        void this.refresh();
        break;
      }
      case 'rejected':
        this.commandError = {
          command: event.command,
          rejection: event.rejection,
          message: event.message,
        };
        this.postseason = {
          ...this.postseason,
          phase: 'failed',
          error: { code: event.rejection.code, message: event.message },
        };
        break;
      case 'cancelled':
        this.postseason = {
          ...this.postseason,
          phase: 'cancelled',
          error: null,
        };
        break;
      case 'error':
        this.postseason = {
          ...this.postseason,
          phase: 'failed',
          error: { code: event.code, message: event.message },
        };
        break;
    }
    this.emit();
  }
  async quitRun(): Promise<{
    ok: boolean;
    error: string | null;
  }> {
    if (this.snapshot === null) {
      return { ok: false, error: 'no active season run to quit' };
    }
    const runId = this.snapshot.run.runId;
    this.cancelInFlightRunners();
    if (this.block.phase === 'running') {
      const deadline = this.clock.now() + 5000;
      let waited = 0;
      const phaseOf = (): BlockPhase => this.block.phase;
      while (phaseOf() === 'running' && waited < 5000 && this.clock.now() < deadline) {
        await this.clock.sleep(100);
        waited += 100;
      }
      if (phaseOf() === 'running') {
        this.runner.terminate();
      }
    }
    try {
      this.postseasonRunner?.terminate();
    } catch {}
    this.resetRunnerProgress();
    this.emit();
    try {
      await this.repo.clearSeasonRun(runId);
      this.cache.clear();
      this.notifier.announce({ kind: 'clear', runId, committedAt: this.clock.now() });
      await this.refresh();
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `could not quit the run: ${message}` };
    }
  }
  async retry(): Promise<void> {
    if (this.block.command === null || this.block.startInput === null) return;
    if (this.block.phase !== 'cancelled' && this.block.phase !== 'failed') return;
    this.cache.clear();
    await this.refresh();
    const revision = this.snapshot?.acceptedBlocks.length;
    if (!canResubmitBlock(SEASON_BLOCK_POLICY, this.block.command.expectedRevision, revision)) {
      this.block = { ...IDLE_BLOCK };
      this.emit();
      return;
    }
    const start = this.block.startInput;
    let homeCourt: SeasonHomeCourtProfile;
    try {
      homeCourt = await this.assets.loadHomeCourtProfile();
    } catch {
      homeCourt = start.homeCourt;
    }
    this.startBlock({
      command: this.block.command,
      start: { ...start, homeCourt },
    });
  }
  private get tradeBlockedReason(): 'pending' | 'interrupted' | 'running' | null {
    if (this.pending !== null || this.interruption !== null) {
      return this.pending !== null ? 'pending' : 'interrupted';
    }
    return this.block.phase === 'running' ? 'running' : null;
  }
  private tradeReceiptOf(
    command: SeasonRunCommand,
    envelope: RunCommandOutput['result'],
    stateRevision: number,
  ): SeasonTradeReceipt | null {
    if (envelope.result.status !== 'accepted') return null;
    if (
      command.command === 'respond-to-trade-counter' &&
      envelope.command === 'respond-to-trade-counter'
    ) {
      const result = envelope.result;
      return {
        command: command.command,
        windowIndex: result.windowIndex,
        inquiryId: result.inquiryId,
        offerId: null,
        rosterChanges: result.rosterChanges ?? null,
        stateRevision,
      };
    }
    if (command.command === 'accept-trade-offer' && envelope.command === 'accept-trade-offer') {
      const result = envelope.result;
      return {
        command: command.command,
        windowIndex: result.trade.windowIndex,
        inquiryId: null,
        offerId: result.trade.offerId,
        rosterChanges: result.rosterChanges,
        stateRevision,
      };
    }
    if (command.command === 'decline-trade-offer' && envelope.command === 'decline-trade-offer') {
      const result = envelope.result;
      return {
        command: command.command,
        windowIndex: result.windowIndex,
        inquiryId: null,
        offerId: result.offerId,
        rosterChanges: null,
        stateRevision,
      };
    }
    return null;
  }
  private async dispatch(command: SeasonRunCommand): Promise<void> {
    this.commandReceipt = null;
    await this.executeRunCommand(command, {
      beforeExecute: () => {
        if (!TRADE_COMMANDS.has(command.command) || this.tradeBlockedReason === null) return true;
        const blockIndex = this.pending?.blockIndex ?? this.nextBlockIndex() ?? 0;
        const rejection = { code: 'pending-block', blockIndex } as const;
        this.rejectCommand(command.command, rejection);
        return false;
      },
      context: (snapshot) => ({
        run: snapshot.run,
        pending: this.pending,
        humanFranchiseId: this.humanFranchiseId(),
        effects: snapshot.effects,
        catalog: this.catalog ?? undefined,
        freeAgencyIndex: this.freeAgencyIndex ?? undefined,
        freeAgencyTargets: this.freeAgencyTargets ?? undefined,
      }),
      apply: async (output, snapshot) => {
        const beforeRosterKey = rosterKeyOfSnapshotRun(snapshot.run.rosters);
        const pendingInterruption =
          command.command === 'forfeit-interrupted-game' && output.pending !== null
            ? this.interruptionStateForPending(output.pending)
            : undefined;
        if (command.command === 'forfeit-interrupted-game') {
          this.interruption = pendingInterruption ?? null;
        } else if (output.pending === null) {
          this.interruption = null;
        }
        await this.repo.applySeasonRunCommand({
          runId: snapshot.run.runId,
          command,
          run: output.run,
          effects: postCommandEffects(output.run, snapshot.effects),
          pending: output.pending,
          ...(pendingInterruption !== undefined && pendingInterruption !== null
            ? { pendingInterruption }
            : {}),
        });
        this.commandError = null;
        this.commandReceipt = this.tradeReceiptOf(command, output.result, output.run.stateRevision);
        this.pending = output.pending;
        const current = this.snapshot;
        if (
          current !== null &&
          this.adoptCommittedRun(output.run, postCommandEffects(output.run, current.effects))
        ) {
          this.notifier.announce({
            kind: 'commit',
            runId: output.run.runId,
            revision: output.run.stateRevision,
            committedAt: this.clock.now(),
          });
          this.emit();
        }
        if (beforeRosterKey === rosterKeyOfSnapshotRun(output.run.rosters)) return;
        await this.refresh();
      },
    });
  }
  private commandBase(
    prefix: string,
  ): Pick<
    SeasonRunCommand,
    'schemaVersion' | 'commandId' | 'runId' | 'expectedStateRevision' | 'expectedStateDigest'
  > {
    return {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      commandId: this.newCommandId(prefix),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
    };
  }
  private requiredRunId(): Id {
    const runId = this.snapshot?.run.runId;
    if (runId === undefined) throw new Error('no active season run to command');
    return runId;
  }
  private requiredStateRevision(): number {
    if (this.snapshot === null) throw new Error('no active season run to command');
    return this.snapshot.run.stateRevision;
  }
  private requiredStateDigest(): string {
    if (this.snapshot === null) throw new Error('no active season run to command');
    return this.snapshot.run.stateDigest;
  }
  private requiredHumanFranchiseId(): FranchiseId {
    const franchiseId =
      this.snapshot === null ? null : humanFranchiseIdOf(this.snapshot.run.league);
    if (franchiseId === null) throw new Error('the active run has no human franchise');
    return franchiseIdSchema.parse(franchiseId);
  }
  private humanFranchiseId(): string | null {
    return this.snapshot === null ? null : humanFranchiseIdOf(this.snapshot.run.league);
  }
  private activeRunId(): string | null {
    return this.snapshot?.run.runId ?? this.index?.runId ?? null;
  }
  private onRunnerEvent(event: SeasonRunnerEvent): void {
    if (this.isDisposed()) return;
    if (event.type === 'started') {
      if (this.block.blockIndex !== event.blockIndex) return;
      this.block.requestId = event.requestId;
      this.block.phase = 'running';
      this.lastProgressEmitAt = 0;
      this.emit();
      return;
    }
    if (event.requestId !== this.block.requestId) return;
    switch (event.type) {
      case 'progress': {
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.gamesCompleted = event.gamesCompleted;
        this.block.gamesTotal = event.gamesTotal;
        this.block.latestGameId = event.latestGameId;
        this.block.latestResult = event.latestResult;
        this.block.isHumanGame = event.isHumanGame;
        this.block.humanRecordInBlock = event.humanRecordInBlock;
        this.block.humanResults = event.humanResults;
        this.block.leaguePulse = event.leaguePulse;
        const now = this.clock.now();
        const isFinal = event.gamesTotal > 0 && event.gamesCompleted >= event.gamesTotal;
        if (!isFinal && !event.isHumanGame && now - this.lastProgressEmitAt < 1000) return;
        this.lastProgressEmitAt = now;
        break;
      }
      case 'candidate': {
        if (this.block.blockIndex !== event.blockIndex) break;
        if (this.blockCancelRequested) {
          this.settleCancelledBlock(event.requestId);
          return;
        }
        void this.acceptBlockCandidate(event.requestId, event.checkpoint);
        return;
      }
      case 'interrupted':
        if (this.block.blockIndex !== event.blockIndex) break;
        if (this.activeRunId() !== event.runId) break;
        if (this.blockCancelRequested) {
          this.settleCancelledBlock(event.requestId);
          return;
        }
        void this.acceptBlockInterruption(event.requestId, event.pending);
        return;
      case 'cancelled':
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.phase = 'cancelled';
        this.pending = null;
        this.interruption = null;
        break;
      case 'error':
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.phase = 'failed';
        this.block.error = {
          code: event.code,
          message: event.message,
          seed: event.seed,
          gameId: event.gameId,
        };
        break;
    }
    this.emit();
  }
  private interruptionStateForPending(
    pending: SeasonPendingBlockCandidate,
  ): SeasonInvalidRosterInterruption | null {
    const snapshot = this.snapshot;
    const humanFranchiseId = this.humanFranchiseId();
    if (snapshot === null || humanFranchiseId === null) return null;
    const facts = seasonFranchiseLegalFiveFacts(snapshot.run, humanFranchiseId, pending.health);
    if (facts.legal) return null;
    const unavailablePlayerVersionIds =
      facts.unavailablePlayerVersionIds.length > 0
        ? facts.unavailablePlayerVersionIds
        : (this.interruption?.unavailablePlayerVersionIds ?? []);
    if (unavailablePlayerVersionIds.length === 0) return this.interruption;
    return {
      code: 'invalid-roster',
      runId: pending.runId,
      blockIndex: pending.blockIndex,
      commandId: pending.commandId,
      nextGameId: pending.nextGameId,
      humanFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
      unavailablePlayerVersionIds,
    };
  }
  private emit(): void {
    if (this.isDisposed()) return;
    for (const listener of this.listeners) listener();
  }
}
export function indexAfterCommit(
  index: SeasonActiveRunIndex | null,
  snapshot: SeasonRunSnapshot,
  now: () => number,
): SeasonActiveRunIndex | null {
  const rawHuman = humanFranchiseIdOf(snapshot.run.league);
  const parsedHuman = rawHuman === null ? null : franchiseIdSchema.parse(rawHuman);
  const humanFranchiseId = parsedHuman;
  const humanRow =
    humanFranchiseId === null
      ? null
      : (snapshot.run.standings.rows.find((row) => row.franchiseId === humanFranchiseId) ?? null);
  if (index === null) {
    if (humanFranchiseId === null) {
      throw new Error('the committed run has no human franchise');
    }
    return {
      runId: snapshot.run.runId,
      rootSeed: snapshot.run.rootSeed,
      humanFranchiseId,
      completedRounds: snapshot.run.cursor.completedRounds,
      revision: snapshot.acceptedBlocks.length,
      humanWins: humanRow?.wins ?? 0,
      humanLosses: humanRow?.losses ?? 0,
      updatedAtIso: new Date(now()).toISOString(),
    };
  }
  return {
    ...index,
    runId: snapshot.run.runId,
    rootSeed: snapshot.run.rootSeed,
    humanFranchiseId: humanFranchiseId ?? index.humanFranchiseId,
    completedRounds: snapshot.run.cursor.completedRounds,
    revision: snapshot.acceptedBlocks.length,
    humanWins: humanRow?.wins ?? index.humanWins,
    humanLosses: humanRow?.losses ?? index.humanLosses,
    updatedAtIso: new Date(now()).toISOString(),
  };
}
export interface TradeBoardViewModel {
  windows: SeasonTradeWindowState[];
  openWindow: SeasonTradeWindowState | null;
  boardProfiles: SeasonTradeBoardTeamProfile[];
  negotiations: SeasonTradeNegotiation[];
  valueTrends: SeasonTradeValueTrend[];
  inquiryAllowance: number;
  inquiriesUsed: number;
  inquiriesRemaining: number;
  purchasedInquiryUsed: boolean;
  earnedInquiryUsed: boolean;
  activeInquiryId: string | null;
  exchangeCounts: Record<string, number>;
}
export function tradeBoardViewModel(run: SeasonRun | null): TradeBoardViewModel | null {
  if (run === null || run.trade === null) {
    return {
      windows: [],
      openWindow: null,
      boardProfiles: [],
      negotiations: [],
      valueTrends: [],
      inquiryAllowance: 3,
      inquiriesUsed: 0,
      inquiriesRemaining: 3,
      purchasedInquiryUsed: false,
      earnedInquiryUsed: false,
      activeInquiryId: null,
      exchangeCounts: {},
    };
  }
  const trade: SeasonTradeState = run.trade;
  const openWindow = trade.windows.find((w) => w.status === 'open') ?? null;
  const allowance = openWindow?.inquiryAllowance ?? 3;
  const used = openWindow?.negotiations?.length ?? 0;
  const purchasedUsed = openWindow?.purchasedInquiryUsed ?? false;
  const earnedUsed = openWindow?.earnedInquiryUsed ?? false;
  const boardProfiles = openWindow?.boardProfiles ?? [];
  const negotiations = openWindow?.negotiations ?? [];
  const valueTrends = openWindow?.valueTrends ?? [];
  const exchangeCounts: Record<string, number> = {};
  for (const n of negotiations) {
    exchangeCounts[n.inquiryId] = n.exchangeCount;
  }
  return {
    windows: trade.windows,
    openWindow,
    boardProfiles,
    negotiations,
    valueTrends,
    inquiryAllowance: allowance,
    inquiriesUsed: used,
    inquiriesRemaining: Math.max(0, allowance - used),
    purchasedInquiryUsed: purchasedUsed,
    earnedInquiryUsed: earnedUsed,
    activeInquiryId: openWindow?.activeInquiryId ?? null,
    exchangeCounts,
  };
}
export function describeCommandRejection(
  command: SeasonRunCommand['command'],
  rejection: SeasonRunCommandRejection,
): string {
  switch (rejection.code) {
    case 'run-mismatch':
      return 'The command does not belong to the active run.';
    case 'stale-state':
      return `The run moved on (revision ${String(rejection.currentStateRevision)}); the command was based on stale state. Refresh and try again.`;
    case 'duplicate-command':
      return 'This command was already applied.';
    case 'not-at-boundary':
      return `Objective selection must target the current block (block ${String(rejection.nextUnselectedBlockIndex + 1)}).`;
    case 'objective-not-offered':
      return 'That objective is not in the block’s offered set.';
    case 'objective-already-selected':
      return `Block ${String(rejection.blockIndex + 1)} already has a selected objective.`;
    case 'insufficient-balance':
      return `Influence balance ${String(rejection.balance)} cannot cover the ${String(-rejection.requestedDelta)}-point spend (floor ${String(rejection.floor)}).`;
    case 'window-not-open':
      return 'That trade window is not open right now.';
    case 'already-spent':
      return 'The extra trade offer was already bought this window.';
    case 'injury-not-active':
      return 'That injury is no longer active.';
    case 'already-rehabbed':
      return 'A risky rehab was already run for that injury.';
    case 'no-window':
      return 'No trade window is open to spend on.';
    case 'offer-unknown':
      return 'That trade offer is unknown.';
    case 'offer-not-open':
      return 'That trade offer is no longer open.';
    case 'roster-illegal':
      return `That trade would leave an illegal roster: ${rejection.reasons.join('; ')}`;
    case 'ownership-conflict':
      return 'That trade would duplicate player ownership.';
    case 'no-pending-block':
      return 'There is no interrupted block to resume.';
    case 'block-mismatch':
      return 'The command targets a different block than the interrupted one.';
    case 'rotation-digest-mismatch':
      return 'The rotation set changed since the block was locked.';
    case 'game-mismatch':
      return 'The forfeit targets a different game than the interrupted one.';
    case 'invalid-stage':
      return `The command requires the ${rejection.requiredStage} stage (the run is in ${rejection.currentStage}).`;
    case 'wrong-game':
      return `The target game ${rejection.targetGameId} is not the current next game (${rejection.nextGameId}).`;
    case 'invalid-rotation':
      return `The rotation is not legal for ${rejection.franchiseId}: ${rejection.reasons.join('; ')}`;
    case 'unavailable-player':
      return `The rotation names a player who cannot play: ${rejection.playerVersionId} (${rejection.reason}).`;
    case 'insufficient-rehab-resources':
      return `Influence balance ${String(rejection.balance)} cannot cover the ${String(rejection.required)}-point postseason rehab spend.`;
    case 'invalid-series-state':
      return `Series ${rejection.seriesId} cannot advance: ${rejection.reason}.`;
    case 'integrity-failure':
      return `The postseason integrity check failed: ${rejection.reason}.`;
    case 'free-agency-unresolved':
      return `The free-agency market window ${String(rejection.windowIndex + 1)} is still open — resolve it on the free-agency screen (/season/run/free-agency) before the next block can submit.`;
    case 'free-agency-window-not-open':
      return `The free-agency market window ${String(rejection.windowIndex + 1)} is not open right now.`;
    case 'free-agency-already-resolved':
      return `The free-agency market window ${String(rejection.windowIndex + 1)} is already resolved.`;
    case 'free-agency-already-declared':
      return `The franchise already declared or skipped the free-agency market window ${String(rejection.windowIndex + 1)}.`;
    case 'free-agency-target-ineligible':
      return `The declared target is not a candidate of this free-agency window.`;
    case 'free-agency-duplicate-identity':
      return `The declared target's identity is already active in the league.`;
    case 'free-agency-invalid-priority':
      return `The two targets must be distinct — ${rejection.playerVersionId} appears twice.`;
    case 'free-agency-unsupported-role':
      return `The role expectation is not supported for that free-agency candidate.`;
    case 'free-agency-invalid-influence':
      return `The committed Influence must be the candidate's minimum through 3 (minimum ${String(rejection.minimum)}).`;
    case 'free-agency-roster-cap':
      return `The franchise roster (${String(rejection.rosterSize)} players) is already at the 15-player cap.`;
    case 'free-agency-season-signing-cap':
      return `The franchise already signed ${String(rejection.signingCount)} free agents this season (cap 3).`;
    case 'free-agency-season-influence-cap':
      return `The franchise already spent ${String(rejection.seasonSpend)} Influence on free agency this season (cap 6).`;
    case 'free-agency-insufficient-balance':
      return `Influence balance ${String(rejection.balance)} cannot cover the ${String(rejection.required)}-point free-agency commitment.`;
    case 'free-agency-pending-declaration':
      return `The market cannot resolve until every human-controlled franchise declares or skips.`;
    case 'free-agency-ownership-conflict':
      return `The signing would create an ownership conflict: ${rejection.reason}.`;
    case 'campaign-identity-required':
      return 'Select a GM identity first.';
    case 'retired':
      return 'That command was retired — refresh the run to continue with the current options.';
    case 'campaign-identity-already-selected':
      return 'GM identity already selected.';
    case 'campaign-evolution-required':
      return 'Complete the midseason evolution choice first.';
    case 'campaign-opportunity-required':
      return `Select a campaign opportunity for block ${String(rejection.blockIndex + 1)}.`;
    case 'campaign-opportunity-not-offered':
      return 'That campaign opportunity was not offered for this block.';
    case 'campaign-already-selected':
      return `Block ${String(rejection.blockIndex + 1)} already has a campaign selection.`;
    case 'campaign-evolution-already-selected':
      return 'GM evolution already selected.';
    case 'campaign-evolution-not-offered':
      return 'That evolution option was not offered.';
    case 'trade-inquiry-cap':
      return `Trade inquiry cap reached (${String(rejection.inquiriesUsed)}/${String(rejection.allowance)}).`;
    case 'trade-active-negotiation':
      return 'Finish the active trade negotiation first.';
    case 'trade-duplicate-proposal':
      return 'That package is a duplicate of a previous proposal.';
    case 'trade-protected-player':
      return `Player ${rejection.playerVersionId} is protected.`;
    case 'trade-exchange-limit':
      return 'This inquiry has reached its exchange limit.';
    case 'trade-cash-cap':
      return `Trade cash cap reached for this window.`;
    case 'trade-negotiations-closed':
      return 'Negotiations are closed for this window.';
    case 'trade-negotiation-conflict':
      return 'Those players changed teams since the deal was proposed — start a fresh proposal.';
    case 'trade-negotiation-illegal':
      return `That trade would leave an illegal roster: ${rejection.reasons.join('; ')}`;
    case 'pending-block':
      return `Block ${String(rejection.blockIndex + 1)} is still pending — resume or forfeit it before trading.`;
    case 'trade-availability-risk':
      return `Player ${rejection.playerVersionId} has an availability risk.`;
    case 'trade-wrong-fit':
      return `Trade fit issue: ${rejection.reason}`;
    case 'trade-insufficient-talent':
      return `Insufficient talent: ${rejection.reason}`;
    case 'front-office-already-selected':
      return 'A front office is already selected and cannot be replaced.';
    case 'front-office-invalid':
      return 'That executive is not in the front-office catalog.';
    case 'front-office-too-late':
      return 'Front offices are chosen during setup, before the first block.';
    case 'innovation-not-discovered':
      return 'Court Innovation discovery has not happened yet (after block 3).';
    case 'innovation-already-selected':
      return 'A Court Innovation is already selected and cannot be replaced.';
    case 'innovation-invalid':
      return 'That innovation is not in the Court Innovation catalog.';
    case 'sponsor-not-offered':
      return 'That sponsor was not offered for this block.';
    case 'sponsor-already-purchased':
      return 'That sponsor was already bought this block.';
    case 'sponsor-expired':
      return 'That sponsor offer expired when its block locked.';
    case 'sponsor-not-owned':
      return 'That sponsor is not in the team vault.';
    case 'sponsor-slot-mismatch':
      return `That sponsor fits the ${rejection.expectedSlot} slot, not ${rejection.slot}.`;
    case 'sponsor-slot-occupied':
      return 'That gear slot is already filled — sponsorships are permanent.';
    case 'sponsor-not-on-roster':
      return 'That player is no longer on the roster.';
    case 'sponsor-brand-duplicate':
      return `That player already wears ${rejection.brandFamily} — one brand per player.`;
    default:
      return `The ${command} command was rejected.`;
  }
}
