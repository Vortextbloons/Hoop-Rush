import { z } from 'zod';
import {
  seasonAcceptedBlockSchema,
  seasonActiveRunIndexSchema,
  seasonBlockRecapSchema,
  seasonCheckpointDigestSchema,
  seasonCheckpointStateSchema,
  seasonEffectsStateSchema,
  seasonGameSummarySchema,
  seasonHealthStateSchema,
  seasonInfluenceStateSchema,
  seasonInvalidRosterInterruptionSchema,
  seasonObjectiveStateSchema,
  seasonPendingBlockCandidateSchema,
  seasonPlayerAggregateSchema,
  seasonRetainedGameDetailSchema,
  seasonRosterSchema,
  seasonRotationSchema,
  seasonRotationSetDigestSchema,
  seasonRunSchema,
  seasonStandingsSchema,
  seasonTeamAggregateSchema,
  seasonTradeStateSchema,
  seasonTransactionEntrySchema,
  seasonOwnershipSchema,
  SEASON_TEAM_COUNT,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schemas for the active Season Run (spec/2.0/07 persistence,
 * spec/2.0/10 M2.3, M2.4). One active run coexists with the Challenge and
 * Classic stores, isolated in the dedicated v6 tables. Every read and write
 * validates through these schemas at the storage boundary, so corrupt rows
 * surface instead of entering app state.
 *
 * ## Stored save schema versions
 *
 * - v4 (M2.5): the current and only read schema. The row wraps a schema-7
 *   run snapshot (which freezes the seven new M2.5 material versions) and,
 *   at row level, the authoritative mutable run state committed atomically
 *   with each block: the M2.4 effects state (`effects`), the M2.5 health
 *   state (`health`), the transaction log (`transactions`), the Influence
 *   economy (`influence`), the trade-window state (`trade`), the objective
 *   state (`objectives`), the accepted-checkpoint facts
 *   (`checkpointState`), and the run state chain (`stateRevision`,
 *   `stateDigest`).
 * - v3 (M2.4 schema-6 runs), v2 (M2.4 schema-5 runs) and v1 (M2.3 schema-4
 *   runs) are development rows: they are never read or migrated, and the
 *   repository reports them through the typed incompatibility flow. There
 *   is no recovery record; the discard-and-restart screen handles them.
 *
 * ## Why the checkpoint does not persist the 1,230 scheduled game records
 *
 * The frozen `SeasonRun` snapshot carries the full scheduled `games` array
 * (1,230 `SeasonGame` rows). Persisting that array is redundant: game
 * identity and matchups come from the immutable schedule artifact
 * (content-hashed in `run.schedule`), and completed results are already
 * recorded in the compact summary rows. The engine helper
 * `reconstructSeasonGames(schedule, summaries)` reassembles the full array on
 * load — scheduled games stay `scheduled`, finalized games take their
 * summary facts — so the snapshot's `.length(SEASON_GAME_COUNT)` contract
 * holds without duplicating 1,230 identity rows on every checkpoint write.
 * The stored row therefore keeps the entire frozen snapshot except `games`,
 * plus the authoritative current-boundary facts: standings, team/player
 * aggregates, recap, the M2.4 effects state, the M2.5 mutable run state, and
 * the cursor facts (completedRounds, revision, lastCommandId,
 * lastRotationDigest, lastCheckpointDigest).
 *
 * ## Why row-level mutable state exists next to `run`
 *
 * `run` is the promotion-time snapshot: its `standings`/`cursor` are the
 * initial (all-zero) values, and since schema 7 its `health`/`transactions`/
 * `influence`/`trade`/`objectives`/`checkpointState`/`stateRevision`/
 * `stateDigest` are the initial (empty/zero) values too. The row-level
 * `standings`, `teamAggregates`, `playerAggregates`, `recap`, `effects`,
 * `health`, `transactions`, `influence`, `trade`, `objectives`,
 * `checkpointState`, `stateRevision`, `stateDigest`, and cursor facts are
 * the block commit's NEW cumulative state and are authoritative on reload;
 * the reassembled snapshot overrides `run.standings`, `run.cursor`, and the
 * eight schema-7 run state fields with them.
 */

/** Single active Season Run slot; at most one row may exist. */
export const SEASON_RUN_RECORD_ID = 'season-run';

/**
 * The single stored Season Run checkpoint row (save schema v4, M2.5):
 * frozen snapshot minus the scheduled game records plus the authoritative
 * current-boundary facts, the effects state, and the M2.5 mutable run state.
 */
export const seasonRunRecordFieldsSchema = z.object({
  recordId: z.literal(SEASON_RUN_RECORD_ID),
  saveSchemaVersion: z.literal(4),
  /** Promotion-time snapshot; the 1,230 scheduled game records are omitted. */
  run: seasonRunSchema.omit({ games: true }),
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
  /**
   * Authoritative M2.4 effects state at the last accepted boundary: 300
   * player load states and 1,350 canonical pair chemistry states.
   */
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
 * `storedSeasonRunRecordSchema` parse is reserved for promotion and every
 * load (the authoritative corruption gate before state enters the app); the
 * commit path only needs the cursor facts it guards (runId, revision, last
 * command id, completed rounds, human franchise from the league) plus the
 * M2.5 mutable-state slice it validates and rewrites (health, transactions,
 * influence, trade, objectives, checkpointState, stateRevision,
 * stateDigest) and would otherwise re-validate the entire frozen snapshot on
 * every one of the nine block commits. A corrupt snapshot portion written by
 * a buggy commit is still caught by the next load.
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
     * The snapshot's roster/ownership/rotation slice. The commit rewrites
     * rotations (locked set) and, when a trade window opens, rosters and
     * ownership (moved players); the M2.5 state digest covers all three, so
     * the commit reads the current values to recompute the new digest.
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
 * it was written; the commit validates exactly the fields it writes (cursor
 * facts, standings, aggregates, recap, effects, the M2.5 mutable run state,
 * and the rosters/ownership/rotations slice of `run`), so the per-commit
 * cost stays inside the persistence budget without weakening the
 * corrupt-rows-throw guarantee (every load re-validates the complete stored
 * row).
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
     * commit and, when a trade window opened, the mutated rosters and
     * ownership. The rest of the snapshot is promotion-immutable; rewriting
     * exactly these slices keeps a reload aligned with the locked set and
     * the state digest.
     */
    run: z.object({
      rosters: z.array(seasonRosterSchema).length(SEASON_TEAM_COUNT),
      ownership: z.array(seasonOwnershipSchema).length(SEASON_TEAM_COUNT * 10),
      rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
    }),
    /**
     * Authoritative M2.4 effects state at this boundary (post-block player
     * load + pair chemistry), committed atomically with the block.
     */
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
 * by runId — at most one pending block per run). Stores the full uncommitted
 * `SeasonPendingBlockCandidate` plus the typed `invalid-roster` interruption
 * facts that produced it (the runner reconstructs the interruption from the
 * engine's availability facts at save time) and the row timestamp. The
 * pending row is deleted in the SAME transaction as the block commit and by
 * `discardPendingBlock`; a pending row for an already-committed blockIndex is
 * a reload-audit error.
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
