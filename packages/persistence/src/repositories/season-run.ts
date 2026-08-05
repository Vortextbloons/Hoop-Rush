import type {
  SeasonAcceptedBlock,
  SeasonActiveRunIndex,
  SeasonBlockRecap,
  SeasonCandidateCheckpoint,
  SeasonGameSummary,
  SeasonRetainedGameDetail,
  SeasonRotation,
  SeasonRun,
  SeasonStandings,
  SeasonTeamAggregate,
  SeasonPlayerAggregate,
} from '@hoop-rush/data-contracts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';

/**
 * Season Run repository contract (spec/2.0/07 persistence, M2.3). One active
 * Season Run coexists with the Challenge and Classic stores, isolated in
 * dedicated tables. The contract is frozen; the IndexedDB implementation
 * owns the storage record schemas, the Dexie migration, atomic commit
 * semantics, reload validation, and the aggregate reconciliation audit.
 *
 * Transactional guarantees (frozen):
 * - `promoteSeasonDraftToRun` commits the initial run checkpoint and removes
 *   the draft in one transaction; the draft is removed only after the run is
 *   valid, so a failed promotion leaves the draft intact.
 * - `commitSeasonBlock` commits summaries, retained details, aggregates,
 *   standings, cursor, revision, command id, recap, and digest atomically:
 *   either every row commits or none does, so no partial block can ever be
 *   accepted.
 * - A load validates the checkpoint and its rows, audits aggregate
 *   reconciliation, and resumes at the last accepted boundary; unfinished
 *   worker work is never persisted.
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
}

export type { SeasonCandidateCheckpoint };
