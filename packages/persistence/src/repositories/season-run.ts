import type {
  SeasonAcceptedBlock,
  SeasonActiveRunIndex,
  SeasonBlockRecap,
  SeasonCandidateCheckpoint,
  SeasonCheckpointState,
  SeasonEffectsState,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonInvalidRosterInterruption,
  SeasonObjectiveState,
  SeasonPendingBlockCandidate,
  SeasonRetainedGameDetail,
  SeasonRotation,
  SeasonRun,
  SeasonRunCommand,
  SeasonStandings,
  SeasonTeamAggregate,
  SeasonPlayerAggregate,
  SeasonTradeState,
  SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type { SeasonWindowOpenResult } from '../season/engine-seam-types.ts';

/**
 * Season Run repository contract (spec/2.0/07 persistence, M2.3, M2.4, M2.5).
 * One active Season Run coexists with the Challenge and Classic stores,
 * isolated in dedicated tables. The contract is frozen; the IndexedDB
 * implementation owns the storage record schemas, the Dexie migration,
 * atomic commit semantics, reload validation, and the reconciliation audit.
 *
 * Transactional guarantees (frozen):
 * - `promoteSeasonDraftToRun` commits the initial run checkpoint and removes
 *   the draft in one transaction; the draft is removed only after the run is
 *   valid, so a failed promotion leaves the draft intact.
 * - `commitSeasonBlock` commits summaries, retained details, aggregates,
 *   standings, cursor, revision, command id, recap, the M2.4 effects state,
 *   the M2.5 mutable run state (health, transactions, influence, trade,
 *   objectives, checkpointState, stateRevision, stateDigest), the mutated
 *   rosters/ownership/rotations/effects of an opened trade window (when the
 *   engine produced one), and the digests atomically: either every row
 *   commits or none does, so no partial block can ever be accepted. Any
 *   pending-block row for the run is deleted in the same transaction.
 * - `savePendingBlock`/`loadPendingBlock`/`discardPendingBlock` are
 *   single-row atomic ops for the interrupted-block candidate; saving is
 *   guarded so the cursor cannot have advanced past the pending's block.
 * - `applySeasonRunCommand` atomically applies an engine-produced between-
 *   block command result: it validates run identity and the command's
 *   expected state revision/digest against the stored row, rejects duplicate
 *   command ids, stores the engine-produced mutable run state (+ optional
 *   effects for trade chemistry), and stores or clears the pending row.
 * - A load validates the checkpoint and its rows, audits aggregate and
 *   effects-state reconciliation plus the M2.5 health/influence/transaction/
 *   state-chain/trade/pending facts, and resumes at the last accepted
 *   boundary; unfinished worker work is never persisted.
 * - M2.5: stored rows outside the current save-schema family (the v1-v3
 *   development rows) are never read or migrated; they surface through the
 *   typed incompatibility flow and are deleted only by explicit
 *   `clearSeasonRun(runId)`.
 */

/** Everything the block commit writes, in one transaction. */
export interface CommitSeasonBlockInput {
  runId: string;
  /** Accepted-block count after this commit. */
  revision: number;
  commandId: string;
  rotationDigest: string;
  checkpointDigest: string;
  /** Rounds completed at this boundary. */
  completedRounds: number;
  standings: SeasonStandings;
  /** Sorted by franchiseId ascending (30 rows). */
  teamAggregates: SeasonTeamAggregate[];
  /** Sorted by playerVersionId ascending (300 rows). */
  playerAggregates: SeasonPlayerAggregate[];
  /** Every game of this block (150, or 30 in the final block). */
  summaries: SeasonGameSummary[];
  /** Human-team games of this block (retained detail policy). */
  retainedDetails: SeasonRetainedGameDetail[];
  recap: SeasonBlockRecap;
  /**
   * The 30 rotations locked by this block. Persisted with the commit so a
   * reload resumes with the same locked set (the next block's lock digest
   * must derive from these rotations).
   */
  rotations: SeasonRotation[];
  /**
   * M2.4 authoritative post-block effects state (player load + pair
   * chemistry). Persisted with the block checkpoint in the same atomic
   * transaction; the reload audit reconciles it.
   */
  effects: SeasonEffectsState;
  /** M2.5: authoritative post-block health state (append-only injuries). */
  health: SeasonHealthState;
  /**
   * M2.5: post-block transaction log entries. When `window` is present the
   * window result's transactions supersede these (AI spends etc. append
   * after the block's grants).
   */
  transactions: SeasonTransactionEntry[];
  /**
   * M2.5: post-block Influence state. When `window` is present the window
   * result's influence supersedes this (AI spends fold in).
   */
  influence: SeasonInfluenceState;
  /**
   * M2.5: persisted trade-window state. The run's current `trade` state,
   * replaced by `window.trade` when a window opened at this commit.
   */
  trade: SeasonTradeState | null;
  /** M2.5: objective state (catalog + selections with this block's success). */
  objectives: SeasonObjectiveState;
  /** M2.5: accepted-checkpoint facts folded into the run (engine-produced). */
  checkpointState: SeasonCheckpointState;
  /** M2.5: run state chain position after this commit (engine-produced). */
  stateRevision: number;
  /** M2.5: canonical digest of the mutable run state (engine-produced). */
  stateDigest: string;
  /**
   * M2.5: the pre-block run state facts the submission asserted. The commit
   * rejects a stale submission (a command or another block advanced the
   * state chain since the candidate was assembled).
   */
  expectedStateRevision: number;
  expectedStateDigest: string;
  /**
   * M2.5: the trade-window open produced by the engine's
   * `completeSeasonBlockCommit` (null when the block did not open a window).
   * When present, the commit writes its mutated rosters/ownership/rotations/
   * effects/trade/influence/transactions/stateRevision/stateDigest.
   */
  window: SeasonWindowOpenResult | null;
}

/** Validated full view of the active run, assembled for the application. */
export interface SeasonRunSnapshot {
  /** Snapshot with reconstructed finalized game records (engine helper). */
  run: SeasonRun;
  /** Every accepted game summary, ordered by gameId ascending. */
  summaries: SeasonGameSummary[];
  /** Retained detail rows (human-team games only), ordered by gameId. */
  retainedDetails: SeasonRetainedGameDetail[];
  /** Accepted block history, ordered by revision ascending. */
  acceptedBlocks: SeasonAcceptedBlock[];
  /**
   * M2.4 authoritative effects state at the last accepted boundary
   * (audited on load; the worker start request's `priorEffects` for a
   * resumed block derives from this).
   */
  effects: SeasonEffectsState;
}

/**
 * Typed marker for a stored pre-minute-policy run (save-schema v1-v4
 * family). The discard screen consumes this to show the discard-and-restart
 * affordance; the legacy row stays untouched in IndexedDB until the user
 * confirms `clearSeasonRun(runId)`.
 */
export interface SeasonRunIncompatibleInfo {
  /** The current save-schema family (v5 since the minute-policy contract). */
  storedSaveSchemaVersion: typeof SEASON_RUN_SAVE_SCHEMA_VERSION;
  /** Run snapshot schema version recorded in the stored row. */
  storedRunSchemaVersion: number;
  /** Run id the discard screen passes to `clearSeasonRun(runId)`. */
  runId: string;
}

/** One between-block command application (M2.5, atomic). */
export interface SeasonRunCommandApplication {
  runId: string;
  /** The typed command whose expected state facts are validated. */
  command: SeasonRunCommand;
  /**
   * The engine-produced post-command run snapshot (schema 7). Its mutable
   * state (health, transactions, influence, trade, objectives,
   * checkpointState, stateRevision, stateDigest, rosters, ownership,
   * rotations) is stored atomically.
   */
  run: SeasonRun;
  /**
   * The engine-produced post-command effects state. Commands do not mutate
   * load facts, but accepted trades reset chemistry pairs, so trades must
   * carry the post-command effects; optional until the economy workstream's
   * command output ships it (omitted = stored effects unchanged).
   */
  effects?: SeasonEffectsState;
  /** The pending candidate after the command (null clears the pending row). */
  pending: SeasonPendingBlockCandidate | null;
}

/**
 * The engine rejected the command's expected state facts: its
 * `expectedStateRevision`/`expectedStateDigest` do not match the stored row.
 */
export class SeasonRunCommandStaleStateError extends Error {
  readonly commandId: string;
  readonly expectedStateRevision: number;
  readonly storedStateRevision: number;

  constructor(commandId: string, expectedStateRevision: number, storedStateRevision: number) {
    super(
      `season run command ${commandId} asserts stale state (expected revision ` +
        `${String(expectedStateRevision)}, stored ${String(storedStateRevision)})`,
    );
    this.name = 'SeasonRunCommandStaleStateError';
    this.commandId = commandId;
    this.expectedStateRevision = expectedStateRevision;
    this.storedStateRevision = storedStateRevision;
  }
}

/** The command id already appears in the run's recorded command history. */
export class SeasonRunCommandDuplicateError extends Error {
  readonly commandId: string;

  constructor(commandId: string) {
    super(`season run command ${commandId} was already applied`);
    this.name = 'SeasonRunCommandDuplicateError';
    this.commandId = commandId;
  }
}

/** The command names a run different from the stored active run. */
export class SeasonRunCommandRunMismatchError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`season run command targets run ${runId}, not the active run`);
    this.name = 'SeasonRunCommandRunMismatchError';
    this.runId = runId;
  }
}

