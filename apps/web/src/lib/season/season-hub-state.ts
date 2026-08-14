import {
  humanFranchiseIdOf,
  SEASON_RUN_SCHEMA_VERSION,
  seasonSubmitBlockCommandSchema,
  type EraSimulationProfile,
  type SeasonActiveRunIndex,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonFreeAgencyIndex,
  type SeasonFreeAgencyRoleExpectation,
  type SeasonGameSummary,
  type SeasonInvalidRosterInterruption,
  type SeasonObjectiveId,
  type SeasonPendingBlockCandidate,
  type SeasonPostseasonRotationPayload,
  type SeasonPostseasonSummary,
  type SeasonRetainedGameDetail,
  type SeasonRosterTargets,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonRunCommandRejection,
  type SeasonScoreline,
  type SeasonSpendInfluenceCommand,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import { handleSeasonRunCommand, type SeasonRunCommandContext } from '@hoop-rush/engine';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from '$lib/season/season-block-runner';
import type {
  SeasonPostseasonEvent,
  SeasonPostseasonRunner,
} from '$lib/season/season-postseason-runner';
import {
  seasonPostseasonCommitResultDigest,
  seasonPostseasonTransactionIdsOf,
} from '$lib/season/season-postseason-simulation';
import type {
  CommitPostseasonAdvancementInput,
  SeasonPostseasonRepository,
  SeasonRunRepository,
  SeasonRunSnapshot,
} from '@hoop-rush/persistence';
import {
  isSeasonRunIncompatibleError,
  type SeasonRunIncompatibleInfo,
} from '@hoop-rush/persistence';
import { newSeasonId } from './season-ids';
import { sleep } from '$lib/sleep';
import {
  cachedSeasonSnapshotMatches,
  clearCachedSeasonSnapshot,
  getCachedSeasonSnapshot,
  setCachedSeasonSnapshot,
} from './season-state-cache';
import {
  createSeasonRunChannel,
  type SeasonRunChannel,
  type SeasonRunMutation,
} from './season-cross-tab';

export type BlockPhase = 'idle' | 'running' | 'interrupted' | 'cancelled' | 'failed' | 'complete';

export interface BlockRunState {
  requestId: string | null;
  blockIndex: number | null;
  phase: BlockPhase;
  gamesCompleted: number;
  gamesTotal: number;
  latestGameId: string | null;
  latestResult: SeasonScoreline | null;
  error: { code: string; message: string; seed: string | null; gameId: string | null } | null;

  command: SeasonSubmitBlockCommand | null;
  startInput: SeasonBlockStartInput | null;
}

export interface SubmitBlockEnvelope {
  command: SeasonSubmitBlockCommand;
  start: SeasonBlockStartInput;
}

export interface SeasonRunCommandError {
  command: SeasonRunCommand['command'];

  rejection: SeasonRunCommandRejection | null;
  message: string;
}

export type SeasonSpendInfluencePurpose = SeasonSpendInfluenceCommand['purpose'];

export type SeasonPostseasonPhase = 'idle' | 'running' | 'cancelled' | 'failed' | 'complete';

export interface SeasonPostseasonProgress {
  phase: SeasonPostseasonPhase;

  gamesCompleted: number;

  gamesTotal: number;
  latestGameId: string | null;
  latestResult: SeasonScoreline | null;
  error: { code: string; message: string } | null;
}

function postCommandEffects(run: SeasonRun, prior: SeasonEffectsState): SeasonEffectsState {
  const withEffects = run as SeasonRun & { effects?: SeasonEffectsState };
  return withEffects.effects ?? prior;
}

const handleRunCommand = handleSeasonRunCommand;

const IDLE_BLOCK: BlockRunState = {
  requestId: null,
  blockIndex: null,
  phase: 'idle',
  gamesCompleted: 0,
  gamesTotal: 0,
  latestGameId: null,
  latestResult: null,
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

export class SeasonHubState {
  private readonly repo: SeasonRunRepository & SeasonPostseasonRepository;
  private readonly runner: SeasonBlockRunner;
  private readonly listeners = new Set<() => void>();
  private unsubscribeRunner: (() => void) | null = null;

  private postseasonRunner: SeasonPostseasonRunner | null = null;
  private postseasonRunnerPromise: Promise<SeasonPostseasonRunner> | null = null;
  private unsubscribePostseasonRunner: (() => void) | null = null;

  private postseasonRequestId: string | null = null;

  private profilePromise: Promise<EraSimulationProfile> | null = null;

  private readonly channel: SeasonRunChannel;
  private unsubscribeChannel: (() => void) | null = null;

  private externalReloading = false;

  externalChange: { kind: SeasonRunMutation['kind']; message: string } | null = null;

  snapshot: SeasonRunSnapshot | null = null;
  index: SeasonActiveRunIndex | null = null;
  block: BlockRunState = { ...IDLE_BLOCK };

  postseason: SeasonPostseasonProgress = { ...IDLE_POSTSEASON };

  error: string | null = null;

  incompatible: SeasonRunIncompatibleInfo | null = null;

  pending: SeasonPendingBlockCandidate | null = null;

  interruption: SeasonInvalidRosterInterruption | null = null;

  commandError: SeasonRunCommandError | null = null;

  catalog: SeasonDraftCatalog | null = null;

  freeAgencyIndex: SeasonFreeAgencyIndex | null = null;

  freeAgencyTargets: SeasonRosterTargets | null = null;

  constructor(
    repo: SeasonRunRepository & SeasonPostseasonRepository,
    runner: SeasonBlockRunner,
    postseasonRunner?: SeasonPostseasonRunner,
  ) {
    this.repo = repo;
    this.runner = runner;
    this.unsubscribeRunner = runner.subscribe((event) => {
      this.onRunnerEvent(event);
    });
    if (postseasonRunner !== undefined) {
      this.attachPostseasonRunner(postseasonRunner);
    }
    this.channel = createSeasonRunChannel();
    this.unsubscribeChannel = this.channel.subscribe((mutation) => {
      void this.onExternalMutation(mutation);
    });
  }

  destroy(): void {
    this.unsubscribeRunner?.();
    this.unsubscribeRunner = null;
    this.unsubscribePostseasonRunner?.();
    this.unsubscribePostseasonRunner = null;
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.channel.close();
    this.runner.terminate();
    this.postseasonRunner?.terminate();
    this.postseasonRunner = null;
    this.postseasonRequestId = null;
    this.listeners.clear();
  }

  prewarm(): void {
    this.runner.prewarm();
    this.postseasonRunner?.prewarm();
  }

  private attachPostseasonRunner(runner: SeasonPostseasonRunner): void {
    this.postseasonRunner = runner;
    this.unsubscribePostseasonRunner = runner.subscribe((event) => {
      this.onPostseasonRunnerEvent(event);
    });
  }

  private resolvePostseasonRunner(): Promise<SeasonPostseasonRunner> {
    if (this.postseasonRunner !== null) return Promise.resolve(this.postseasonRunner);
    if (this.postseasonRunnerPromise === null) {
      this.postseasonRunnerPromise = import('./season-repo').then((module) =>
        module.getSeasonPostseasonRunner(),
      );
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
      this.profilePromise = import('./season-assets').then((module) =>
        module.loadSeasonEraProfile(),
      );
      this.profilePromise.catch(() => {
        this.profilePromise = null;
      });
    }
    return this.profilePromise;
  }

  private async ensureFreeAgencyIndex(): Promise<SeasonFreeAgencyIndex> {
    if (this.freeAgencyIndex !== null) return this.freeAgencyIndex;
    const module = await import('./season-assets');
    const index = await module.loadSeasonFreeAgencyIndex();
    this.freeAgencyIndex = index;
    return index;
  }

  private async ensureFreeAgencyTargets(): Promise<SeasonRosterTargets> {
    if (this.freeAgencyTargets !== null) return this.freeAgencyTargets;
    const module = await import('./season-assets');
    const targets = await module.loadSeasonFreeAgencyTargets();
    this.freeAgencyTargets = targets;
    return targets;
  }

  private async ensureCatalog(): Promise<SeasonDraftCatalog> {
    if (this.catalog !== null) return this.catalog;
    const module = await import('./season-assets');
    const catalog = await module.loadSeasonDraftCatalog();
    this.catalog = catalog;
    return catalog;
  }

  private async onExternalMutation(mutation: SeasonRunMutation): Promise<void> {
    if (this.externalReloading) return;
    this.externalReloading = true;
    try {
      const localRunId = this.snapshot?.run.runId ?? this.index?.runId ?? null;
      const localRevision = this.snapshot?.acceptedBlocks.length ?? this.index?.revision ?? -1;
      if (
        mutation.kind === 'commit' &&
        mutation.runId === localRunId &&
        mutation.revision === localRevision
      ) {
        return;
      }
      if (mutation.kind === 'commit' && localRunId !== null && mutation.runId !== localRunId) {
      }

      if (this.block.phase === 'running' && this.block.requestId !== null) {
        this.cancel();
      }
      clearCachedSeasonSnapshot();
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
    try {
      const index = await this.repo.loadActiveRunIndex();
      if (index !== null && cachedSeasonSnapshotMatches(index.runId, index.revision)) {
        this.snapshot = getCachedSeasonSnapshot();
        this.index = index;
        this.error = null;
        this.incompatible = null;
        this.emit();
        return;
      }

      if (
        index !== null &&
        this.snapshot !== null &&
        this.snapshot.run.runId === index.runId &&
        this.snapshot.acceptedBlocks.length === index.revision
      ) {
        this.index = index;
        this.error = null;
        this.incompatible = null;
        this.emit();
        return;
      }
      let snapshot: SeasonRunSnapshot | null;
      try {
        snapshot = await this.repo.loadActiveRun();
        this.incompatible = null;
      } catch (error) {
        if (isSeasonRunIncompatibleError(error)) {
          const info: SeasonRunIncompatibleInfo = error.info;
          this.snapshot = null;
          this.index = index;
          this.incompatible = info;
          this.error = null;
          this.emit();
          return;
        }
        throw error;
      }
      this.snapshot = snapshot;
      this.index = index;

      if (snapshot !== null) {
        try {
          this.pending = await this.repo.loadPendingBlock(snapshot.run.runId);
          if (this.pending === null) this.interruption = null;
        } catch {
          this.pending = null;
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
        setCachedSeasonSnapshot(snapshot);
      }
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.emit();
  }

  async discardIncompatibleRun(): Promise<void> {
    const incompatible = this.incompatible;
    if (incompatible === null) return;
    await this.repo.clearSeasonRun(incompatible.runId);
    clearCachedSeasonSnapshot();
    this.channel.announce({ kind: 'clear', runId: incompatible.runId, committedAt: Date.now() });
    this.incompatible = null;
    this.snapshot = null;
    this.index = null;
    await this.refresh();
  }

  async clearSeasonData(): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.repo.forceClearActiveSeasonRun();
      const { DexieSeasonDraftRepository } = await import('@hoop-rush/persistence');
      await new DexieSeasonDraftRepository().clearSeasonDraft();
      clearCachedSeasonSnapshot();
      this.incompatible = null;
      this.snapshot = null;
      this.index = null;
      this.pending = null;
      this.interruption = null;
      this.block = { ...IDLE_BLOCK };
      this.error = null;
      this.channel.announce({ kind: 'clear', runId: null, committedAt: Date.now() });
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

  loadPlayerSlice(
    runId: string,
  ): Promise<import('@hoop-rush/persistence').SeasonRunPlayerSliceEntry[] | null> {
    return this.repo.loadSeasonRunPlayerSlice(runId);
  }

  upsertPlayerSlice(
    runId: string,
    entries: import('@hoop-rush/persistence').SeasonRunPlayerSliceEntry[],
  ): Promise<void> {
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
    this.block = {
      ...IDLE_BLOCK,
      requestId: null,
      blockIndex: envelope.command.blockIndex,
      phase: 'running',
      gamesTotal: 0,
      command: envelope.command,
      startInput: envelope.start,
    };
    try {
      const requestId = this.runner.startBlock(envelope.start);
      this.block.requestId = requestId;
    } catch (error) {
      this.block.phase = 'failed';
      this.block.error = {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        seed: null,
        gameId: null,
      };
    }
    this.emit();
  }

  async resumeBlock(): Promise<void> {
    const pending = this.pending;
    if (pending === null) return;
    if (this.block.phase === 'running') return;
    const submitted = this.block.startInput;
    let input: SeasonBlockResumeInput;
    if (submitted !== null) {
      input = {
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
        import('./season-assets').then((module) => module.loadSeasonHomeCourtProfile()),
        import('./season-assets').then((module) => module.seasonArtifactUrls()),
      ]);
      input = {
        runId: run.runId,
        blockIndex: pending.blockIndex,
        expectedRevision: pending.expectedRevision,
        rotationDigest: pending.rotationDigest,
        commandId: pending.commandId,
        rotations: run.rotations,
        humanFranchiseId: humanFranchiseIdOf(run.league),
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
    try {
      const requestId = this.runner.resumeBlock(input);
      this.block.requestId = requestId;
    } catch (error) {
      this.block.phase = 'failed';
      this.block.error = {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        seed: null,
        gameId: null,
      };
    }
    this.emit();
  }

  async selectBlockObjective(input: {
    blockIndex: number;
    objectiveId: SeasonObjectiveId;
  }): Promise<void> {
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'select-block-objective',
      commandId: newSeasonId('obj'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      blockIndex: input.blockIndex,
      objectiveId: input.objectiveId,
    };
    await this.dispatch(command);
  }

  async spendInfluence(input: {
    purpose: SeasonSpendInfluencePurpose;
    windowIndex?: number;
    injuryId?: string;
  }): Promise<void> {
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'spend-influence',
      commandId: newSeasonId('inf'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
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
      this.commandError = {
        command: 'accept-trade-offer',
        rejection: null,
        message: `The draft catalog is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      this.emit();
      return;
    }
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'accept-trade-offer',
      commandId: newSeasonId('acc'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      windowIndex: input.windowIndex,
      offerId: input.offerId,
    };
    await this.dispatch(command);
  }

  async declineTradeOffer(input: { windowIndex: number; offerId: string }): Promise<void> {
    try {
      await this.ensureCatalog();
    } catch (error) {
      this.commandError = {
        command: 'decline-trade-offer',
        rejection: null,
        message: `The draft catalog is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      this.emit();
      return;
    }
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'decline-trade-offer',
      commandId: newSeasonId('dec'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      windowIndex: input.windowIndex,
      offerId: input.offerId,
    };
    await this.dispatch(command);
  }

  async forfeitInterruptedGame(): Promise<void> {
    const pending = this.pending;
    const interruption = this.interruption;
    if (pending === null) return;
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'forfeit-interrupted-game',
      commandId: newSeasonId('for'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      blockIndex: pending.blockIndex,
      nextGameId: interruption?.nextGameId ?? pending.nextGameId,
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
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'declare-free-agent-interest',
      commandId: newSeasonId('fad'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      franchiseId: this.requiredHumanFranchiseId(),
      windowIndex: input.windowIndex,
      targets: input.targets,
    };
    await this.dispatch(command);
  }

  async skipFreeAgentMarket(input: { windowIndex: number }): Promise<void> {
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'skip-free-agent-market',
      commandId: newSeasonId('fas'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      franchiseId: this.requiredHumanFranchiseId(),
      windowIndex: input.windowIndex,
    };
    await this.dispatch(command);
  }

  async resolveFreeAgentMarket(input: { windowIndex: number }): Promise<void> {
    const snapshot = this.snapshot;
    this.commandError = null;
    if (snapshot === null) {
      this.commandError = {
        command: 'resolve-free-agent-market',
        rejection: null,
        message: 'The active run is not loaded yet.',
      };
      this.emit();
      return;
    }
    try {
      await Promise.all([
        this.ensureFreeAgencyIndex(),
        this.ensureFreeAgencyTargets(),
        this.catalog === null
          ? import('./season-assets').then((module) => module.loadSeasonDraftCatalog())
          : Promise.resolve(null),
      ]).then(([index, targets, catalog]) => {
        this.freeAgencyIndex = index;
        this.freeAgencyTargets = targets;
        if (catalog !== null) this.catalog = catalog;
      });
    } catch (error) {
      this.commandError = {
        command: 'resolve-free-agent-market',
        rejection: null,
        message: `The free-agency market assets are unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      this.emit();
      return;
    }
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'resolve-free-agent-market',
      commandId: newSeasonId('far'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      windowIndex: input.windowIndex,
    };
    await this.dispatch(command);
  }

  cancel(): void {
    const requestId = this.block.requestId;
    if (this.block.phase !== 'running' || requestId === null) return;
    this.runner.cancel(requestId);
  }

  async startPostseason(): Promise<void> {
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'start-postseason',
      commandId: newSeasonId('pst'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
    };
    await this.dispatchPostseason(command);
  }

  async advancePostseason(input?: { targetGameId?: string }): Promise<void> {
    const command: SeasonRunCommand['command'] = 'advance-postseason';
    if (!this.requirePostseasonStage(command)) return;
    const runner = await this.resolvePostseasonRunner();
    this.postseasonRequestId = runner.advancePostseason({
      runId: this.requiredRunId(),
      commandId: newSeasonId('adv'),
      ...(input?.targetGameId !== undefined ? { targetGameId: input.targetGameId } : {}),
      humanFranchiseId: this.humanFranchiseId(),
    });
  }

  async submitPostseasonRotation(input: {
    targetGameId: string;
    rotation: SeasonPostseasonRotationPayload;
  }): Promise<void> {
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      command: 'submit-postseason-rotation',
      commandId: newSeasonId('sub'),
      runId: this.requiredRunId(),
      expectedStateRevision: this.requiredStateRevision(),
      expectedStateDigest: this.requiredStateDigest(),
      targetGameId: input.targetGameId,
      rotation: input.rotation,
    };
    await this.dispatchPostseason(command);
  }

  async spectatePostseasonGame(input: { targetGameId: string }): Promise<void> {
    const command: SeasonRunCommand['command'] = 'spectate-postseason-game';
    if (!this.requirePostseasonStage(command)) return;
    const runner = await this.resolvePostseasonRunner();
    this.postseasonRequestId = runner.spectatePostseasonGame({
      runId: this.requiredRunId(),
      commandId: newSeasonId('spc'),
      targetGameId: input.targetGameId,
      humanFranchiseId: this.humanFranchiseId(),
    });
  }

  async fastForwardPostseason(input?: { targetGameId?: string }): Promise<void> {
    const command: SeasonRunCommand['command'] = 'fast-forward-postseason';
    if (!this.requirePostseasonStage(command)) return;
    const runner = await this.resolvePostseasonRunner();
    this.postseasonRequestId = runner.fastForwardPostseason({
      runId: this.requiredRunId(),
      commandId: newSeasonId('ff'),
      ...(input?.targetGameId !== undefined ? { targetGameId: input.targetGameId } : {}),
      humanFranchiseId: this.humanFranchiseId(),
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

  private requirePostseasonStage(command: SeasonRunCommand['command']): boolean {
    const stage = this.snapshot?.run.stage ?? null;
    if (stage === 'play-in' || stage === 'playoffs') return true;
    this.commandError = {
      command,
      rejection: {
        code: 'invalid-stage',
        requiredStage: 'play-in',
        currentStage: stage ?? 'regular-season',
      },
      message: describeCommandRejection(command, {
        code: 'invalid-stage',
        requiredStage: 'play-in',
        currentStage: stage ?? 'regular-season',
      }),
    };
    this.emit();
    return false;
  }

  private async dispatchPostseason(command: SeasonRunCommand): Promise<void> {
    const snapshot = this.snapshot;
    this.commandError = null;
    if (snapshot === null) {
      this.commandError = {
        command: command.command,
        rejection: null,
        message: 'The active run is not loaded yet.',
      };
      this.emit();
      return;
    }
    let profile: EraSimulationProfile;
    try {
      profile = await this.loadProfile();
    } catch (error) {
      this.commandError = {
        command: command.command,
        rejection: null,
        message: `The season era profile is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      this.emit();
      return;
    }
    try {
      const output = handleRunCommand(command, {
        run: snapshot.run,
        pending: null,
        humanFranchiseId: this.humanFranchiseId(),
        effects: snapshot.effects,
        catalog: this.catalog ?? undefined,
        profile,
      } satisfies SeasonRunCommandContext);
      const envelope = output.result;
      if (envelope.result.status === 'rejected') {
        this.commandError = {
          command: command.command,
          rejection: envelope.result.rejection,
          message: describeCommandRejection(command.command, envelope.result.rejection),
        };
        this.emit();
        return;
      }
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
        relatedGameIds: [],
        transactionIds: seasonPostseasonTransactionIdsOf(output.run, command.commandId),
      };
      await this.repo.commitPostseasonAdvancement(commitInput);
      this.commandError = null;

      if (this.snapshot !== null) {
        const effects = postCommandEffects(output.run, snapshot.effects);
        this.snapshot = { ...this.snapshot, run: output.run, effects };
        setCachedSeasonSnapshot(this.snapshot);
        this.emit();
      }
      await this.refresh();
    } catch (error) {
      this.commandError = {
        command: command.command,
        rejection: null,
        message: error instanceof Error ? error.message : String(error),
      };
      this.emit();
    }
  }

  private onPostseasonRunnerEvent(event: SeasonPostseasonEvent): void {
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
        this.snapshot = event.snapshot;
        this.index = indexAfterCommit(this.index, event.snapshot);
        setCachedSeasonSnapshot(event.snapshot);
        this.postseason = {
          ...this.postseason,
          phase: 'running',
          gamesCompleted: this.postseason.gamesCompleted + event.gameIds.length,
        };

        this.channel.announce({
          kind: 'replace',
          runId: event.runId,
          committedAt: Date.now(),
        });
        break;
      }
      case 'complete': {
        const promoted = event.promoted;
        this.postseason = {
          ...this.postseason,
          phase: 'complete',
          latestGameId: null,
          latestResult: null,
          error: null,
        };
        if (promoted) {
          clearCachedSeasonSnapshot();
          this.snapshot = null;
          this.index = null;
          this.pending = null;
          this.interruption = null;
          this.channel.announce({
            kind: 'clear',
            runId: event.runId,
            committedAt: Date.now(),
          });
        } else if (event.snapshot !== null) {
          this.snapshot = event.snapshot;
          this.index = indexAfterCommit(this.index, event.snapshot);
          setCachedSeasonSnapshot(event.snapshot);
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

  async quitRun(): Promise<{ ok: boolean; error: string | null }> {
    if (this.snapshot === null) {
      return { ok: false, error: 'no active season run to quit' };
    }
    const runId = this.snapshot.run.runId;
    if (this.block.phase === 'running') {
      this.cancel();
      const deadline = Date.now() + 5000;
      const phaseOf = (): BlockPhase => this.block.phase;
      while (phaseOf() === 'running' && Date.now() < deadline) {
        await sleep(100);
      }
      if (phaseOf() === 'running') {
        this.runner.terminate();
        this.block = { ...IDLE_BLOCK };
        this.emit();
      }
    }
    try {
      await this.repo.clearSeasonRun(runId);
      clearCachedSeasonSnapshot();
      this.channel.announce({ kind: 'clear', runId, committedAt: Date.now() });
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
    clearCachedSeasonSnapshot();
    await this.refresh();
    const revision = this.snapshot?.acceptedBlocks.length;
    if (revision === undefined || this.block.command.expectedRevision !== revision) {
      this.block = { ...IDLE_BLOCK };
      this.emit();
      return;
    }
    this.startBlock({
      command: this.block.command,
      start: this.block.startInput,
    });
  }

  private async dispatch(command: SeasonRunCommand): Promise<void> {
    const snapshot = this.snapshot;
    this.commandError = null;
    if (snapshot === null) {
      this.commandError = {
        command: command.command,
        rejection: null,
        message: 'The active run is not loaded yet.',
      };
      this.emit();
      return;
    }
    try {
      const output = handleRunCommand(command, {
        run: snapshot.run,
        pending: this.pending,
        humanFranchiseId: this.humanFranchiseId(),
        effects: snapshot.effects,
        catalog: this.catalog ?? undefined,

        freeAgencyIndex: this.freeAgencyIndex ?? undefined,
        freeAgencyTargets: this.freeAgencyTargets ?? undefined,
      } satisfies SeasonRunCommandContext);
      const envelope = output.result;
      if (envelope.result.status === 'rejected') {
        this.commandError = {
          command: command.command,
          rejection: envelope.result.rejection,
          message: describeCommandRejection(command.command, envelope.result.rejection),
        };
        this.emit();
        return;
      }
      await this.repo.applySeasonRunCommand({
        runId: snapshot.run.runId,
        command,
        run: output.run,
        effects: postCommandEffects(output.run, snapshot.effects),
        pending: output.pending,
      });
      this.commandError = null;

      if (this.snapshot !== null) {
        const effects = postCommandEffects(output.run, this.snapshot.effects);
        this.snapshot = { ...this.snapshot, run: output.run, effects };

        setCachedSeasonSnapshot(this.snapshot);
        this.emit();
      }
      await this.refresh();
    } catch (error) {
      this.commandError = {
        command: command.command,
        rejection: null,
        message: error instanceof Error ? error.message : String(error),
      };
      this.emit();
    }
  }

  private requiredRunId(): string {
    const runId = this.snapshot?.run.runId;
    if (runId === undefined) throw new Error('no active season run to command');
    return runId;
  }

  private requiredStateRevision(): number {
    return this.snapshot?.run.stateRevision ?? 0;
  }

  private requiredStateDigest(): string {
    return this.snapshot?.run.stateDigest ?? '0'.repeat(32);
  }

  private requiredHumanFranchiseId(): string {
    const franchiseId =
      this.snapshot === null ? null : humanFranchiseIdOf(this.snapshot.run.league);
    if (franchiseId === null) throw new Error('the active run has no human franchise');
    return franchiseId;
  }

  private humanFranchiseId(): string | null {
    return this.snapshot === null ? null : humanFranchiseIdOf(this.snapshot.run.league);
  }

  private onRunnerEvent(event: SeasonRunnerEvent): void {
    switch (event.type) {
      case 'started':
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.requestId = event.requestId;
        this.block.phase = 'running';
        break;
      case 'progress':
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.gamesCompleted = event.gamesCompleted;
        this.block.gamesTotal = event.gamesTotal;
        this.block.latestGameId = event.latestGameId;
        this.block.latestResult = event.latestResult;
        break;
      case 'complete': {
        if (this.block.blockIndex !== event.checkpoint.blockIndex) break;
        this.block.latestGameId = null;
        this.block.latestResult = null;
        this.block.error = null;

        this.pending = null;
        this.interruption = null;
        this.snapshot = event.snapshot;
        this.index = indexAfterCommit(this.index, event.snapshot);
        setCachedSeasonSnapshot(event.snapshot);
        this.block = { ...IDLE_BLOCK };
        this.channel.announce({
          kind: 'commit',
          runId: event.snapshot.run.runId,
          revision: event.snapshot.acceptedBlocks.length,
          committedAt: Date.now(),
        });
        this.emit();
        return;
      }
      case 'interrupted':
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.phase = 'interrupted';
        this.block.latestGameId = null;
        this.block.latestResult = null;
        this.block.error = null;
        this.pending = event.pending;
        this.interruption = event.interruption;
        this.commandError = null;
        break;
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

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function indexAfterCommit(
  index: SeasonActiveRunIndex | null,
  snapshot: SeasonRunSnapshot,
): SeasonActiveRunIndex | null {
  const humanFranchiseId = humanFranchiseIdOf(snapshot.run.league);
  const humanRow =
    humanFranchiseId === null
      ? null
      : (snapshot.run.standings.rows.find((row) => row.franchiseId === humanFranchiseId) ?? null);
  if (index === null) {
    return {
      runId: snapshot.run.runId,
      rootSeed: snapshot.run.rootSeed,
      humanFranchiseId: humanFranchiseId ?? '',
      completedRounds: snapshot.run.cursor.completedRounds,
      revision: snapshot.acceptedBlocks.length,
      humanWins: humanRow?.wins ?? 0,
      humanLosses: humanRow?.losses ?? 0,
      updatedAtIso: new Date().toISOString(),
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
    updatedAtIso: new Date().toISOString(),
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
      return `Objective selection must target the current block (block ${String(
        rejection.nextUnselectedBlockIndex + 1,
      )}).`;
    case 'objective-not-offered':
      return 'That objective is not in the block’s offered set.';
    case 'objective-already-selected':
      return `Block ${String(rejection.blockIndex + 1)} already has a selected objective.`;
    case 'insufficient-balance':
      return `Influence balance ${String(rejection.balance)} cannot cover the ${String(
        -rejection.requestedDelta,
      )}-point spend (floor ${String(rejection.floor)}).`;
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
      return `Influence balance ${String(rejection.balance)} cannot cover the ${String(
        rejection.required,
      )}-point postseason rehab spend.`;
    case 'invalid-series-state':
      return `Series ${rejection.seriesId} cannot advance: ${rejection.reason}.`;
    case 'integrity-failure':
      return `The postseason integrity check failed: ${rejection.reason}.`;

    case 'free-agency-unresolved':
      return `The free-agency market window ${String(
        rejection.windowIndex + 1,
      )} is still open — resolve it on the free-agency screen (/season/run/free-agency) before the next block can submit.`;
    case 'free-agency-window-not-open':
      return `The free-agency market window ${String(
        rejection.windowIndex + 1,
      )} is not open right now.`;
    case 'free-agency-already-resolved':
      return `The free-agency market window ${String(
        rejection.windowIndex + 1,
      )} is already resolved.`;
    case 'free-agency-already-declared':
      return `The franchise already declared or skipped the free-agency market window ${String(
        rejection.windowIndex + 1,
      )}.`;
    case 'free-agency-target-ineligible':
      return `The declared target is not a candidate of this free-agency window.`;
    case 'free-agency-duplicate-identity':
      return `The declared target's identity is already active in the league.`;
    case 'free-agency-invalid-priority':
      return `The two targets must be distinct — ${rejection.playerVersionId} appears twice.`;
    case 'free-agency-unsupported-role':
      return `The role expectation is not supported for that free-agency candidate.`;
    case 'free-agency-invalid-influence':
      return `The committed Influence must be the candidate's minimum through 3 (minimum ${String(
        rejection.minimum,
      )}).`;
    case 'free-agency-roster-cap':
      return `The franchise roster (${String(
        rejection.rosterSize,
      )} players) is already at the 15-player cap.`;
    case 'free-agency-season-signing-cap':
      return `The franchise already signed ${String(
        rejection.signingCount,
      )} free agents this season (cap 3).`;
    case 'free-agency-season-influence-cap':
      return `The franchise already spent ${String(
        rejection.seasonSpend,
      )} Influence on free agency this season (cap 6).`;
    case 'free-agency-insufficient-balance':
      return `Influence balance ${String(rejection.balance)} cannot cover the ${String(
        rejection.required,
      )}-point free-agency commitment.`;
    case 'free-agency-pending-declaration':
      return `The market cannot resolve until every human-controlled franchise declares or skips.`;
    case 'free-agency-ownership-conflict':
      return `The signing would create an ownership conflict: ${rejection.reason}.`;
    default:
      return `The ${command} command was rejected.`;
  }
}
