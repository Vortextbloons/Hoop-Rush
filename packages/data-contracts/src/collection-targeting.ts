import { z } from 'zod';
import {
  collectionCardIdSchema,
  collectionPackIdSchema,
  collectionRaritySchema,
} from './collection-primitives.ts';
import {
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_TARGETING_VERSION,
} from './collection-versions.ts';
import { playerIdSchema } from './ids.ts';

export const collectionTargetEligibilitySchema = z
  .object({
    rarity: collectionRaritySchema,
    cardIds: z.array(collectionCardIdSchema),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const seen = new Set<string>();
    let previous = '';
    for (const cardId of entry.cardIds) {
      if (seen.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate eligible card ${cardId}` });
      }
      if (seen.size > 0 && cardId <= previous) {
        ctx.addIssue({ code: 'custom', message: 'eligible card ids must be canonical sorted' });
      }
      seen.add(cardId);
      previous = cardId;
    }
  });
export type CollectionTargetEligibility = z.infer<typeof collectionTargetEligibilitySchema>;

export const collectionTargetSnapshotSchema = z
  .object({
    targetingVersion: z.literal(COLLECTION_TARGETING_VERSION),
    targetPlayerId: playerIdSchema,
    multiplierBp: z.number().int().min(10_000),
    packId: collectionPackIdSchema,
    packRulesVersion: z.literal(COLLECTION_PACK_RULES_VERSION),
    eligibleByRarity: z.array(collectionTargetEligibilitySchema).length(6),
    eligibleCardCount: z.number().int().nonnegative(),
    seedPath: z.array(z.string().min(1).max(128)).min(1),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const seen = new Set<string>();
    let total = 0;
    for (const entry of snapshot.eligibleByRarity) {
      if (seen.has(entry.rarity)) {
        ctx.addIssue({ code: 'custom', message: `duplicate rarity entry ${entry.rarity}` });
      }
      seen.add(entry.rarity);
      total += entry.cardIds.length;
    }
    if (total !== snapshot.eligibleCardCount) {
      ctx.addIssue({ code: 'custom', message: 'eligible card count does not match the groups' });
    }
  });
export type CollectionTargetSnapshot = z.infer<typeof collectionTargetSnapshotSchema>;

export const collectionTargetSlotOddsSchema = z
  .object({
    slotIndex: z.number().int().nonnegative(),
    targetProbability: z.number().min(0).max(1),
  })
  .strict();
export type CollectionTargetSlotOdds = z.infer<typeof collectionTargetSlotOddsSchema>;

export const collectionTargetOddsSchema = z
  .object({
    targetingVersion: z.literal(COLLECTION_TARGETING_VERSION),
    packId: collectionPackIdSchema,
    targetPlayerId: playerIdSchema.nullable(),
    multiplierBp: z.number().int().min(10_000),
    eligibleCardIds: z.array(collectionCardIdSchema),
    perSlot: z.array(collectionTargetSlotOddsSchema).min(1).max(10),
    atLeastOneTarget: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((odds, ctx) => {
    let none = 1;
    for (const slot of odds.perSlot) none *= 1 - slot.targetProbability;
    const measured = 1 - none;
    if (Math.abs(measured - odds.atLeastOneTarget) > 1e-12) {
      ctx.addIssue({ code: 'custom', message: 'at-least-one odds disagree with the slots' });
    }
    if (odds.targetPlayerId === null && odds.eligibleCardIds.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'an untargeted pack has no eligible target cards' });
    }
  });
export type CollectionTargetOdds = z.infer<typeof collectionTargetOddsSchema>;
