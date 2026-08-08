import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonGameSummarySchema, seasonRetainedGameDetailSchema } from './season-game-summary.ts';
import { seasonPlayerAggregateSchema, seasonTeamAggregateSchema } from './season-aggregates.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonBlockRecapSchema } from './season-recap.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonInfluenceStateSchema } from './season-influence.ts';
import { seasonObjectiveEvaluationSchema, seasonObjectiveIdSchema } from './season-objective.ts';
import { seasonTransactionEntrySchema } from './season-transactions.ts';
import {
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_LEGACY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_LEGACY_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
} from './season-versions.ts';

/**
 * Season Run candidate checkpoints and accepted-block history (spec/2.0/07
 * persistence, M2.5, season-checkpoint-v3). One block pipeline run returns
 * one candidate checkpoint; the application layer validates it, computes the
 * canonical digest, and commits it atomically or discards it. v3 (M2.5) adds
 * the authoritative post-block health, influence, and transaction facts plus
 * the locked objective evaluation, and ties the checkpoint to the mutable
 * run-state chain through `expectedStateRevision`/`expectedStateDigest`
 * (asserted pre-block) and `stateRevision`/`stateDigest` (computed
 * post-assembly). v2 (M2.4) added the frozen effects state (300 player loads
 * + 1,350 pair chemistries) to the candidate. The digest is a pure function
 * of recorded facts (see module docstring), so every execution path —
 * uninterrupted, cancelled/retried, terminated/reloaded, single worker, or
 * CLI — produces the same digest for the same cursor.
 */

/** Material versions that participate in block output and the digest. */
export const seasonCheckpointVersionsSchema = z.object({
  blockVersion: z.literal(SEASON_BLOCK_VERSION),
  summaryVersion: z.literal(SEASON_GAME_SUMMARY_VERSION),
  aggregatesVersion: z.literal(SEASON_AGGREGATES_VERSION),
  recapVersion: z.literal(SEASON_RECAP_VERSION),
  leadersVersion: z.literal(SEASON_LEADERS_VERSION),
  homeCourtVersion: z.literal(SEASON_HOME_COURT_VERSION),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  seedDerivationVersion: z.literal(SEASON_SEED_DERIVATION_VERSION),
  /** M2.4: stamina profile derivation (v2 since the fatigue model rebalance). */
  staminaVersion: z.union([
    z.literal(SEASON_STAMINA_VERSION),
    z.literal(SEASON_STAMINA_LEGACY_VERSION),
  ]),
  /** M2.4: pair chemistry state rules. */
  chemistryVersion: z.literal(SEASON_CHEMISTRY_VERSION),
  /** M2.4: frozen effect-size calibration targets (v2 since the cap rebalance). */
  effectsTargetsVersion: z.union([
    z.literal(SEASON_EFFECT_TARGETS_VERSION),
    z.literal(SEASON_EFFECT_TARGETS_LEGACY_VERSION),
  ]),
  /** M2.5: injury and health state rules (season-health-v1). */
  healthVersion: z.literal(SEASON_HEALTH_VERSION),
  /** M2.5: trade contract (season-trade-v1). */
  tradeVersion: z.literal(SEASON_TRADE_VERSION),
  /** M2.5: Influence economy (season-influence-v1). */
  influenceVersion: z.literal(SEASON_INFLUENCE_VERSION),
  /** M2.5: block objectives (season-objective-v1). */
  objectiveVersion: z.literal(SEASON_OBJECTIVE_VERSION),
  /** M2.5: frozen injury calibration targets (injury-targets-v1). */
  injuryTargetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),
  /** M2.5: frozen trade calibration targets (trade-targets-v1). */
  tradeTargetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
  /** M2.5: frozen Influence calibration targets (influence-targets-v1). */
  influenceTargetsVersion: z.literal(SEASON_INFLUENCE_TARGETS_VERSION),
});
export type SeasonCheckpointVersions = z.infer<typeof seasonCheckpointVersionsSchema>;

/** 32-hex canonical checkpoint digest (engine season/checkpoint). */
export const seasonCheckpointDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SeasonCheckpointDigest = z.infer<typeof seasonCheckpointDigestSchema>;

/** 32-hex canonical digest of the locked 30-rotation set (engine season/rotation). */
export const seasonRotationSetDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SeasonRotationSetDigest = z.infer<typeof seasonRotationSetDigestSchema>;

