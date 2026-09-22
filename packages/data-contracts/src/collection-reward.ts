import { z } from 'zod';
import {
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_REWARD_V2_VERSION,
  COLLECTION_REWARD_VERSION,
} from './collection-versions.ts';
import { collectionChallengeIdSchema } from './collection-challenge.ts';
import { collectionDifficultyIdSchema } from './collection-difficulty.ts';
import { collectionObjectiveIdSchema } from './collection-objective.ts';

export const collectionRewardComponentKindV2Schema = z.enum([
  'outcome',
  'objective',
  'margin',
  'first-clear',
]);
export type CollectionRewardComponentKindV2 = z.infer<typeof collectionRewardComponentKindV2Schema>;

export const collectionRewardComponentKindSchema = z.enum([
  'outcome',
  'objective',
  'margin',
  'first-clear',
  'challenge-first-clear',
  'challenge-repeat-win',
]);
export type CollectionRewardComponentKind = z.infer<typeof collectionRewardComponentKindSchema>;

export const collectionRewardReasonV2Schema = z.enum([
  'game-win-reward',
  'game-loss-reward',
  'game-objective-reward',
  'game-margin-reward',
  'game-first-clear-reward',
]);
export type CollectionRewardReasonV2 = z.infer<typeof collectionRewardReasonV2Schema>;

export const collectionRewardReasonSchema = z.enum([
  'game-win-reward',
  'game-loss-reward',
  'game-objective-reward',
  'game-margin-reward',
  'game-first-clear-reward',
  'challenge-first-clear-reward',
  'challenge-repeat-win-reward',
]);
export type CollectionRewardReason = z.infer<typeof collectionRewardReasonSchema>;

export function collectionScaleRewardCoins(baseAmount: number, multiplierBp: number): number {
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0) {
    throw new Error(`reward base must be a nonnegative safe integer, got ${String(baseAmount)}`);
  }
  const product = baseAmount * multiplierBp;
  if (!Number.isSafeInteger(product)) {
    throw new Error('reward scaling overflows safe integers');
  }
  return Math.floor((product + 5000) / 10_000);
}

function refineComponentV2(
  component: {
    kind: CollectionRewardComponentKindV2;
    reason: CollectionRewardReasonV2;
    baseAmount: number;
    amount: number;
    multiplierBp: number;
    objectiveId?: string;
    marginPoints?: number;
    difficultyId?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    component.amount !== collectionScaleRewardCoins(component.baseAmount, component.multiplierBp)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `component amount ${String(component.amount)} is not the half-up scaled base`,
    });
  }
  const hasObjective = component.objectiveId !== undefined;
  const hasMargin = component.marginPoints !== undefined;
  const hasDifficulty = component.difficultyId !== undefined;
  if (component.kind === 'outcome') {
    const expectedReason = component.baseAmount === 100 ? 'game-win-reward' : 'game-loss-reward';
    if (component.baseAmount !== 100 && component.baseAmount !== 10) {
      ctx.addIssue({ code: 'custom', message: 'outcome base must be 100 or 10 Coins' });
    }
    if (component.reason !== expectedReason) {
      ctx.addIssue({ code: 'custom', message: 'outcome reason does not match the base amount' });
    }
    if (hasObjective || hasMargin || hasDifficulty) {
      ctx.addIssue({
        code: 'custom',
        message: 'outcome component must not carry supporting facts',
      });
    }
  } else if (component.kind === 'objective') {
    if (component.reason !== 'game-objective-reward') {
      ctx.addIssue({ code: 'custom', message: 'objective component needs the objective reason' });
    }
    if (component.baseAmount !== 30) {
      ctx.addIssue({ code: 'custom', message: 'objective base must be 30 Coins' });
    }
    if (!hasObjective) {
      ctx.addIssue({ code: 'custom', message: 'objective component needs an objectiveId' });
    }
    if (hasMargin || hasDifficulty) {
      ctx.addIssue({ code: 'custom', message: 'objective component carries foreign facts' });
    }
  } else if (component.kind === 'margin') {
    if (component.reason !== 'game-margin-reward') {
      ctx.addIssue({ code: 'custom', message: 'margin component needs the margin reason' });
    }
    if (!hasMargin) {
      ctx.addIssue({ code: 'custom', message: 'margin component needs marginPoints' });
    } else if (component.baseAmount !== component.marginPoints) {
      ctx.addIssue({ code: 'custom', message: 'margin base must be one Coin per capped point' });
    }
    if (hasObjective || hasDifficulty) {
      ctx.addIssue({ code: 'custom', message: 'margin component carries foreign facts' });
    }
  } else {
    if (component.reason !== 'game-first-clear-reward') {
      ctx.addIssue({
        code: 'custom',
        message: 'first-clear component needs the first-clear reason',
      });
    }
    if (!hasDifficulty) {
      ctx.addIssue({ code: 'custom', message: 'first-clear component needs a difficultyId' });
    }
    if (component.multiplierBp !== 10_000) {
      ctx.addIssue({ code: 'custom', message: 'first-clear component is never multiplied' });
    }
    if (hasObjective || hasMargin) {
      ctx.addIssue({ code: 'custom', message: 'first-clear component carries foreign facts' });
    }
  }
}

