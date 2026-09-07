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
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_CHALLENGE_TARGETS_VERSION,
  SEASON_CHALLENGE_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  SEASON_FREE_AGENCY_VERSION,
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
  SEASON_STAMINA_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
} from './season-versions.ts';
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
  staminaVersion: z.literal(SEASON_STAMINA_VERSION),
  chemistryVersion: z.literal(SEASON_CHEMISTRY_VERSION),
  effectsTargetsVersion: z.literal(SEASON_EFFECT_TARGETS_VERSION),
  healthVersion: z.literal(SEASON_HEALTH_VERSION),
  tradeVersion: z.literal(SEASON_TRADE_VERSION),
  influenceVersion: z.literal(SEASON_INFLUENCE_VERSION),
  objectiveVersion: z
    .literal(SEASON_OBJECTIVE_VERSION)
    .optional(),
  challengeVersion: z
    .literal(SEASON_CHALLENGE_VERSION)
    .optional(),
  challengeTargetsVersion: z.literal(SEASON_CHALLENGE_TARGETS_VERSION).optional(),
  campaignVersion: z
    .literal(SEASON_CAMPAIGN_VERSION)
    .optional(),
  campaignTargetsVersion: z.literal(SEASON_CAMPAIGN_TARGETS_VERSION).optional(),
  injuryTargetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),
  tradeTargetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
  influenceTargetsVersion: z.literal(SEASON_INFLUENCE_TARGETS_VERSION),
  freeAgencyVersion: z.literal(SEASON_FREE_AGENCY_VERSION),
  freeAgencyIndexVersion: z.literal(SEASON_FREE_AGENCY_INDEX_VERSION),
  freeAgencyTargetsVersion: z.literal(SEASON_FREE_AGENCY_TARGETS_VERSION),
  authorityVersion: z.string().optional(),
  multiplayerVersion: z.string().optional(),
});
export type SeasonCheckpointVersions = z.infer<typeof seasonCheckpointVersionsSchema>;
export { seasonCheckpointDigestSchema, type SeasonCheckpointDigest } from './season-digests.ts';
export { seasonRotationSetDigestSchema, type SeasonRotationSetDigest } from './season-digests.ts';
export const seasonCandidateCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  checkpointVersion: z.literal(SEASON_CHECKPOINT_VERSION),
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