/**
 * The pending block save was rejected because the run cursor already
 * advanced past the pending's block (or the run has no active checkpoint).
 */
export class SeasonPendingBlockRejectedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`pending block rejected: ${reason}`);
    this.name = 'SeasonPendingBlockRejectedError';
    this.reason = reason;
  }
}

export interface SeasonRunRepository {
  /** Lightweight active-run index for home and resume affordances. */
  loadActiveRunIndex(): Promise<SeasonActiveRunIndex | null>;
  /** Full validated snapshot; resumes at the last accepted boundary. */
  loadActiveRun(): Promise<SeasonRunSnapshot | null>;
  /** All summaries of one block (gameId ascending). */
  loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]>;
  /** Retained detail rows (gameId ascending). */
  loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]>;
  /** Accepted block history (revision ascending). */
  loadBlockHistory(runId: string): Promise<SeasonAcceptedBlock[]>;
  /** Atomic checkpoint commit (see contract above). */
  commitSeasonBlock(input: CommitSeasonBlockInput): Promise<void>;
  /** Atomic draft-to-run promotion (see contract above). */
  promoteSeasonDraftToRun(draft: StoredSeasonDraft, run: SeasonRun): Promise<void>;
  /** Removes the active run and all of its rows. */
  clearSeasonRun(runId: string): Promise<void>;
  /**
   * M2.5: persists the interrupted-block pending candidate (one atomic put,
   * runId-keyed). Guards: an active checkpoint must exist for the run and
   * its cursor must not have advanced past the pending's block — the
   * pending's `expectedRevision` must equal the stored revision and its
   * `expectedStateRevision`/`expectedStateDigest` must match the stored row
   * — otherwise the save is rejected (`SeasonPendingBlockRejectedError`) so
   * stale interrupted work can never resurrect a committed block.
   */
  savePendingBlock(
    pending: SeasonPendingBlockCandidate,
    interruption: SeasonInvalidRosterInterruption,
  ): Promise<void>;
  /** M2.5: loads the pending candidate (validated); null when absent. */
  loadPendingBlock(runId: string): Promise<SeasonPendingBlockCandidate | null>;
  /** M2.5: deletes the pending row (no-op when absent). */
  discardPendingBlock(runId: string): Promise<void>;
  /**
   * M2.5: atomically applies one between-block command result. Validates
   * run identity (command runId + input runId vs the stored row), the
   * command's expected state revision/digest against the stored row (typed
   * `SeasonRunCommandStaleStateError`), and commandId uniqueness against
   * the bounded recorded history (lastCommandId, checkpointState.commandId,
   * transaction/ledger/selection command ids; typed
   * `SeasonRunCommandDuplicateError`), then stores the engine-produced
   * mutable run state (+ optional effects) and the pending candidate (null
   * clears the pending row) in one transaction.
   */
  applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void>;
}

export type { SeasonCandidateCheckpoint, SeasonWindowOpenResult };
