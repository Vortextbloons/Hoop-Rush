import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema, seasonGameIdSchema } from './ids.ts';
import { seasonCheckpointDigestSchema, seasonRotationSetDigestSchema } from './season-digests.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonPlayerAggregateSchema, seasonTeamAggregateSchema } from './season-aggregates.ts';
import { seasonGameSummarySchema, seasonRetainedGameDetailSchema } from './season-game-summary.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { seasonCampaignOpportunityIdSchema } from './season-campaign.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_BLOCK_VERSION } from './season-versions.ts';
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
export const seasonPendingBlockCandidateSchema = z.object({
    schemaVersion: z.literal(1),
    blockVersion: z.union([z.literal(SEASON_BLOCK_VERSION), z.literal('season-block-v5')]),
    runId: idSchema,
    commandId: commandIdSchema,
    blockIndex: z.number().int().min(0).max(8),
    expectedRevision: z.number().int().nonnegative(),
    expectedStateRevision: z.number().int().nonnegative(),
    expectedStateDigest: seasonCheckpointDigestSchema,
    objectiveId: seasonObjectiveIdSchema.nullable().optional(),
    campaignOpportunityId: seasonCampaignOpportunityIdSchema.nullable().optional(),
    nextGameId: seasonGameIdSchema,
    summaries: z.array(seasonGameSummarySchema).max(150),
    retainedDetails: z.array(seasonRetainedGameDetailSchema).max(10),
    effects: seasonEffectsStateSchema,
    health: seasonHealthStateSchema,
    standings: seasonStandingsSchema,
    teamAggregates: z.array(seasonTeamAggregateSchema).max(30),
    playerAggregates: z.array(seasonPlayerAggregateSchema).max(300),
    rotationDigest: seasonRotationSetDigestSchema,
});
export type SeasonPendingBlockCandidate = z.infer<typeof seasonPendingBlockCandidateSchema>;
