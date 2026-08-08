import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema, seasonGameIdSchema } from './ids.ts';
import { seasonCheckpointDigestSchema, seasonRotationSetDigestSchema } from './season-digests.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonPlayerAggregateSchema, seasonTeamAggregateSchema } from './season-aggregates.ts';
import { seasonGameSummarySchema, seasonRetainedGameDetailSchema } from './season-game-summary.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_BLOCK_VERSION } from './season-versions.ts';

/**
 * M2.5 block interruption and resume contracts (spec/2.0 M2.5). When the
 * human franchise cannot field a legal five at a tipoff from health
 * availability, the block stops with a typed `invalid-roster` interruption
 * and an uncommitted pending candidate is produced. The accepted run cursor
 * does NOT advance; the pending candidate is persisted (one row per run)
 * and resume simulates from `nextGameId` forward before committing
 * atomically. Cancel/reload/interruption never duplicates summaries,
 * transactions, ledger entries, or ownership transfers (commandId dedupe +
 * single pending row per run).
 */

/**
 * Typed invalid-roster interruption. `nextGameId` is the game the block
 * stopped at; `unavailablePlayerVersionIds` lists the human roster players
 * unavailable at that tipoff from health availability (inactive injuries
 * with missed games remaining).
 */
export const seasonInvalidRosterInterruptionSchema = z.object({
  code: z.literal('invalid-roster'),
  runId: idSchema,
  blockIndex: z.number().int().min(0).max(8),
  commandId: commandIdSchema,
  nextGameId: seasonGameIdSchema,
  humanFranchiseId: franchiseIdSchema,
  unavailablePlayerVersionIds: z.array(playerVersionIdSchema).min(1),
});
export type SeasonInvalidRosterInterruption = z.infer<typeof seasonInvalidRosterInterruptionSchema>;

/**
 * The uncommitted block candidate persisted on interruption (schema 1,
 * season-block-v3). `summaries` and `retainedDetails` hold only the games
 * completed so far in this block; `standings` is the fold of those games
 * over the prior blocks; `teamAggregates`/`playerAggregates` are the partial
 * folds (0-30 / 0-300 rows). `expectedRevision` is the accepted-block count
 * at submission; `expectedStateRevision`/`expectedStateDigest` are the run
 * state facts the command asserted; `health` is the health state entering
 * `nextGameId`.
 */
export const seasonPendingBlockCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  blockVersion: z.literal(SEASON_BLOCK_VERSION),
  runId: idSchema,
  commandId: commandIdSchema,
  blockIndex: z.number().int().min(0).max(8),
  expectedRevision: z.number().int().nonnegative(),
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  objectiveId: seasonObjectiveIdSchema.nullable(),
  nextGameId: seasonGameIdSchema,
  /** Completed games so far in this block, in block game order. */
  summaries: z.array(seasonGameSummarySchema).max(150),
  /** Completed human-team games so far in this block. */
  retainedDetails: z.array(seasonRetainedGameDetailSchema).max(10),
  /** Effects state entering the next game (loads + pair chemistry). */
  effects: seasonEffectsStateSchema,
  /** Health state entering the next game (append-only injury records). */
  health: seasonHealthStateSchema,
  /** Fold of completed block games over prior blocks. */
  standings: seasonStandingsSchema,
  /** Partial fold, sorted by franchiseId ascending (0-30 rows). */
  teamAggregates: z.array(seasonTeamAggregateSchema).max(30),
  /** Partial fold, sorted by playerVersionId ascending (0-300 rows). */
  playerAggregates: z.array(seasonPlayerAggregateSchema).max(300),
  rotationDigest: seasonRotationSetDigestSchema,
});
export type SeasonPendingBlockCandidate = z.infer<typeof seasonPendingBlockCandidateSchema>;