export const collectionRewardComponentV2Schema = z
  .object({
    kind: collectionRewardComponentKindV2Schema,
    reason: collectionRewardReasonV2Schema,
    currency: z.literal('Coins'),
    baseAmount: z.number().int().nonnegative(),
    multiplierBp: z.number().int().positive(),
    amount: z.number().int().positive(),
    transactionId: z.string().regex(/^txn-[0-9a-f]{32}$/),
    objectiveId: collectionObjectiveIdSchema.optional(),
    marginPoints: z.number().int().min(1).max(20).optional(),
    difficultyId: collectionDifficultyIdSchema.optional(),
  })
  .strict()
  .superRefine(refineComponentV2);
export type CollectionRewardComponentV2 = z.infer<typeof collectionRewardComponentV2Schema>;

export const collectionRewardComponentSchema = z
  .object({
    kind: collectionRewardComponentKindSchema,
    reason: collectionRewardReasonSchema,
    currency: z.literal('Coins'),
    baseAmount: z.number().int().nonnegative(),
    multiplierBp: z.number().int().positive(),
    amount: z.number().int().positive(),
    transactionId: z.string().regex(/^txn-[0-9a-f]{32}$/),
    objectiveId: collectionObjectiveIdSchema.optional(),
    marginPoints: z.number().int().min(1).max(20).optional(),
    difficultyId: collectionDifficultyIdSchema.optional(),
    challengeId: collectionChallengeIdSchema.optional(),
  })
  .strict()
  .superRefine((component, ctx) => {
    if (component.kind === 'challenge-first-clear' || component.kind === 'challenge-repeat-win') {
      const expectedReason =
        component.kind === 'challenge-first-clear'
          ? 'challenge-first-clear-reward'
          : 'challenge-repeat-win-reward';
      if (component.reason !== expectedReason) {
        ctx.addIssue({
          code: 'custom',
          message: 'challenge component reason does not match its kind',
        });
      }
      if (component.challengeId === undefined) {
        ctx.addIssue({ code: 'custom', message: 'challenge component needs a challengeId' });
      }
      if (component.multiplierBp !== 10_000) {
        ctx.addIssue({ code: 'custom', message: 'challenge component is never multiplied' });
      }
      if (component.amount !== component.baseAmount) {
        ctx.addIssue({ code: 'custom', message: 'challenge component pays its unscaled base' });
      }
      if (
        component.objectiveId !== undefined ||
        component.marginPoints !== undefined ||
        component.difficultyId !== undefined
      ) {
        ctx.addIssue({ code: 'custom', message: 'challenge component carries foreign facts' });
      }
      return;
    }
    if (component.challengeId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'non-challenge component carries a challengeId' });
    }
    refineComponentV2(component as Parameters<typeof refineComponentV2>[0], ctx);
  });
export type CollectionRewardComponent = z.infer<typeof collectionRewardComponentSchema>;

