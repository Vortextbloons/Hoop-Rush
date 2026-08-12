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
import type { SeasonRunPlayerSliceEntry } from '../schemas/season-run-record.ts';

/**
 * Season Run repository contract (spec/2.0/07 persistence, M2.3, M2.4, M2.5).
 * One active run coexists with the Challenge and Classic stores in dedicated
 * tables; the contract is frozen, and the IndexedDB implementation owns the
 * record schemas, migration, atomic commits, reload validation, and audit.
 *
 * Transactional guarantees (frozen): every block commit and draft promotion
 * is atomic (all rows commit or none, so no partial block is ever accepted);
 * the pending-block row is deleted in the same transaction as the commit it
 * supersedes; a load validates and audits all rows before resuming at the
 * last accepted boundary. Rows outside the current save-schema family (v1-v3
 * development rows) are never read or migrated; they surface through the
 * typed incompatibility flow and are deleted only by `clearSeasonRun(runId)`.
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
  /** The 30 rotations locked by this block; reload resumes with this set. */
  rotations: SeasonRotation[];
  /** M2.4 authoritative post-block effects state; the reload audit reconciles it. */
  effects: SeasonEffectsState;
  /** M2.5: authoritative post-block health state (append-only injuries). */
  health: SeasonHealthState;
  /**
   * M2.5: post-block transaction log entries; a window result's transactions
   * supersede these.
   */
  transactions: SeasonTransactionEntry[];
  /**
   * M2.5: post-block Influence state; a window result's influence supersedes
   * this.
   */
  influence: SeasonInfluenceState;
  /** M2.5: persisted trade-window state; replaced by `window.trade` when a window opened. */
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
   * M2.5: the pre-block run state facts the submission asserted, so a stale
   * candidate is rejected.
   */
  expectedStateRevision: number;
  expectedStateDigest: string;
  /**
   * M2.5: the trade-window open produced by `completeSeasonBlockCommit` (null
   * when none); its mutated rosters/ownership/rotations/effects/trade/
   * influence/transactions/stateRevision/stateDigest replace the block's.
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
  /** M2.4 authoritative effects state at the last accepted boundary (audited on load). */
  effects: SeasonEffectsState;
}

/**
 * Typed marker for a stored pre-minute-policy run (save-schema v1-v4 family);
 * the discard screen shows the discard-and-restart affordance and the legacy
 * row stays untouched until the user confirms `clearSeasonRun(runId)`.
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
   * The engine-produced post-command run snapshot (schema 7); its mutable
   * state is stored atomically.
   */
  run: SeasonRun;
  /**
   * The engine-produced post-command effects state. Commands do not mutate
   * load facts, but accepted trades reset chemistry pairs, so trades carry
   * the post-command effects; optional until the economy workstream ships it.
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
  promoteSeasonDraftToRun(
    draft: StoredSeasonDraft,
    run: SeasonRun,
    /**
     * Performance pass: the compact per-run player presentation slice,
     * persisted in the same atomic transaction (positions/ratings/stamina/
     * durability/identity for every roster player).
     */
    playerSlice?: SeasonRunPlayerSliceEntry[],
  ): Promise<void>;
  /** Removes the active run and all of its rows. */
  clearSeasonRun(runId: string): Promise<void>;
  /**
   * Recovery path for corrupt or unidentifiable saves: deletes the active
   * checkpoint, index, and every related row without validating runId.
   */
  forceClearActiveSeasonRun(): Promise<void>;
  /**
   * M2.5: persists the interrupted-block pending candidate (one atomic put,
   * runId-keyed). Requires an active checkpoint whose cursor has not advanced
   * past the pending's block (revision and expected state facts must match),
   * so stale interrupted work can never resurrect a committed block.
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
   * M2.5: atomically applies one between-block command result, validating run
   * identity, the command's expected state facts, and commandId uniqueness,
   * then stores the engine-produced mutable run state and pending candidate.
   */
  applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void>;
  /**
   * Performance pass: loads the compact per-run player presentation slice
   * (positions/ratings/stamina/durability/identity for roster players),
   * frozen at draft promotion and topped up after trades.
   */
  loadSeasonRunPlayerSlice(runId: string): Promise<SeasonRunPlayerSliceEntry[] | null>;
  /**
   * Performance pass: merges compact presentation entries into the stored
   * slice (idempotent, keyed by playerVersionId). The shell tops up roster
   * players that entered through a trade without rewriting the whole row.
   */
  upsertSeasonRunPlayerSlice(runId: string, entries: SeasonRunPlayerSliceEntry[]): Promise<void>;
}

export type { SeasonCandidateCheckpoint, SeasonWindowOpenResult, SeasonRunPlayerSliceEntry };
