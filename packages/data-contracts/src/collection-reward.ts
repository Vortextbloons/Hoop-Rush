import { z } from 'zod';
import { COLLECTION_REWARD_VERSION } from './collection-versions.ts';
import { collectionDifficultyIdSchema } from './collection-difficulty.ts';
import { collectionObjectiveIdSchema } from './collection-objective.ts';

export const collectionRewardComponentKindSchema = z.enum([
  'outcome',
  'objective',
  'margin',
  'first-clear',
]);
export type CollectionRewardComponentKind = z.infer<typeof collectionRewardComponentKindSchema>;

export const collectionRewardReasonSchema = z.enum([
  'game-win-reward',
  'game-loss-reward',
  'game-objective-reward',
  'game-margin-reward',
  'game-first-clear-reward',
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
  })
  .strict()
  .superRefine((component, ctx) => {
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
  });
export type CollectionRewardComponent = z.infer<typeof collectionRewardComponentSchema>;

export const collectionGameRewardReceiptSchema = z
  .object({
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    difficultyId: collectionDifficultyIdSchema,
    gameOutcome: z.enum(['completed', 'forfeit']),
    playerWin: z.boolean(),
    scoreMargin: z.number().int().nonnegative().nullable(),
    objectiveId: collectionObjectiveIdSchema.nullable(),
    objectiveSucceeded: z.boolean(),
    firstClearEligible: z.boolean(),
    firstClearGranted: z.boolean(),
    components: z.array(collectionRewardComponentSchema).min(1),
    total: z.number().int().positive(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
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
export type CollectionGameRewardReceipt = z.infer<typeof collectionGameRewardReceiptSchema>;

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
