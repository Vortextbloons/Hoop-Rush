import {
  humanFranchiseIdOf,
  SEASON_RUN_SCHEMA_VERSION,
  seasonSubmitBlockCommandSchema,
  type SeasonAcceptTradeOfferResult,
  type SeasonActiveRunIndex,
  type SeasonDeclineTradeOfferResult,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonForfeitInterruptedGameResult,
  type SeasonGameSummary,
  type SeasonInvalidRosterInterruption,
  type SeasonObjectiveId,
  type SeasonPendingBlockCandidate,
  type SeasonResumeSeasonBlockResult,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonRunCommandRejection,
  type SeasonSelectBlockObjectiveResult,
  type SeasonSpendInfluenceCommand,
  type SeasonSpendInfluenceResult,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import { handleSeasonRunCommand, type SeasonRunCommandContext } from '@hoop-rush/engine';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from '$lib/season/season-block-runner';
import type { SeasonRunRepository, SeasonRunSnapshot } from '@hoop-rush/persistence';
import {
  isSeasonRunIncompatibleError,
  type SeasonRunIncompatibleInfo,
} from '@hoop-rush/persistence';
import { newSeasonId } from './season-ids';
import {
  cachedSeasonSnapshotMatches,
  clearCachedSeasonSnapshot,
  getCachedSeasonSnapshot,
  setCachedSeasonSnapshot,
} from './season-state-cache';

/**
 * Season Run hub state (spec/2.0/07 background execution, M2.3, M2.5): the
 * single UI-side owner of the accepted snapshot and the live block run. It
 * reads accepted state from the repository, subscribes to the frozen
 * `SeasonBlockRunner` events, and re-reads the snapshot after every
 * `complete`. Block submission builds the typed `SeasonSubmitBlockCommand`
 * (commandId, expectedRevision, blockIndex, rotationDigest, objectiveId,
 * expectedStateRevision/Digest) and hands the runner its
 * `SeasonBlockStartInput`; cancellation and retry route through the same
 * request id.
 *
 * M2.5: the hub also issues the typed between-block commands
 * (select-block-objective, spend-influence, accept/decline-trade-offer,
 * forfeit-interrupted-game) through the pure engine handler against the
 * current snapshot state, persists accepted results through
 * `repo.applySeasonRunCommand`, and mirrors the runner's `interrupted`
 * event (pending candidate + typed invalid-roster interruption) for the
 * interruption recovery panel. `resumeBlock` routes through the runner's
 * `SeasonBlockResumeInput` (the interrupted submission's identity facts).
 * The runner (persistence-owned) owns validation, canonical acceptance, and
 * atomic persistence; this module never touches IndexedDB directly.
 */

export type BlockPhase = 'idle' | 'running' | 'interrupted' | 'cancelled' | 'failed' | 'complete';

export interface BlockRunState {
  requestId: string | null;
  blockIndex: number | null;
  phase: BlockPhase;
  gamesCompleted: number;
  gamesTotal: number;
  latestGameId: string | null;
  latestResult: SeasonGameSummary | null;
  error: { code: string; message: string; seed: string | null; gameId: string | null } | null;
  /** The submitted command (retry re-issues the same idempotent command). */
  command: SeasonSubmitBlockCommand | null;
  startInput: SeasonBlockStartInput | null;
}

export interface SubmitBlockEnvelope {
  command: SeasonSubmitBlockCommand;
  start: SeasonBlockStartInput;
}

/** A rejected between-block command, surfaced as a typed alert. */
export interface SeasonRunCommandError {
  command: SeasonRunCommand['command'];
  /** Null when the engine handler was not implemented yet in this build. */
  rejection: SeasonRunCommandRejection | null;
  message: string;
}

/** The two M2.5 Influence spend purposes (data-contracts keeps them inline). */
export type SeasonSpendInfluencePurpose = SeasonSpendInfluenceCommand['purpose'];

/** The post-command effects state when the engine attached it to the run output. */
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

export class SeasonHubState {
  private readonly repo: SeasonRunRepository;
  private readonly runner: SeasonBlockRunner;
  private readonly listeners = new Set<() => void>();
  private unsubscribeRunner: (() => void) | null = null;

  snapshot: SeasonRunSnapshot | null = null;
  index: SeasonActiveRunIndex | null = null;
  block: BlockRunState = { ...IDLE_BLOCK };
  /** Load error surfaced to the page. */
  error: string | null = null;
  /**
   * M2.4: a stored run made under an older schema (schema-v4 runs cannot
   * continue). The run rows are preserved until the user explicitly discards
   * them through `discardIncompatibleRun`.
   */
  incompatible: SeasonRunIncompatibleInfo | null = null;
  /**
   * M2.5: the uncommitted pending block candidate of an interrupted run
   * (persisted; survives reload). Null when no block is paused.
   */
  pending: SeasonPendingBlockCandidate | null = null;
  /**
   * M2.5: the typed invalid-roster interruption (from the runner event;
   * null after a reload — the pending candidate still proves the pause).
   */
  interruption: SeasonInvalidRosterInterruption | null = null;
  /** M2.5: the last rejected between-block command, surfaced as a typed alert. */
  commandError: SeasonRunCommandError | null = null;
  /**
   * Packaged draft catalog for trade commands (positions + ratings). Set by
   * the run layout after assets load.
   */
  catalog: SeasonDraftCatalog | null = null;

  constructor(repo: SeasonRunRepository, runner: SeasonBlockRunner) {
    this.repo = repo;
    this.runner = runner;
    this.unsubscribeRunner = runner.subscribe((event) => {
      this.onRunnerEvent(event);
    });
  }

  /** Tears down the runner subscription and worker (route change). */
  destroy(): void {
    this.unsubscribeRunner?.();
    this.unsubscribeRunner = null;
    this.runner.terminate();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reloads the accepted snapshot + active-run index from the repository. */
  async refresh(): Promise<void> {
    try {
      const index = await this.repo.loadActiveRunIndex();
      if (index !== null && cachedSeasonSnapshotMatches(index.runId, index.revision)) {
        // The validated snapshot for this exact accepted state is already
        // loaded; skip the full load + reconciliation audit.
        this.snapshot = getCachedSeasonSnapshot();
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
          // The stored run predates the M2.4 schema: it stays stored, but the
          // run cannot continue; the UI shows the discard-and-restart screen.
          // The type guard above narrowed `error`; eslint treats members of
          // Error-typed values as unsafe, so the info is re-typed explicitly.
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
      // M2.5: a persisted pending candidate survives reload; mirror it so the
      // interruption recovery panel re-renders after a page reload.
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

  /**
   * M2.4: explicit user discard of an incompatible stored run. The run rows
   * are deleted only after the user confirms; nothing is migrated.
   */
  async discardIncompatibleRun(): Promise<void> {
    const incompatible = this.incompatible;
    if (incompatible === null) return;
    await this.repo.clearSeasonRun(incompatible.runId);
    this.incompatible = null;
    this.snapshot = null;
    this.index = null;
    await this.refresh();
  }

  /** Next block index: the accepted-block count (0..8). */
  nextBlockIndex(): number | null {
    return this.snapshot?.acceptedBlocks.length ?? null;
  }

  /** Block summaries for one accepted block (gameId ascending). */
  loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]> {
    return this.repo.loadBlockSummaries(runId, blockIndex);
  }

  /** Retained detail rows for the run's human games (gameId ascending). */
  loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]> {
    return this.repo.loadRetainedDetails(runId);
  }

  /** Validates the command shape and starts the block on the runner. */
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

  /**
   * M2.5: resumes an interrupted block through the runner's
   * `SeasonBlockResumeInput` (the interrupted submission's identity facts —
   * same command id for idempotency, the locked rotations, and the asset
   * urls). After a reload the locked rotations are rebuilt from the run's
   * committed set (the runner rejects a digest mismatch with a typed error);
   * the packaged assets are re-loaded on demand.
   */
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

  /** M2.5: selects the block's objective (typed command before submission). */
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

  /** M2.5: spends Influence on an extra trade offer or a risky rehab. */
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

  /** M2.5: accepts an open trade offer (atomic roster + ownership transfer). */
  async acceptTradeOffer(input: { windowIndex: number; offerId: string }): Promise<void> {
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

  /** M2.5: declines an open trade offer (offer status -> declined). */
  async declineTradeOffer(input: { windowIndex: number; offerId: string }): Promise<void> {
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

  /**
   * M2.5: forfeits the interrupted game (official 2-0, no player stats),
   * advances the pending candidate, and re-checks the next game.
   */
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

  /** Requests cancellation; the worker stops between games. */
  cancel(): void {
    const requestId = this.block.requestId;
    if (this.block.phase !== 'running' || requestId === null) return;
    this.runner.cancel(requestId);
  }

  /**
   * Quits the current run: stops an in-flight block (cancel, then terminate
   * if the worker does not acknowledge), clears the run atomically
   * (checkpoint, index, summaries, details, blocks), and reloads so the
   * shell falls back to its empty state. Terminating a stuck worker also
   * invalidates its pending candidate, so nothing can be committed behind
   * the clear.
   */
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
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (phaseOf() === 'running') {
        this.runner.terminate();
        this.block = { ...IDLE_BLOCK };
        this.emit();
      }
    }
    try {
      await this.repo.clearSeasonRun(runId);
      await this.refresh();
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `could not quit the run: ${message}` };
    }
  }

  /** Re-issues the same idempotent command after cancel/failure. */
  retry(): void {
    if (this.block.command === null || this.block.startInput === null) return;
    if (this.block.phase !== 'cancelled' && this.block.phase !== 'failed') return;
    this.startBlock({
      command: this.block.command,
      start: this.block.startInput,
    });
  }

  /**
   * M2.5: dispatches one between-block command through the pure engine
   * handler, persists the accepted mutation atomically, and refreshes the
   * snapshot. Rejections surface as the typed `commandError` alert.
   */
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
      // Apply the engine mutation immediately so the hub reflects the
      // selection before the repository round-trip (and so a stale session
      // snapshot cache cannot flash the pre-command state back into the UI).
      if (this.snapshot !== null) {
        const effects = postCommandEffects(output.run, this.snapshot.effects);
        this.snapshot = { ...this.snapshot, run: output.run, effects };
        this.emit();
      }
      // Between-block commands mutate the run without changing the
      // accepted-block count, so the session snapshot cache (keyed by runId
      // + revision) would serve the stale pre-command state on refresh.
      // Clear it so the full validated load picks up the persisted state.
      clearCachedSeasonSnapshot();
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
        this.block.phase = 'complete';
        this.block.latestGameId = null;
        this.block.latestResult = null;
        this.block.error = null;
        // The runner committed atomically (deleting any pending row in the
        // same transaction); re-read the accepted snapshot and clear the
        // interrupted state.
        this.pending = null;
        this.interruption = null;
        void this.refresh();
        break;
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

/** Human-readable explanation of a typed command rejection (UI alert). */
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
      return `Objective selection must target the next unselected block (block ${String(
        rejection.nextUnselectedBlockIndex,
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
    default:
      return `The ${command} command was rejected.`;
  }
}
