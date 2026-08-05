import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonGameSummarySchema, seasonRetainedGameDetailSchema } from './season-game-summary.ts';
import { seasonPlayerAggregateSchema, seasonTeamAggregateSchema } from './season-aggregates.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonBlockRecapSchema } from './season-recap.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import {
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
} from './season-versions.ts';

/**
 * Season Run candidate checkpoints and accepted-block history (spec/2.0/07
 * persistence, M2.4, season-checkpoint-v2). One block pipeline run returns
 * one candidate checkpoint; the application layer validates it, computes the
 * canonical digest, and commits it atomically or discards it. v2 adds the
 * frozen effects state (300 player loads + 1,350 pair chemistries) to the
 * candidate. The digest is a pure function of recorded facts (see module
 * docstring), so every execution path — uninterrupted, cancelled/retried,
 * terminated/reloaded, single worker, or CLI — produces the same digest for
 * the same cursor.
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
  /** M2.4: stamina profile derivation. */
  staminaVersion: z.literal(SEASON_STAMINA_VERSION),
  /** M2.4: pair chemistry state rules. */
  chemistryVersion: z.literal(SEASON_CHEMISTRY_VERSION),
  /** M2.4: frozen effect-size calibration targets. */
  effectsTargetsVersion: z.literal(SEASON_EFFECT_TARGETS_VERSION),
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
 * only when the digest verifies and the audit passes.
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
});
export type SeasonAcceptedBlock = z.infer<typeof seasonAcceptedBlockSchema>;

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
