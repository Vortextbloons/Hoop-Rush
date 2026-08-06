import {
  seasonSubmitBlockCommandSchema,
  type SeasonActiveRunIndex,
  type SeasonGameSummary,
  type SeasonRetainedGameDetail,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import type {
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from '$lib/season/season-block-runner';
import type { SeasonRunRepository, SeasonRunSnapshot } from '@hoop-rush/persistence';
import {
  isSeasonRunIncompatibleError,
  type SeasonRunIncompatibleInfo,
} from '@hoop-rush/persistence';
import {
  cachedSeasonSnapshotMatches,
  getCachedSeasonSnapshot,
  setCachedSeasonSnapshot,
} from './season-state-cache';

/**
 * Season Run hub state (spec/2.0/07 background execution, M2.3): the single
 * UI-side owner of the accepted snapshot and the live block run. It reads
 * accepted state from the repository, subscribes to the frozen
 * `SeasonBlockRunner` events, and re-reads the snapshot after every
 * `complete`. Block submission builds the typed `SeasonSubmitBlockCommand`
 * (commandId, expectedRevision, blockIndex, rotationDigest) and hands the
 * runner its `SeasonBlockStartInput`; cancellation and retry route through
 * the same request id. The runner (lead-owned) owns validation, canonical
 * acceptance, and atomic persistence; this module never touches IndexedDB.
 */

export type BlockPhase = 'idle' | 'running' | 'cancelled' | 'failed' | 'complete';

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
        // The runner committed atomically; re-read the accepted snapshot.
        void this.refresh();
        break;
      }
      case 'cancelled':
        if (this.block.blockIndex !== event.blockIndex) break;
        this.block.phase = 'cancelled';
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