function refineReceiptTotals(
  receipt: {
    components: Array<{ amount: number; kind: string; transactionId: string; reason: string }>;
    total: number;
  },
  ctx: z.RefinementCtx,
): void {
  const measured = receipt.components.reduce((sum, component) => sum + component.amount, 0);
  if (!Number.isSafeInteger(measured) || measured !== receipt.total) {
    ctx.addIssue({ code: 'custom', message: 'receipt total does not match its components' });
  }
  const kinds = new Set<string>();
  const transactions = new Set<string>();
  for (const component of receipt.components) {
    if (kinds.has(component.kind)) {
      ctx.addIssue({ code: 'custom', message: `duplicate reward component ${component.kind}` });
    }
    kinds.add(component.kind);
    if (transactions.has(component.transactionId)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate reward transaction ${component.transactionId}`,
      });
    }
    transactions.add(component.transactionId);
  }
}

export const collectionGameRewardReceiptV2Schema = z
  .object({
    rewardVersion: z.literal(COLLECTION_REWARD_V2_VERSION),
    difficultyId: collectionDifficultyIdSchema,
    gameOutcome: z.enum(['completed', 'forfeit']),
    playerWin: z.boolean(),
    scoreMargin: z.number().int().nonnegative().nullable(),
    objectiveId: collectionObjectiveIdSchema.nullable(),
    objectiveSucceeded: z.boolean(),
    firstClearEligible: z.boolean(),
    firstClearGranted: z.boolean(),
    components: z.array(collectionRewardComponentV2Schema).min(1),
    total: z.number().int().positive(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    refineReceiptTotals(receipt, ctx);
    const kinds = new Set(receipt.components.map((component) => component.kind));
    for (const component of receipt.components) {
      if (component.kind === 'outcome') {
        const isWin = component.reason === 'game-win-reward';
        if (isWin !== receipt.playerWin) {
          ctx.addIssue({
            code: 'custom',
            message: 'outcome component disagrees with the receipt winner',
          });
        }
      }
    }
    if (receipt.gameOutcome === 'forfeit') {
      if (receipt.components.length !== 1 || !kinds.has('outcome')) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts pay only the outcome component',
        });
      }
      if (receipt.scoreMargin !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts must not record a score margin',
        });
      }
      if (receipt.firstClearGranted || receipt.objectiveSucceeded) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts cannot grant objective or first clear',
        });
      }
    }
    if (kinds.has('margin')) {
      if (!receipt.playerWin || receipt.gameOutcome !== 'completed') {
        ctx.addIssue({ code: 'custom', message: 'margin reward requires a completed player win' });
      }
    }
    if (receipt.objectiveSucceeded !== kinds.has('objective')) {
      ctx.addIssue({ code: 'custom', message: 'objective component and success flag disagree' });
    }
    if (receipt.objectiveSucceeded && receipt.objectiveId === null) {
      ctx.addIssue({ code: 'custom', message: 'objective success needs a selected objective' });
    }
    if (receipt.firstClearGranted) {
      if (!receipt.firstClearEligible) {
        ctx.addIssue({ code: 'custom', message: 'first clear needs prior eligibility' });
      }
      if (!receipt.playerWin || receipt.gameOutcome !== 'completed') {
        ctx.addIssue({ code: 'custom', message: 'first clear requires a completed player win' });
      }
    }
    if (kinds.has('first-clear') !== receipt.firstClearGranted) {
      ctx.addIssue({ code: 'custom', message: 'first-clear component and grant flag disagree' });
    }
  });
export type CollectionGameRewardReceiptV2 = z.infer<typeof collectionGameRewardReceiptV2Schema>;

export const collectionGameRewardReceiptV3Schema = z
  .object({
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    challengeVersion: z.literal(COLLECTION_CHALLENGE_VERSION),
    difficultyId: collectionDifficultyIdSchema,
    gameOutcome: z.enum(['completed', 'forfeit']),
    playerWin: z.boolean(),
    scoreMargin: z.number().int().nonnegative().nullable(),
    objectiveId: collectionObjectiveIdSchema.nullable(),
    objectiveSucceeded: z.boolean(),
    firstClearEligible: z.boolean(),
    firstClearGranted: z.boolean(),
    challengeId: collectionChallengeIdSchema,
    challengeFirstClearEligible: z.boolean(),
    challengeFirstClearGranted: z.boolean(),
    challengeComponentKind: z.enum(['challenge-first-clear', 'challenge-repeat-win']).nullable(),
    components: z.array(collectionRewardComponentSchema).min(1),
    total: z.number().int().positive(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    refineReceiptTotals(receipt, ctx);
    const kinds = new Set(receipt.components.map((component) => component.kind));
    for (const component of receipt.components) {
      if (component.kind === 'outcome') {
        const isWin = component.reason === 'game-win-reward';
        if (isWin !== receipt.playerWin) {
          ctx.addIssue({
            code: 'custom',
            message: 'outcome component disagrees with the receipt winner',
          });
        }
      }
      if (
        (component.kind === 'challenge-first-clear' || component.kind === 'challenge-repeat-win') &&
        component.challengeId !== receipt.challengeId
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'challenge component references a different challenge',
        });
      }
    }
    if (receipt.gameOutcome === 'forfeit') {
      if (receipt.components.length !== 1 || !kinds.has('outcome')) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts pay only the outcome component',
        });
      }
      if (receipt.scoreMargin !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts must not record a score margin',
        });
      }
      if (receipt.firstClearGranted || receipt.objectiveSucceeded) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts cannot grant objective or first clear',
        });
      }
      if (receipt.challengeFirstClearGranted || receipt.challengeComponentKind !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'forfeit receipts cannot grant a challenge component',
        });
      }
    }
    if (kinds.has('margin')) {
      if (!receipt.playerWin || receipt.gameOutcome !== 'completed') {
        ctx.addIssue({ code: 'custom', message: 'margin reward requires a completed player win' });
      }
    }
    if (receipt.objectiveSucceeded !== kinds.has('objective')) {
      ctx.addIssue({ code: 'custom', message: 'objective component and success flag disagree' });
    }
    if (receipt.objectiveSucceeded && receipt.objectiveId === null) {
      ctx.addIssue({ code: 'custom', message: 'objective success needs a selected objective' });
    }
    if (receipt.firstClearGranted) {
      if (!receipt.firstClearEligible) {
        ctx.addIssue({ code: 'custom', message: 'first clear needs prior eligibility' });
      }
      if (!receipt.playerWin || receipt.gameOutcome !== 'completed') {
        ctx.addIssue({ code: 'custom', message: 'first clear requires a completed player win' });
      }
    }
    if (kinds.has('first-clear') !== receipt.firstClearGranted) {
      ctx.addIssue({ code: 'custom', message: 'first-clear component and grant flag disagree' });
    }
    const hasChallengeFirstClear = kinds.has('challenge-first-clear');
    const hasChallengeRepeat = kinds.has('challenge-repeat-win');
    const expectedKind = hasChallengeFirstClear
      ? 'challenge-first-clear'
      : hasChallengeRepeat
        ? 'challenge-repeat-win'
        : null;
    if (receipt.challengeComponentKind !== expectedKind) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge component kind disagrees with the reward components',
      });
    }
    if (hasChallengeFirstClear !== receipt.challengeFirstClearGranted) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge first-clear component and grant flag disagree',
      });
    }
    if (receipt.challengeFirstClearGranted) {
      if (!receipt.challengeFirstClearEligible) {
        ctx.addIssue({ code: 'custom', message: 'challenge first clear needs prior eligibility' });
      }
      if (!receipt.playerWin || receipt.gameOutcome !== 'completed') {
        ctx.addIssue({
          code: 'custom',
          message: 'challenge first clear requires a completed player win',
        });
      }
    }
    if (hasChallengeRepeat && receipt.challengeFirstClearEligible) {
      ctx.addIssue({
        code: 'custom',
        message: 'a repeat component requires the challenge to have been cleared',
      });
    }
    if ((hasChallengeFirstClear || hasChallengeRepeat) && !receipt.playerWin) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge components require a player win',
      });
    }
  });
export type CollectionGameRewardReceiptV3 = z.infer<typeof collectionGameRewardReceiptV3Schema>;

export const collectionGameRewardReceiptUnionSchema = z.union([
  collectionGameRewardReceiptV3Schema,
  collectionGameRewardReceiptV2Schema,
]);
export type CollectionGameRewardReceiptUnion = z.infer<
  typeof collectionGameRewardReceiptUnionSchema
>;

export const collectionGameRewardReceiptSchema = collectionGameRewardReceiptV3Schema;
export type CollectionGameRewardReceipt = CollectionGameRewardReceiptV3;

export const collectionFirstClearStateSchema = z
  .object({
    clearedDifficultyIds: z.array(collectionDifficultyIdSchema).max(3),
  })
  .strict()
  .superRefine((state, ctx) => {
    const seen = new Set<string>();
    for (const difficultyId of state.clearedDifficultyIds) {
      if (seen.has(difficultyId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate cleared difficulty ${difficultyId}` });
      }
      seen.add(difficultyId);
    }
  });
export type CollectionFirstClearState = z.infer<typeof collectionFirstClearStateSchema>;
