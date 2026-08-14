import { z } from 'zod';
import {
  franchiseIdSchema,
  postseasonGameIdSchema,
  seasonAcceptedBlockSchema,
  seasonActiveRunIndexSchema,
  seasonAlmanacSchema,
  seasonBlockRecapSchema,
  seasonCheckpointDigestSchema,
  seasonCheckpointStateSchema,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonCompactInjuryEventSchema,
  seasonEffectsStateSchema,
  seasonGameSimulationResultSchema,
  seasonGameSummarySchema,
  seasonHealthStateSchema,
  seasonInfluenceStateSchema,
  seasonInvalidRosterInterruptionSchema,
  seasonObjectiveStateSchema,
  seasonPendingBlockCandidateSchema,
  seasonPlayerAggregateSchema,
  seasonPostseasonPhaseSchema,
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
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
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
 * - v7 (M2.6.5): the current and only read schema. The row wraps a schema-10
 *   run snapshot (rosters of 10-15 distinct versions, 300-450 ownership
 *   rows, the run-scoped free-agency state, the extended version set) plus,
 *   at row level, the authoritative mutable run state committed atomically
 *   with each block (effects, health, transactions, influence, trade,
 *   objectives, checkpointState, stateRevision, stateDigest). M2.6 adds the
 *   append-only command log, the postseason summary rows, the retained
 *   postseason detail rows, and the completed-season rows in the v8/v10
 *   Dexie tables.
 * - v6 (M2.6) through v1 (M2.3 schema-4) are development rows: never read
 *   or migrated; reported through the typed incompatibility flow and
 *   handled by the discard-and-restart screen.
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
 * The single stored Season Run checkpoint row (save schema v7, M2.6.5):
 * frozen snapshot minus the scheduled game records plus the authoritative
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
  /** Latest cumulative player aggregates, sorted by playerVersionId ascending (300-450 rows; M2.6.5). */
  playerAggregates: z
    .array(seasonPlayerAggregateSchema)
    .min(SEASON_TEAM_COUNT * SEASON_ROSTER_MIN_SIZE)
    .max(SEASON_TEAM_COUNT * SEASON_ROSTER_MAX_SIZE),
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
 * One retained postseason game detail (M2.6, `seasonPostseasonDetails`,
 * persistence-level): the retained-detail analog for postseason games. The
 * regular-season retained rows key `s...`-prefixed game ids; postseason game
 * ids (`pi-...`/`po-...`) do not validate against
 * `seasonRetainedGameDetailSchema`, so the payload reuses the same
 * data-contract building blocks — the full `seasonGameSimulationResultSchema`
 * result plus the compact `injuryEvents` rollup — wrapped with the postseason
 * game identity (phase + matchup). A persistence-level structural type; no
 * data-contract schema exists for it (the engine hands the raw result and
 * injury rollup to the worker).
 */
export const seasonPostseasonDetailSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(64),
  /** Stable `pi-...` or `po-...` postseason game id. */
  gameId: postseasonGameIdSchema,
  /** 'play-in' | 'playoffs' (mirrors the game's phase). */
  phase: seasonPostseasonPhaseSchema,
  homeFranchiseId: franchiseIdSchema,
  awayFranchiseId: franchiseIdSchema,
  /** The full M2.2 result: substitutions, stints, deviations, diagnostics. */
  result: seasonGameSimulationResultSchema,
  /** Compact injury-event rollup for display (empty when none). */
  injuryEvents: z.array(seasonCompactInjuryEventSchema),
});
export type SeasonPostseasonDetail = z.infer<typeof seasonPostseasonDetailSchema>;

/**
 * One retained postseason game detail row (M2.6, `seasonPostseasonDetails`,
 * keyed by [runId+gameId]). Separate from the regular-season detail rows so
 * postseason details are keyed by their own game-id space. `gameId` must equal
 * the detail's own game id; `phase` mirrors the detail for indexed queries.
 */
export const storedSeasonPostseasonDetailRowSchema = z.object({
  runId: z.string().min(1).max(64),
  /** Stable `pi-...` or `po-...` postseason game id. */
  gameId: z.string().min(1).max(64),
  /** 'play-in' | 'playoffs' (mirrors the detail facts). */
  phase: z.enum(['play-in', 'playoffs']),
  /** The retained postseason game detail. */
  detail: seasonPostseasonDetailSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPostseasonDetailRow = z.infer<typeof storedSeasonPostseasonDetailRowSchema>;

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

/**
 * One completed-history metadata entry as returned by
 * `listCompletedSeasonRuns` (the validated `seasonCompletedIndex` row; its
 * `recordId` equals the completed run's runId).
 */
export type SeasonCompletedRunIndexEntry = StoredSeasonCompletedIndex;

/** The complete loaded completed-season view (validated, assembled). */
export const seasonCompletedSeasonSchema = z.object({
  run: seasonRunSchema,
  almanac: seasonAlmanacSchema,
  commandLog: seasonCommandLogSchema,
  summaries: z.array(seasonGameSummarySchema),
  postseasonSummaries: z.array(seasonPostseasonSummarySchema),
});
export type SeasonCompletedSeason = z.infer<typeof seasonCompletedSeasonSchema>;

// ---------------------------------------------------------------------------
// Performance pass: the compact per-run player presentation slice (Dexie v9).
// ---------------------------------------------------------------------------

/**
 * One compact per-player row of the run's presentation slice. Everything the
 * rotation editor, team page, lock preview, and leader/roster views read from
 * the full packaged draft catalog for a roster player, frozen at draft
 * promotion (and topped up when a trade moves a catalog player into a
 * roster). The full catalog stays inside the simulation worker and behind the
 * lazy trade-only path; the shell renders from this slice alone.
 */
export const seasonRunPlayerSliceEntrySchema = z.object({
  playerVersionId: z.string().min(1).max(64),
  /** Identity tuple for the players-index face join (mirrors roster entry). */
  playerId: z.string().min(1).max(64),
  franchiseId: z.string().min(1).max(64),
  eraId: z.string().min(1).max(64),
  seasonKey: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  /** The candidate's reviewed playable detailed positions. */
  positionsPlayable: z.array(z.string().min(1).max(2)).min(1).max(5),
  /** Build-time summary ratings (overall/offense/defense). */
  summaryRatings: z.object({
    overallRating: z.number().int().min(0).max(100),
    offenseRating: z.number().int().min(0).max(100),
    defenseRating: z.number().int().min(0).max(100),
  }),
  /** Build-time stamina rating (45..95; 70 when unknown). */
  staminaRating: z.number().int().min(0).max(100),
  /** Build-time durability rating (45..95; 70 when unknown). */
  durabilityRating: z.number().int().min(0).max(100),
});
export type SeasonRunPlayerSliceEntry = z.infer<typeof seasonRunPlayerSliceEntrySchema>;

/**
 * The stored compact slice row (Dexie v9 `seasonRunPlayerSlices`, keyed by
 * runId — at most one per run). Written atomically with draft promotion and
 * topped up after trades; deleted by the same lifecycle paths as every other
 * run-scoped row.
 */
export const storedSeasonPlayerSliceRowSchema = z.object({
  /** Primary key; equals the run's runId. */
  runId: z.string().min(1).max(64),
  /** Compact presentation facts, keyed by playerVersionId (unique). */
  players: z.array(seasonRunPlayerSliceEntrySchema).min(1),
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPlayerSliceRow = z.infer<typeof storedSeasonPlayerSliceRowSchema>;
