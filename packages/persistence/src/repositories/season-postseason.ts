import type {
  SeasonAlmanac,
  SeasonCommandLog,
  SeasonCommandLogEntry,
  SeasonEffectsState,
  SeasonPostseasonSummary,
  SeasonReplayExport,
  SeasonRun,
  SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import type {
  SeasonCompletedRunIndexEntry,
  SeasonCompletedSeason,
  SeasonPostseasonDetail,
} from '../schemas/season-run-record.ts';

/**
 * Season Run postseason repository contract (spec/2.0/07 persistence, M2.6
 * postseason-foundations). Backs the postseason advancement commands, the
 * append-only accepted-command log, completed-season history, and replay
 * exports. The IndexedDB implementation owns the record schemas, atomic
 * commits, and validation.
 *
 * Transactional guarantees (frozen):
 * - `commitPostseasonAdvancement` is atomic: the run state chain position,
 *   the postseason summaries, the optional retained postseason details, and
 *   the command-log row commit in ONE transaction (all rows commit or none,
 *   so no partial advancement is ever accepted).
 * - `promoteChampionToCompleted` is one atomic transaction: save the final
 *   result, create the almanac, record the champion, finalize the command
 *   log, register completed history, and remove the active-run pointer.
 *   Any failure rolls the whole promotion back.
 * - Rejected commands are transient and never enter the authoritative
 *   command log.
 */

/** Everything one postseason advancement command commits, in one transaction. */
export interface CommitPostseasonAdvancementInput {
  runId: string;
  /** Engine-produced run state after the advance (schema 9, validated). */
  run: SeasonRun;
  /** New postseason summaries produced by the advance, in play order. */
  summaries: SeasonPostseasonSummary[];
  /**
   * Optional retained postseason game details produced by the advance
   * (the retained-detail analog for postseason games). Committed in the
   * SAME transaction as the run state, summaries, and command log.
   */
  details?: SeasonPostseasonDetail[];
  /**
   * The post-advance effects state the engine computed (the state digest
   * covers it; the engine attaches it to the command output run as an
   * extra property). Stored in the checkpoint row so the reload audit's
   * digest reconciliation holds; defaults to the stored checkpoint effects
   * for zero-transition advances (the M2.5 `applySeasonRunCommand` seam).
   */
  effects?: SeasonEffectsState;
  /** The typed command that produced the advance (validated + recorded). */
  command: SeasonRunCommand;
  /** The run state chain position the command asserted. */
  preStateRevision: number;
  preStateDigest: string;
  /** Canonical digest of the accepted result facts. */
  resultDigest: string;
  /** Game ids advanced by this command, in play order. */
  relatedGameIds: string[];
  /** Transaction ids produced by this command, in canonical order. */
  transactionIds: string[];
}

/** Everything the atomic champion promotion writes. */
export interface PromoteChampionInput {
  runId: string;
  /**
   * Final run snapshot with stage `completed` and completion state set
   * (engine-produced, schema 9).
   */
  run: SeasonRun;
  /** The promoted almanac (almanac-v1, validated). */
  almanac: SeasonAlmanac;
  /** The finalized command log (every accepted command, validated). */
  commandLog: SeasonCommandLog;
  /** The full postseason summary set, frozen in completed history. */
  postseasonSummaries: SeasonPostseasonSummary[];
}

/** The command log entry for one accepted command (validated). */
export type { SeasonCommandLogEntry };

/**
 * The promoted run asserted facts the promotion transaction requires: the
 * run is completed, the almanac agrees with the run, and the log digests
 * reconcile.
 */
export class SeasonPostseasonIntegrityError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`season postseason integrity failure: ${reason}`);
    this.name = 'SeasonPostseasonIntegrityError';
    this.reason = reason;
  }
}

export interface SeasonPostseasonRepository {
  /**
   * Atomically commits one postseason advancement: validates run identity
   * and the command's expected state facts, stores the engine-produced run
   * state (stage/postseason/awards/completion slice), the new postseason
   * summaries, the optional retained postseason details, and the
   * append-only command-log row — all in one transaction. A duplicate
   * commandId or ordinal is rejected without mutating anything.
   */
  commitPostseasonAdvancement(input: CommitPostseasonAdvancementInput): Promise<void>;
  /** Every postseason summary of the run, ordered by gameId ascending. */
  loadPostseasonSummaries(runId: string): Promise<SeasonPostseasonSummary[]>;
  /** One postseason summary by game id; null when absent. */
  loadPostseasonSummary(runId: string, gameId: string): Promise<SeasonPostseasonSummary | null>;
  /** Every retained postseason game detail of the run, ordered by gameId ascending. */
  loadPostseasonDetails(runId: string): Promise<SeasonPostseasonDetail[]>;
  /** The full append-only command log (entries in ordinal order); null when absent. */
  loadCommandLog(runId: string): Promise<SeasonCommandLog | null>;
  /**
   * Atomic champion promotion: save the final result, create the almanac,
   * record the champion, finalize the command log, register completed
   * history, and remove the active-run pointer — in ONE transaction. Any
   * failure rolls the promotion back completely.
   */
  promoteChampionToCompleted(input: PromoteChampionInput): Promise<void>;
  /** The full completed-season view (validated); null when absent. */
  loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null>;
  /**
   * Every completed-season history metadata entry, newest first (the
   * validated `seasonCompletedIndex` rows).
   */
  listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]>;
  /** Deletes a completed season and every row of its run. */
  deleteCompletedSeason(runId: string): Promise<void>;
  /** Builds a validated self-contained replay export of one postseason game. */
  buildReplayExport(runId: string, gameId: string): Promise<SeasonReplayExport | null>;
}

export type { SeasonCompletedSeason, SeasonCompletedRunIndexEntry, SeasonPostseasonDetail };
