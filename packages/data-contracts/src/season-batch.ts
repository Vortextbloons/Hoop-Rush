import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema } from './ids.ts';
import { seasonRunCommandBaseSchema } from './season-command-base.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { seasonRotationSchema } from './season-rotation.ts';
import { seasonCampaignOpportunityIdSchema } from './season-campaign.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';

export const seasonBatchDecisionPayloadSchema = z.object({
  franchiseId: franchiseIdSchema,
  participantId: z.enum(['p1', 'p2']),
  rotation: seasonRotationSchema.optional(),
  objectiveId: seasonObjectiveIdSchema.nullable().optional(),
  campaignOpportunityId: seasonCampaignOpportunityIdSchema.nullable().optional(),
  freeAgencyDeclaration: z.unknown().nullable().optional(),
  influenceChoices: z.array(z.unknown()).optional(),
  payloadDigest: seasonCheckpointDigestSchema,
});
export type SeasonBatchDecisionPayload = z.infer<typeof seasonBatchDecisionPayloadSchema>;

export const seasonBatchPrivateDecisionsCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('apply-batch-private-decisions'),
  p1Decision: seasonBatchDecisionPayloadSchema,
  p2Decision: seasonBatchDecisionPayloadSchema,
  preStateRevision: z.number().int().nonnegative(),
  preStateDigest: seasonCheckpointDigestSchema,
});
export type SeasonBatchPrivateDecisionsCommand = z.infer<
  typeof seasonBatchPrivateDecisionsCommandSchema
>;

export const seasonBatchPrivateDecisionsRejectionSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('stale-state') }),
  z.object({ code: z.literal('stale-digest') }),
  z.object({ code: z.literal('unresolved-decision') }),
  z.object({ code: z.literal('invalid-rotation') }),
  z.object({ code: z.literal('actor-mismatch') }),
]);

export const seasonBatchPrivateDecisionsResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonBatchPrivateDecisionsRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    appliedFranchiseIds: z.array(franchiseIdSchema).length(2),
    resultingStateDigest: seasonCheckpointDigestSchema,
  }),
]);
export type SeasonBatchPrivateDecisionsResult = z.infer<
  typeof seasonBatchPrivateDecisionsResultSchema
>;
