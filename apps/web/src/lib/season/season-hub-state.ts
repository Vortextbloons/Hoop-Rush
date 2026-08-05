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
      const [snapshot, index] = await Promise.all([
        this.repo.loadActiveRun(),
        this.repo.loadActiveRunIndex(),
      ]);
      this.snapshot = snapshot;
      this.index = index;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.emit();
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
