import { z } from 'zod';
import {
  seasonAcceptedBlockSchema,
  seasonActiveRunIndexSchema,
  seasonAlmanacSchema,
  seasonBlockRecapSchema,
  seasonCheckpointDigestSchema,
  seasonCheckpointStateSchema,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonEffectsStateSchema,
  seasonGameSummarySchema,
  seasonHealthStateSchema,
  seasonInfluenceStateSchema,
  seasonInvalidRosterInterruptionSchema,
  seasonObjectiveStateSchema,
  seasonPendingBlockCandidateSchema,
  seasonPlayerAggregateSchema,
  seasonPostseasonSummarySchema,
  seasonRetainedGameDetailSchema,
  seasonRosterSchema,
  seasonRotationSchema,
  seasonRotationSetDigestSchema,
  seasonRunCompletionSchema,
  seasonRunSchema,
  seasonRunStageSchema,
  seasonStandingsSchema,
  seasonTeamAggregateSchema,
  seasonTradeStateSchema,
  seasonTransactionEntrySchema,
  seasonOwnershipSchema,
  seasonAwardsSchema,
  seasonPostseasonStateSchema,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  SEASON_TEAM_COUNT,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schemas for the active Season Run (spec/2.0/07 persistence,
 * spec/2.0/10 M2.3, M2.4, M2.6). One active run coexists with the Challenge
 * and Classic stores, isolated in the dedicated v6 tables. Every read and
 * write validates through these schemas at the storage boundary, so corrupt
 * rows surface instead of entering app state.
 *
 * ## Stored save schema versions
 *
 * - v6 (M2.6): the current and only read schema. The row wraps a schema-9
 *   run snapshot (stage, postseason-v2 state, awards, completion, the
 *   extended version set) plus, at row level, the authoritative mutable run
 *   state committed atomically with each block (effects, health,
 *   transactions, influence, trade, objectives, checkpointState,
 *   stateRevision, stateDigest). M2.6 adds the append-only command log, the
 *   postseason summary rows, and the completed-season rows in the v8 Dexie
 *   tables.
 * - v5 (projection), v4 (M2.5), v3 (M2.4 schema-6), v2 (M2.4 schema-5),
 *   v1 (M2.3 schema-4) are development rows: never read or migrated;
 *   reported through the typed incompatibility flow and handled by the
 *   discard-and-restart screen.
 *
 * ## Why the checkpoint omits the 1,230 scheduled game records
 *
 * The frozen `SeasonRun` snapshot's full `games` array (1,230 rows) is
 * redundant: game identity and matchups come from the immutable schedule
 * artifact (content-hashed in `run.schedule`) and completed results are in
 * the compact summary rows. `reconstructSeasonGames(schedule, summaries)`
 * reassembles the full array on load, so the snapshot's `.length(SEASON_GAME_COUNT)`
 * contract holds without duplicating 1,230 identity rows per checkpoint write.
 *
 * ## Why row-level mutable state exists next to `run`
 *
 * `run` is the promotion-time snapshot (initial zero standings/cursor/state,
 * regular-season stage, postseason-v2 scaffold, null awards/completion); the
 * row-level mutable columns are the block commit's new cumulative state and
 * are authoritative on reload, overriding the snapshot's initial values.
 * M2.6 postseason advancement rewrites the `run` snapshot's
 * `stage`/`postseason`/`awards`/`completion` slice through the checkpoint
 * delta (they are authoritative on reload like the other mutable state).
 */

/** Single active Season Run slot; at most one row may exist. */
export const SEASON_RUN_RECORD_ID = 'season-run';

/**
 * The single stored Season Run checkpoint row (save schema v6, M2.6): frozen
 * snapshot minus the scheduled game records plus the authoritative
 * current-boundary facts, effects state, and M2.5 mutable run state.
 */
export const seasonRunRecordFieldsSchema = z.object({
  recordId: z.literal(SEASON_RUN_RECORD_ID),
  saveSchemaVersion: z.literal(SEASON_RUN_SAVE_SCHEMA_VERSION),
  /**
   * Promotion-time snapshot; the 1,230 scheduled game records are omitted.
   * `seasonRunSchema` carries cross-field refinements (M2.6 stage/completion
   * coupling), which zod forbids omitting from, so the storage wrapper is
   * built from the unrefined shape; the full refined schema validates the
   * reconstructed snapshot on every load.
   */
  run: z.object(seasonRunSchema.shape).omit({ games: true }),
  /** Rounds completed at the last accepted boundary. */
  completedRounds: z.number().int().min(0).max(82),
  /** Accepted-block count at the last accepted boundary. */
  revision: z.number().int().nonnegative(),
  /** Command id of the last accepted block; null before the first commit. */
  lastCommandId: z.string().min(1).max(64).nullable(),
  /** Digest of the 30 rotations locked for the last accepted block. */
  lastRotationDigest: seasonRotationSetDigestSchema.nullable(),
  /** Canonical digest of the last accepted checkpoint. */
  lastCheckpointDigest: seasonCheckpointDigestSchema.nullable(),
  /** Latest cumulative standings (block commit's new totals). */
  standings: seasonStandingsSchema,
  /** Latest cumulative team aggregates, sorted by franchiseId ascending. */
  teamAggregates: z.array(seasonTeamAggregateSchema).length(SEASON_TEAM_COUNT),
  /** Latest cumulative player aggregates, sorted by playerVersionId ascending. */
  playerAggregates: z.array(seasonPlayerAggregateSchema).length(SEASON_TEAM_COUNT * 10),
  /** Recap of the last accepted block; null while no block was accepted. */
  recap: seasonBlockRecapSchema.nullable(),
  /** M2.4 authoritative effects state (300 player loads, 1,350 pairs) at the last boundary. */
  effects: seasonEffectsStateSchema,
  /** M2.5: authoritative health state (append-only injury records). */
  health: seasonHealthStateSchema,
  /** M2.5: append-only run-scoped transaction log entries. */
  transactions: z.array(seasonTransactionEntrySchema),
  /** M2.5: Influence economy state (balances, ledger, windows, rehabs). */
  influence: seasonInfluenceStateSchema,
  /** M2.5: run-scoped trade-window state; null until the first window opens. */
  trade: seasonTradeStateSchema.nullable(),
  /** M2.5: objective state (fixed catalog + per-block selections). */
  objectives: seasonObjectiveStateSchema,
  /** M2.5: latest accepted checkpoint facts; null until the first commit. */
  checkpointState: seasonCheckpointStateSchema.nullable(),
  /** M2.5: run state chain position (bumps per commit and per command). */
  stateRevision: z.number().int().nonnegative(),
  /** M2.5: canonical digest of the mutable run state (self-excluded). */
  stateDigest: seasonCheckpointDigestSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});

/** The current stored Season Run checkpoint row (save schema v4). */
export const storedSeasonRunRecordSchema = seasonRunRecordFieldsSchema;
export type StoredSeasonRunRecord = z.infer<typeof storedSeasonRunRecordSchema>;

/**
 * Narrow read schema for the checkpoint inside `commitSeasonBlock`. The full
 * `storedSeasonRunRecordSchema` parse is reserved for promotion and every load
 * (the corruption gate); the commit path only needs the cursor facts it
 * guards plus the M2.5 mutable-state slice it rewrites, avoiding re-validating
 * the entire frozen snapshot on each of the nine block commits. A corrupt
 * snapshot portion is still caught by the next load.
 */
export const seasonRunCursorSchema = z.object({
  run: z.object({
    runId: z.string().min(1).max(64),
    league: z.object({
      teams: z.array(
        z.object({
          franchiseId: z.string().min(1).max(64),
          control: z.enum(['human', 'ai']),
        }),
      ),
    }),
    /**
     * The snapshot's roster/ownership/rotation slice, read here because the
     * commit rewrites them (locked rotations, window-moved players) and the
     * M2.5 state digest covers all three.
     */
    rosters: z.array(z.unknown()).optional(),
    ownership: z.array(z.unknown()).optional(),
    rotations: z.array(z.unknown()).optional(),
  }),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  lastCommandId: z.string().min(1).max(64).nullable(),
  /** M2.5 mutable-state slice the commit path validates against. */
  health: seasonHealthStateSchema,
  transactions: z.array(seasonTransactionEntrySchema),
  influence: seasonInfluenceStateSchema,
  trade: seasonTradeStateSchema.nullable(),
  objectives: seasonObjectiveStateSchema,
  checkpointState: seasonCheckpointStateSchema.nullable(),
  stateRevision: z.number().int().nonnegative(),
  stateDigest: seasonCheckpointDigestSchema,
});
export type SeasonRunCursor = z.infer<typeof seasonRunCursorSchema>;

/**
 * Narrow write schema for the checkpoint fields a block commit changes. The
 * `run` snapshot portion is promotion-immutable and was fully validated when
 * written; the commit validates exactly the fields it writes, so per-commit
 * cost stays inside the persistence budget without weakening the
 * corrupt-rows-throw guarantee (every load re-validates the full row).
 *
 * M2.6: the `run` slice additionally carries the postseason advancement
 * fields (`stage`, `postseason`, `awards`, `completion`), which postseason
 * advancement commits rewrite; they stay promotion-time values on fresh
 * runs.
 */
export const seasonRunCheckpointDeltaSchema = seasonRunRecordFieldsSchema
  .pick({
    completedRounds: true,
    revision: true,
    lastCommandId: true,
    lastRotationDigest: true,
    lastCheckpointDigest: true,
    standings: true,
    teamAggregates: true,
    playerAggregates: true,
    recap: true,
    health: true,
    transactions: true,
    influence: true,
    trade: true,
    objectives: true,
    checkpointState: true,
    stateRevision: true,
    stateDigest: true,
    updatedAtIso: true,
  })
  .extend({
    /**
     * The snapshot slices a commit rewrites: the 30 rotations locked by the
     * commit, the mutated rosters and ownership (trades), and the M2.6
     * postseason advancement fields (optional: present only on postseason
     * advancement commits, which rewrite `stage`/`postseason`/`awards`/
     * `completion`; a block commit leaves them at their snapshot values).
     */
    run: z.object({
      rosters: z.array(seasonRosterSchema).length(SEASON_TEAM_COUNT),
      ownership: z.array(seasonOwnershipSchema).length(SEASON_TEAM_COUNT * 10),
      rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
      stage: seasonRunStageSchema.optional(),
      postseason: seasonPostseasonStateSchema.optional(),
      awards: seasonAwardsSchema.nullable().optional(),
      completion: seasonRunCompletionSchema.nullable().optional(),
    }),
    /** M2.4 authoritative post-block effects state, committed with the block. */
    effects: seasonEffectsStateSchema,
  });
export type SeasonRunCheckpointDelta = z.infer<typeof seasonRunCheckpointDeltaSchema>;

/** Compact summary row: one completed league game per row. */
export const storedSeasonSummaryRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameId: z.string().regex(/^s[0-9]{6}$/),
  /** 0-based block that committed this game. */
  blockIndex: z.number().int().min(0).max(8),
  /** 1-based synchronized round (15 games per round). */
  round: z.number().int().min(1).max(82),
  /** The frozen compact summary (season-game-summary-v1). */
  summary: seasonGameSummarySchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonSummaryRow = z.infer<typeof storedSeasonSummaryRowSchema>;

/** Retained detail row: the full M2.2 result for one human-team game. */
export const storedSeasonDetailRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameId: z.string().regex(/^s[0-9]{6}$/),
  /** 1-based synchronized round of the retained game. */
  round: z.number().int().min(1).max(82),
  /** The frozen retained detail (season-game-summary-v1). */
  detail: seasonRetainedGameDetailSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonDetailRow = z.infer<typeof storedSeasonDetailRowSchema>;

/** Accepted block history row: one per accepted block, append-only. */
export const storedSeasonAcceptedBlockRowSchema = z.object({
  runId: z.string().min(1).max(64),
  /** 0-based block index (equals revision - 1). */
  blockIndex: z.number().int().min(0).max(8),
  /** The frozen accepted-block entry. */
  block: seasonAcceptedBlockSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonAcceptedBlockRow = z.infer<typeof storedSeasonAcceptedBlockRowSchema>;

/**
 * Active-run index row for home and resume affordances. The frozen
 * `SeasonActiveRunIndex` contract carries its own `updatedAtIso`, so no
 * row-level timestamp is added.
 */
export const storedSeasonActiveRunIndexSchema = z.object({
  recordId: z.literal(SEASON_RUN_RECORD_ID),
  index: seasonActiveRunIndexSchema,
});
export type StoredSeasonActiveRunIndex = z.infer<typeof storedSeasonActiveRunIndexSchema>;

/**
 * Interrupted-block pending row (M2.5, Dexie v7 `seasonPendingBlocks`, keyed
 * by runId — at most one per run). Stores the uncommitted
 * `SeasonPendingBlockCandidate` plus the typed `invalid-roster` interruption
 * that produced it. The pending row is deleted in the SAME transaction as
 * the block commit (and by `discardPendingBlock`); a pending row for an
 * already-committed blockIndex is a reload-audit error.
 */
export const storedSeasonPendingBlockRowSchema = z.object({
  /** Primary key; equals the pending candidate's runId. */
  runId: z.string().min(1).max(64),
  /** The frozen uncommitted pending candidate (season-block-v3). */
  block: seasonPendingBlockCandidateSchema,
  /** The typed interruption facts that produced this pending candidate. */
  interruption: seasonInvalidRosterInterruptionSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPendingBlockRow = z.infer<typeof storedSeasonPendingBlockRowSchema>;

// ---------------------------------------------------------------------------
// M2.6 postseason-foundations rows (Dexie v8, additive).
// ---------------------------------------------------------------------------

/**
 * One postseason game summary row (M2.6, `seasonPostseasonSummaries`, keyed
 * by [runId+gameId]). Separate from the regular-season summary rows so
 * regular-season statistics stay frozen for awards. `gameId` must equal the
 * summary's own game id; `phase` mirrors the summary for indexed queries.
 */
export const storedSeasonPostseasonSummaryRowSchema = z.object({
  runId: z.string().min(1).max(64),
  /** Stable `pi-...` or `po-...` postseason game id. */
  gameId: z.string().min(1).max(64),
  /** 'play-in' | 'playoffs' (mirrors the summary facts). */
  phase: z.enum(['play-in', 'playoffs']),
  /** The frozen compact postseason summary (postseason-summary-v1). */
  summary: seasonPostseasonSummarySchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPostseasonSummaryRow = z.infer<
  typeof storedSeasonPostseasonSummaryRowSchema
>;

/**
 * One accepted-command log row (M2.6, `seasonCommandLog`, keyed by
 * [runId+ordinal]). Append-only: ordinals are dense from 0, and a row whose
 * ordinal disagrees with its entry facts is a load-time corruption.
 */
export const storedSeasonCommandLogRowSchema = z.object({
  runId: z.string().min(1).max(64),
  /** Append ordinal; equals the entry's own ordinal. */
  ordinal: z.number().int().nonnegative(),
  /** The frozen accepted-command log entry (command-log-v1). */
  entry: seasonCommandLogEntrySchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonCommandLogRow = z.infer<typeof storedSeasonCommandLogRowSchema>;

/** Completed-season almanac row (M2.6, `seasonAlmanacs`, keyed by runId). */
export const storedSeasonAlmanacRowSchema = z.object({
  /** Primary key; equals the almanac's runId. */
  runId: z.string().min(1).max(64),
  /** The frozen almanac (almanac-v1). */
  almanac: seasonAlmanacSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonAlmanacRow = z.infer<typeof storedSeasonAlmanacRowSchema>;

/**
 * Completed-season run row (M2.6, `seasonCompletedRuns`, keyed by runId):
 * the final run snapshot (games array omitted, mirroring the checkpoint row)
 * promoted atomically with the almanac, command log, and history index.
 */
export const storedSeasonCompletedRunRowSchema = z.object({
  /** Primary key; equals the run's runId. */
  runId: z.string().min(1).max(64),
  /** Final schema-9 run snapshot (the 1,230 scheduled game records omitted). */
  run: z.object(seasonRunSchema.shape).omit({ games: true }),
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonCompletedRunRow = z.infer<typeof storedSeasonCompletedRunRowSchema>;

/**
 * Completed-season history index row (M2.6, `seasonCompletedIndex`, keyed by
 * recordId = runId). The champion and almanac digests are recorded facts;
 * `completedAtIso` is display metadata excluded from every digest.
 */
export const storedSeasonCompletedIndexSchema = z.object({
  /** Primary key; equals the completed run's runId. */
  recordId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  rootSeed: z.string().regex(/^[0-9a-f]{16,64}$/),
  humanFranchiseId: z.string().min(1).max(64),
  championFranchiseId: z.string().min(1).max(64),
  /** Canonical digest of the promoted almanac. */
  almanacDigest: seasonCheckpointDigestSchema,
  /** Canonical digest of the finalized command log. */
  commandLogDigest: seasonCheckpointDigestSchema,
  /** Written by the adapter, never by domain logic. */
  completedAtIso: z.iso.datetime(),
});
export type StoredSeasonCompletedIndex = z.infer<typeof storedSeasonCompletedIndexSchema>;

/** The complete loaded completed-season view (validated, assembled). */
export const seasonCompletedSeasonSchema = z.object({
  run: seasonRunSchema,
  almanac: seasonAlmanacSchema,
  commandLog: seasonCommandLogSchema,
  summaries: z.array(seasonGameSummarySchema),
  postseasonSummaries: z.array(seasonPostseasonSummarySchema),
});
export type SeasonCompletedSeason = z.infer<typeof seasonCompletedSeasonSchema>;
