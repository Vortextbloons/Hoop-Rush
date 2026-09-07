import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema, seasonRotationSetDigestSchema } from './season-digests.ts';
import { seasonGameSummarySchema, seasonRetainedGameDetailSchema } from './season-game-summary.ts';
import { seasonPlayerAggregateSchema, seasonTeamAggregateSchema } from './season-aggregates.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonBlockRecapSchema } from './season-recap.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonInfluenceStateSchema } from './season-influence.ts';
import { seasonObjectiveEvaluationSchema, seasonObjectiveIdSchema } from './season-objective.ts';
import { seasonCampaignEvaluationSchema } from './season-campaign.ts';
import {
  seasonBlockChallengeEvaluationSchema,
  seasonChallengeIdSchema,
} from './season-challenge.ts';
import { seasonTransactionEntrySchema } from './season-transactions.ts';
import { seasonFreeAgencyStateSchema } from './season-free-agency.ts';
import {
  SEASON_AGGREGATES_LEGACY_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_BLOCK_VERSION_V5,
  SEASON_BLOCK_VERSION_V6,
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_CAMPAIGN_VERSION_V1,
  SEASON_CAMPAIGN_VERSION_V2,
  SEASON_CHALLENGE_TARGETS_VERSION,
  SEASON_CHALLENGE_VERSION,
  SEASON_CHALLENGE_VERSION_V1,
  SEASON_CHALLENGE_VERSION_V2,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHECKPOINT_VERSION_V5,
  SEASON_CHECKPOINT_VERSION_V6,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_LEGACY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION_V1,
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  SEASON_FREE_AGENCY_TARGETS_VERSION_V1,
  SEASON_FREE_AGENCY_VERSION,
  SEASON_FREE_AGENCY_VERSION_V1,
  SEASON_FREE_AGENCY_VERSION_V2,
  SEASON_GAME_SUMMARY_LEGACY_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION_V1,
  SEASON_INFLUENCE_TARGETS_VERSION_V2,
  SEASON_INFLUENCE_VERSION,
  SEASON_INFLUENCE_VERSION_V1,
  SEASON_INFLUENCE_VERSION_V2,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_OBJECTIVE_VERSION_V1,
  SEASON_OBJECTIVE_VERSION_V2,
  SEASON_RECAP_VERSION,
  SEASON_RECAP_VERSION_V5,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_LEGACY_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  SEASON_TRADE_VERSION_V6,
} from './season-versions.ts';
export const seasonCheckpointVersionsSchema = z.object({
  blockVersion: z.union([
    z.literal(SEASON_BLOCK_VERSION),
    z.literal(SEASON_BLOCK_VERSION_V6),
    z.literal(SEASON_BLOCK_VERSION_V5),
  ]),
  summaryVersion: z.union([
    z.literal(SEASON_GAME_SUMMARY_VERSION),
    z.literal(SEASON_GAME_SUMMARY_LEGACY_VERSION),
  ]),
  aggregatesVersion: z.union([
    z.literal(SEASON_AGGREGATES_VERSION),
    z.literal(SEASON_AGGREGATES_LEGACY_VERSION),
  ]),
  recapVersion: z.union([z.literal(SEASON_RECAP_VERSION), z.literal(SEASON_RECAP_VERSION_V5)]),
  leadersVersion: z.literal(SEASON_LEADERS_VERSION),
  homeCourtVersion: z.literal(SEASON_HOME_COURT_VERSION),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  seedDerivationVersion: z.literal(SEASON_SEED_DERIVATION_VERSION),
  staminaVersion: z.union([
    z.literal(SEASON_STAMINA_VERSION),
    z.literal(SEASON_STAMINA_LEGACY_VERSION),
  ]),
  chemistryVersion: z.literal(SEASON_CHEMISTRY_VERSION),
  effectsTargetsVersion: z.union([
    z.literal(SEASON_EFFECT_TARGETS_VERSION),
    z.literal(SEASON_EFFECT_TARGETS_LEGACY_VERSION),
  ]),
  healthVersion: z.literal(SEASON_HEALTH_VERSION),
  tradeVersion: z.union([
    z.literal(SEASON_TRADE_VERSION),
    z.literal(SEASON_TRADE_VERSION_V6),
    z.literal('season-trade-v5'),
    z.literal('season-trade-v4'),
    z.literal('season-trade-v3'),
  ]),
  influenceVersion: z.union([
    z.literal(SEASON_INFLUENCE_VERSION),
    z.literal(SEASON_INFLUENCE_VERSION_V2),
    z.literal(SEASON_INFLUENCE_VERSION_V1),
  ]),
  objectiveVersion: z
    .union([
      z.literal(SEASON_OBJECTIVE_VERSION),
      z.literal(SEASON_OBJECTIVE_VERSION_V2),
      z.literal(SEASON_OBJECTIVE_VERSION_V1),
    ])
    .optional(),
  challengeVersion: z
    .union([
      z.literal(SEASON_CHALLENGE_VERSION),
      z.literal(SEASON_CHALLENGE_VERSION_V2),
      z.literal(SEASON_CHALLENGE_VERSION_V1),
    ])
    .optional(),
  challengeTargetsVersion: z.literal(SEASON_CHALLENGE_TARGETS_VERSION).optional(),
  campaignVersion: z
    .union([
      z.literal(SEASON_CAMPAIGN_VERSION),
      z.literal(SEASON_CAMPAIGN_VERSION_V2),
      z.literal(SEASON_CAMPAIGN_VERSION_V1),
    ])
    .optional(),
  campaignTargetsVersion: z.literal(SEASON_CAMPAIGN_TARGETS_VERSION).optional(),
  injuryTargetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),
  tradeTargetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
  influenceTargetsVersion: z.union([
    z.literal(SEASON_INFLUENCE_TARGETS_VERSION),
    z.literal(SEASON_INFLUENCE_TARGETS_VERSION_V2),
    z.literal(SEASON_INFLUENCE_TARGETS_VERSION_V1),
  ]),
  freeAgencyVersion: z.union([
    z.literal(SEASON_FREE_AGENCY_VERSION),
    z.literal(SEASON_FREE_AGENCY_VERSION_V2),
    z.literal(SEASON_FREE_AGENCY_VERSION_V1),
  ]),
  freeAgencyIndexVersion: z.union([
    z.literal(SEASON_FREE_AGENCY_INDEX_VERSION),
    z.literal(SEASON_FREE_AGENCY_INDEX_VERSION_V1),
  ]),
  freeAgencyTargetsVersion: z.union([
    z.literal(SEASON_FREE_AGENCY_TARGETS_VERSION),
    z.literal(SEASON_FREE_AGENCY_TARGETS_VERSION_V1),
  ]),
  authorityVersion: z.string().optional(),
  multiplayerVersion: z.string().optional(),
});
export type SeasonCheckpointVersions = z.infer<typeof seasonCheckpointVersionsSchema>;
export { seasonCheckpointDigestSchema, type SeasonCheckpointDigest } from './season-digests.ts';
export { seasonRotationSetDigestSchema, type SeasonRotationSetDigest } from './season-digests.ts';
export const seasonCandidateCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  checkpointVersion: z.union([
    z.literal(SEASON_CHECKPOINT_VERSION),
    z.literal(SEASON_CHECKPOINT_VERSION_V6),
    z.literal(SEASON_CHECKPOINT_VERSION_V5),
  ]),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  versions: seasonCheckpointVersionsSchema,
  blockIndex: z.number().int().min(0).max(8),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  rotationDigest: seasonRotationSetDigestSchema,
  standings: seasonStandingsSchema,
  teamAggregates: z.array(seasonTeamAggregateSchema).length(30),
  playerAggregates: z.array(seasonPlayerAggregateSchema).min(300).max(450),
  gameSummaries: z.array(seasonGameSummarySchema).min(1).max(150),
  retainedDetails: z.array(seasonRetainedGameDetailSchema).max(10),
  recap: seasonBlockRecapSchema,
  effects: seasonEffectsStateSchema,
  health: seasonHealthStateSchema,
  influence: seasonInfluenceStateSchema,
  freeAgency: seasonFreeAgencyStateSchema,
  transactions: z.array(seasonTransactionEntrySchema),
  objective: z
    .object({
      objectiveId: seasonObjectiveIdSchema.nullable(),
      success: z.boolean().nullable(),
      evaluation: seasonObjectiveEvaluationSchema,
    })
    .optional(),
  objectiveEvaluations: z.record(franchiseIdSchema, seasonObjectiveEvaluationSchema).optional(),
  challenges: seasonBlockChallengeEvaluationSchema.optional(),
  challengeIds: z.array(seasonChallengeIdSchema).length(3).optional(),
  campaign: z
    .object({
      opportunityId: z.string().nullable(),
      outcome: z.enum(['missed', 'completed', 'breakthrough']).nullable(),
      evaluation: seasonCampaignEvaluationSchema.nullable(),
    })
    .optional(),
  campaignEvaluations: z.record(franchiseIdSchema, seasonCampaignEvaluationSchema).optional(),
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  stateRevision: z.number().int().nonnegative(),
  stateDigest: seasonCheckpointDigestSchema,
  digest: seasonCheckpointDigestSchema,
});
export type SeasonCandidateCheckpoint = z.infer<typeof seasonCandidateCheckpointSchema>;
export const seasonAcceptedBlockSchema = z.object({
  runId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  commandId: z.string().min(1).max(64),
  rotationDigest: seasonRotationSetDigestSchema,
  checkpointDigest: seasonCheckpointDigestSchema,
  summaryCount: z.number().int().min(1).max(150),
  stateRevision: z.number().int().nonnegative(),
  stateDigest: seasonCheckpointDigestSchema,
});
export type SeasonAcceptedBlock = z.infer<typeof seasonAcceptedBlockSchema>;
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
export const seasonActiveRunIndexSchema = z.object({
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  humanFranchiseId: franchiseIdSchema,
  participantFranchiseIds: z.array(franchiseIdSchema).min(1).max(2).optional(),
  authorityKind: z.enum(['local-solo', 'season-multiplayer']).optional(),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  humanWins: z.number().int().nonnegative(),
  humanLosses: z.number().int().nonnegative(),
  updatedAtIso: z.string(),
});
export type SeasonActiveRunIndex = z.infer<typeof seasonActiveRunIndexSchema>;
