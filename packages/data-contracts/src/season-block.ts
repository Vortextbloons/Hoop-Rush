import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { seasonRunCommandBaseSchema } from './season-command-base.ts';
import { seasonCandidateCheckpointSchema } from './season-checkpoint.ts';
import { seasonRotationSetDigestSchema } from './season-digests.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { seasonCampaignOpportunityIdSchema } from './season-campaign.ts';
import { seasonChallengeIdSchema } from './season-challenge.ts';
import {
  SEASON_BLOCK_VERSION,
  SEASON_BLOCK_VERSION_V5,
  SEASON_BLOCK_VERSION_V6,
} from './season-versions.ts';
export const seasonSubmitBlockCommandSchema = seasonRunCommandBaseSchema.extend({
  blockVersion: z.union([
    z.literal(SEASON_BLOCK_VERSION),
    z.literal(SEASON_BLOCK_VERSION_V6),
    z.literal(SEASON_BLOCK_VERSION_V5),
  ]),
  command: z.literal('submit-season-block'),
  expectedRevision: z.number().int().nonnegative(),
  blockIndex: z.number().int().min(0).max(8),
  rotationDigest: seasonRotationSetDigestSchema,
  objectiveId: seasonObjectiveIdSchema.nullable().optional(),
  campaignOpportunityId: seasonCampaignOpportunityIdSchema.nullable().optional(),
  challengeIds: z.array(seasonChallengeIdSchema).length(3).optional(),
});
export type SeasonSubmitBlockCommand = z.infer<typeof seasonSubmitBlockCommandSchema>;
export const seasonStaleCursorRejectionSchema = z.object({
  code: z.literal('stale-cursor'),
  currentRevision: z.number().int().nonnegative(),
  currentCompletedRounds: z.number().int().min(0).max(82),
});
export type SeasonStaleCursorRejection = z.infer<typeof seasonStaleCursorRejectionSchema>;
export const seasonInvalidRotationsRejectionSchema = z.object({
  code: z.literal('invalid-rotations'),
  franchiseFailures: z.array(
    z.object({
      franchiseId: franchiseIdSchema,
      reasons: z.array(z.string().min(1).max(256)).min(1),
    }),
  ),
});
export type SeasonInvalidRotationsRejection = z.infer<typeof seasonInvalidRotationsRejectionSchema>;
export const seasonNonBoundaryBlockRejectionSchema = z.object({
  code: z.literal('non-boundary-block'),
  expectedBlockIndex: z.number().int().min(0).max(8),
  submittedBlockIndex: z.number().int().min(0).max(8),
});
export type SeasonNonBoundaryBlockRejection = z.infer<typeof seasonNonBoundaryBlockRejectionSchema>;
import {
  seasonDuplicateCommandRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
} from './season-command-base.ts';
export {
  seasonDuplicateCommandRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
};
export type {
  SeasonDuplicateCommandRejection,
  SeasonRunMismatchRejection,
  SeasonStaleStateRejection,
} from './season-command-base.ts';
export const seasonInvalidObjectiveRejectionSchema = z.object({
  code: z.literal('invalid-objective'),
  expected: z.enum(['required', 'none', 'not-offered']),
  objectiveId: z.string().min(1).max(64).optional(),
  blockIndex: z.number().int().min(0).max(8),
});
export type SeasonInvalidObjectiveRejection = z.infer<typeof seasonInvalidObjectiveRejectionSchema>;
export const seasonInvalidChallengeRejectionSchema = z.object({
  code: z.literal('invalid-challenge'),
  expected: z.enum(['required', 'none', 'not-offered']),
  challengeId: z.string().min(1).max(64).optional(),
  blockIndex: z.number().int().min(0).max(8),
});
export type SeasonInvalidChallengeRejection = z.infer<typeof seasonInvalidChallengeRejectionSchema>;
export const seasonInvalidCampaignRejectionSchema = z.object({
  code: z.literal('invalid-campaign'),
  expected: z.enum(['required', 'none', 'not-offered']),
  opportunityId: z.string().min(1).max(64).optional(),
  blockIndex: z.number().int().min(0).max(8),
});
export type SeasonInvalidCampaignRejection = z.infer<typeof seasonInvalidCampaignRejectionSchema>;
export const seasonFreeAgencyUnresolvedRejectionSchema = z.object({
  code: z.literal('free-agency-unresolved'),
  windowIndex: z.number().int().min(0).max(2),
  blockIndex: z.number().int().min(0).max(8),
});
export const seasonEvolutionSelectionRequiredRejectionSchema = z.object({
  code: z.literal('evolution-selection-required'),
  blockIndex: z.number().int().min(0).max(8),
});
export type SeasonEvolutionSelectionRequiredRejection = z.infer<
  typeof seasonEvolutionSelectionRequiredRejectionSchema
>;
export type SeasonFreeAgencyUnresolvedRejection = z.infer<
  typeof seasonFreeAgencyUnresolvedRejectionSchema
>;
export const seasonSubmitBlockRejectionSchema = z.discriminatedUnion('code', [
  seasonStaleCursorRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidRotationsRejectionSchema,
  seasonNonBoundaryBlockRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonInvalidObjectiveRejectionSchema,
  seasonInvalidChallengeRejectionSchema,
  seasonInvalidCampaignRejectionSchema,
  seasonFreeAgencyUnresolvedRejectionSchema,
  seasonEvolutionSelectionRequiredRejectionSchema,
]);
export type SeasonSubmitBlockRejection = z.infer<typeof seasonSubmitBlockRejectionSchema>;
export const seasonSubmitBlockResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('rejected'), rejection: seasonSubmitBlockRejectionSchema }),
  z.object({ status: z.literal('accepted'), checkpoint: seasonCandidateCheckpointSchema }),
]);
export type SeasonSubmitBlockResult = z.infer<typeof seasonSubmitBlockResultSchema>;
