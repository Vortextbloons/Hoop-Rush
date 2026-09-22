import { z } from 'zod';
import { collectionCardIdSchema, collectionSetIdSchema } from './collection-primitives.ts';
import { COLLECTION_SET_REWARD_VERSION } from './collection-versions.ts';
import { commandIdSchema } from './ids.ts';

export const collectionSetRewardDefinitionSchema = z
  .object({
    setRewardVersion: z.literal(COLLECTION_SET_REWARD_VERSION),
    setId: collectionSetIdSchema,
    title: z.string().min(1).max(96),
    memberCardIds: z.array(collectionCardIdSchema).min(1).max(12),
    currency: z.literal('Exchange'),
    amount: z.number().int().positive(),
    description: z.string().min(1).max(160),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const seen = new Set<string>();
    for (const cardId of definition.memberCardIds) {
      if (seen.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate set member ${cardId}` });
      }
      seen.add(cardId);
    }
  });
export type CollectionSetRewardDefinition = z.infer<typeof collectionSetRewardDefinitionSchema>;

export const collectionSetProgressFactsSchema = z
  .object({
    setId: collectionSetIdSchema,
    title: z.string().min(1).max(96),
    memberCardIds: z.array(collectionCardIdSchema).min(1).max(12),
    ownedMemberCardIds: z.array(collectionCardIdSchema).max(12),
    missingCardIds: z.array(collectionCardIdSchema).max(12),
    ownedCount: z.number().int().nonnegative(),
    requiredCount: z.number().int().positive(),
    complete: z.boolean(),
  })
  .strict()
  .superRefine((facts, ctx) => {
    const required = new Set(facts.memberCardIds);
    const owned = new Set(facts.ownedMemberCardIds);
    const missing = new Set(facts.missingCardIds);
    if (owned.size !== facts.ownedMemberCardIds.length) {
      ctx.addIssue({ code: 'custom', message: 'owned member ids must be unique' });
    }
    for (const cardId of owned) {
      if (!required.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `owned card ${cardId} is not a set member` });
      }
      if (missing.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `card ${cardId} is both owned and missing` });
      }
    }
    for (const cardId of missing) {
      if (!required.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `missing card ${cardId} is not a set member` });
      }
    }
    if (owned.size + missing.size !== required.size) {
      ctx.addIssue({ code: 'custom', message: 'owned and missing cards do not partition the set' });
    }
    if (facts.ownedCount !== owned.size) {
      ctx.addIssue({ code: 'custom', message: 'owned count does not match the owned cards' });
    }
    if (facts.requiredCount !== required.size) {
      ctx.addIssue({ code: 'custom', message: 'required count does not match the member cards' });
    }
    if (facts.complete !== (owned.size === required.size)) {
      ctx.addIssue({ code: 'custom', message: 'completion flag disagrees with the owned cards' });
    }
  });
export type CollectionSetProgressFacts = z.infer<typeof collectionSetProgressFactsSchema>;

export const collectionSetClaimReceiptSchema = z
  .object({
    setRewardVersion: z.literal(COLLECTION_SET_REWARD_VERSION),
    setId: collectionSetIdSchema,
    title: z.string().min(1).max(96),
    memberCardIds: z.array(collectionCardIdSchema).min(1).max(12),
    ownedAtClaimCardIds: z.array(collectionCardIdSchema).min(1).max(12),
    currency: z.literal('Exchange'),
    amount: z.number().int().positive(),
    transactionId: z.string().regex(/^txn-[0-9a-f]{32}$/),
    commandId: commandIdSchema,
    claimedAtIso: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const required = new Set(receipt.memberCardIds);
    if (receipt.ownedAtClaimCardIds.length !== required.size) {
      ctx.addIssue({ code: 'custom', message: 'claim requires every set member to be owned' });
    }
    for (const cardId of receipt.ownedAtClaimCardIds) {
      if (!required.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `claimed card ${cardId} is not a set member` });
      }
    }
  });
export type CollectionSetClaimReceipt = z.infer<typeof collectionSetClaimReceiptSchema>;
