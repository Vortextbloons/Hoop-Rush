import { z } from 'zod';
import {
  seasonAcceptedBlockSchema,
  seasonActiveRunIndexSchema,
  seasonBlockRecapSchema,
  seasonCheckpointDigestSchema,
  seasonGameSummarySchema,
  seasonPlayerAggregateSchema,
  seasonRetainedGameDetailSchema,
  seasonRotationSchema,
  seasonRotationSetDigestSchema,
  seasonRunSchema,
  seasonStandingsSchema,
  seasonTeamAggregateSchema,
  SEASON_TEAM_COUNT,
} from '@hoop-rush/data-contracts';

/**
 * Stored-record schemas for the active Season Run (spec/2.0/07 persistence,
 * spec/2.0/10 M2.3). One active run coexists with the Challenge and Classic
 * stores, isolated in the dedicated v6 tables. Every read and write validates
 * through these schemas at the storage boundary, so corrupt rows surface
 * instead of entering app state.
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
 * aggregates, recap, and the cursor facts (completedRounds, revision,
 * lastCommandId, lastRotationDigest, lastCheckpointDigest).
 *
 * ## Why row-level standings/aggregates/recap exist next to `run`
 *
 * `run` is the promotion-time snapshot: its `standings`/`cursor` are the
 * initial (all-zero) values. The row-level `standings`, `teamAggregates`,
 * `playerAggregates`, `recap`, and cursor facts are the block commit's NEW
 * cumulative state and are authoritative on reload; the reassembled snapshot
 * overrides `run.standings` and `run.cursor` with them.
 */

/** Single active Season Run slot; at most one row may exist. */
export const SEASON_RUN_RECORD_ID = 'season-run';

/** Stored checkpoint row: frozen snapshot minus scheduled game records. */
export const storedSeasonRunRecordSchema = z.object({
  recordId: z.literal(SEASON_RUN_RECORD_ID),
  saveSchemaVersion: z.literal(1),
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
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonRunRecord = z.infer<typeof storedSeasonRunRecordSchema>;

/**
 * Narrow read schema for the checkpoint inside `commitSeasonBlock`. The full
 * `storedSeasonRunRecordSchema` parse is reserved for promotion and every
 * load (the authoritative corruption gate before state enters the app); the
 * commit path only needs the cursor facts it guards (runId, revision, last
 * command id, completed rounds, human franchise from the league) and would
 * otherwise re-validate the entire frozen snapshot on every one of the nine
 * block commits. A corrupt snapshot portion written by a buggy commit is
 * still caught by the next load.
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
  }),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  lastCommandId: z.string().min(1).max(64).nullable(),
});
export type SeasonRunCursor = z.infer<typeof seasonRunCursorSchema>;

/**
 * Narrow write schema for the checkpoint fields a block commit changes. The
 * `run` snapshot portion is promotion-immutable and was fully validated when
 * it was written; the commit validates exactly the fields it writes (cursor
 * facts, standings, aggregates, recap), so the per-commit cost stays inside
 * the persistence budget without weakening the corrupt-rows-throw guarantee
 * (every load re-validates the complete stored row).
 */
export const seasonRunCheckpointDeltaSchema = storedSeasonRunRecordSchema
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
    updatedAtIso: true,
  })
  .extend({
    /**
     * The 30 rotations locked by the commit. The rest of the snapshot is
     * promotion-immutable; the commit rewrites exactly this slice of `run`
     * so a reload resumes with the same locked set.
     */
    run: z.object({
      rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
    }),
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