/**
 * One candidate block output. `gameSummaries` holds every completed game of
 * the block (150 in blocks 0-7, 30 in block 8), `retainedDetails` only the
 * human-team games of the block. Standing rows and aggregate arrays are
 * canonically sorted. `digest` is computed by the engine over the canonical
 * serialization of all other fields; the application accepts the checkpoint
 * only when the digest verifies and the audit passes. M2.5 (v3): the
 * candidate freezes the post-block `health`, `influence`, and
 * `transactions` facts (health injuries sorted by injuryId, transactions by
 * transactionId, ledger by entryId), the locked objective evaluated from
 * saved facts, and the run-state chain facts — `expected*` asserted
 * pre-block, `stateRevision`/`stateDigest` computed post-assembly.
 */
export const seasonCandidateCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  checkpointVersion: z.literal(SEASON_CHECKPOINT_VERSION),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  versions: seasonCheckpointVersionsSchema,
  /** 0-based block index of this checkpoint. */
  blockIndex: z.number().int().min(0).max(8),
  /** Rounds completed at this checkpoint (10, 20, ..., 82). */
  completedRounds: z.number().int().min(0).max(82),
  /** Accepted-block count before this block; the expected cursor value. */
  revision: z.number().int().nonnegative(),
  /** Canonical digest of the 30 rotations locked for this block. */
  rotationDigest: seasonRotationSetDigestSchema,
  standings: seasonStandingsSchema,
  /** Sorted by franchiseId ascending (30 rows). */
  teamAggregates: z.array(seasonTeamAggregateSchema).length(30),
  /** Sorted by playerVersionId ascending (300 rows). */
  playerAggregates: z.array(seasonPlayerAggregateSchema).length(300),
  gameSummaries: z.array(seasonGameSummarySchema).min(1).max(150),
  retainedDetails: z.array(seasonRetainedGameDetailSchema).max(10),
  recap: seasonBlockRecapSchema,
  /** M2.4: frozen effects state at this checkpoint (300 loads, 1,350 pairs). */
  effects: seasonEffectsStateSchema,
  /** M2.5: authoritative post-block health state (frozen in the digest). */
  health: seasonHealthStateSchema,
  /** M2.5: post-block Influence state (includes this block's grants). */
  influence: seasonInfluenceStateSchema,
  /** M2.5: post-block transaction entries (grants etc.), append-only. */
  transactions: z.array(seasonTransactionEntrySchema),
  /**
   * M2.5: the locked objective evaluated at assembly from saved facts only;
   * null objective for the final two-game block 8.
   */
  objective: z.object({
    objectiveId: seasonObjectiveIdSchema.nullable(),
    success: z.boolean().nullable(),
    evaluation: seasonObjectiveEvaluationSchema,
  }),
  /** M2.5: the pre-block run state facts the command asserted (validated at commit). */
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  /** M2.5: the post-block run state facts (computed by the engine post-assembly). */
  stateRevision: z.number().int().nonnegative(),
  stateDigest: seasonCheckpointDigestSchema,
  digest: seasonCheckpointDigestSchema,
});
export type SeasonCandidateCheckpoint = z.infer<typeof seasonCandidateCheckpointSchema>;

/** One accepted block in the run's append-only history. */
export const seasonAcceptedBlockSchema = z.object({
  runId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  commandId: z.string().min(1).max(64),
  rotationDigest: seasonRotationSetDigestSchema,
  checkpointDigest: seasonCheckpointDigestSchema,
  summaryCount: z.number().int().min(1).max(150),
  /** M2.5: run state chain facts tied to this accepted block. */
  stateRevision: z.number().int().nonnegative(),
  stateDigest: seasonCheckpointDigestSchema,
});
export type SeasonAcceptedBlock = z.infer<typeof seasonAcceptedBlockSchema>;

/**
 * The accepted-checkpoint state folded into the run snapshot (M2.5): the
 * latest committed block facts and its run state chain position. Null on a
 * run until the first block commits.
 */
export const seasonCheckpointStateSchema = z.object({
  runId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  commandId: z.string().min(1).max(64),
  rotationDigest: seasonRotationSetDigestSchema,
  checkpointDigest: seasonCheckpointDigestSchema,
});
export type SeasonCheckpointState = z.infer<typeof seasonCheckpointStateSchema>;

/** Lightweight active-run index for home and resume affordances. */
export const seasonActiveRunIndexSchema = z.object({
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  humanFranchiseId: franchiseIdSchema,
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  humanWins: z.number().int().nonnegative(),
  humanLosses: z.number().int().nonnegative(),
  updatedAtIso: z.string(),
});
export type SeasonActiveRunIndex = z.infer<typeof seasonActiveRunIndexSchema>;
