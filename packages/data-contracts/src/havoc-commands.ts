import { z } from 'zod';
import { commandIdSchema, idSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import {
  HAVOC_SCHEMA_VERSION,
  havocDigestSchema,
  havocVersionSetSchema,
} from './havoc-versions.ts';
import { havocCardIdSchema, havocCatalogSourceSchema, havocOfferIdSchema } from './havoc-draft.ts';
import { havocGameSummarySchema } from './havoc-game.ts';
import { havocMvpSchema } from './havoc-comparison.ts';

export const havocRevisionedCommandBaseSchema = z.object({
  schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type HavocRevisionedCommandBase = z.infer<typeof havocRevisionedCommandBaseSchema>;

export const havocCreateDraftCommandSchema = z.object({
  schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
  commandId: commandIdSchema,
  runId: idSchema,
  command: z.literal('create-havoc-draft'),
  runSeed: seedSchema,
  versionSet: havocVersionSetSchema,
  catalog: havocCatalogSourceSchema,
});
export type HavocCreateDraftCommand = z.infer<typeof havocCreateDraftCommandSchema>;

export const havocRerollOfferCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('reroll-havoc-offer'),
  offerId: havocOfferIdSchema,
});
export type HavocRerollOfferCommand = z.infer<typeof havocRerollOfferCommandSchema>;

export const havocPickCardCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('pick-havoc-card'),
  offerId: havocOfferIdSchema,
  cardId: havocCardIdSchema,
});
export type HavocPickCardCommand = z.infer<typeof havocPickCardCommandSchema>;

export const havocLockLineupCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('lock-havoc-lineup'),
  picks: z
    .array(
      z.object({
        slot: positionSchema,
        cardId: havocCardIdSchema,
      }),
    )
    .length(5),
});
export type HavocLockLineupCommand = z.infer<typeof havocLockLineupCommandSchema>;

export const havocAcceptGameCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('accept-havoc-game'),
  cursor: z.number().int().min(1).max(82),
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  summary: havocGameSummarySchema,
});
export type HavocAcceptGameCommand = z.infer<typeof havocAcceptGameCommandSchema>;

export const havocAcceptNormalGameCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('accept-havoc-normal-game'),
  cursor: z.number().int().min(1).max(82),
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  summary: havocGameSummarySchema,
});
export type HavocAcceptNormalGameCommand = z.infer<typeof havocAcceptNormalGameCommandSchema>;

export const havocCompleteComparisonCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('complete-havoc-comparison'),
  comparisonDigest: havocDigestSchema,
  reportDigest: havocDigestSchema,
  mvp: havocMvpSchema,
});
export type HavocCompleteComparisonCommand = z.infer<typeof havocCompleteComparisonCommandSchema>;

export const havocAbandonRunCommandSchema = havocRevisionedCommandBaseSchema.extend({
  command: z.literal('abandon-havoc-run'),
});
export type HavocAbandonRunCommand = z.infer<typeof havocAbandonRunCommandSchema>;

export const havocCommandSchema = z.discriminatedUnion('command', [
  havocCreateDraftCommandSchema,
  havocRerollOfferCommandSchema,
  havocPickCardCommandSchema,
  havocLockLineupCommandSchema,
  havocAcceptGameCommandSchema,
  havocAcceptNormalGameCommandSchema,
  havocCompleteComparisonCommandSchema,
  havocAbandonRunCommandSchema,
]);
export type HavocCommand = z.infer<typeof havocCommandSchema>;
export type HavocCommandKind = HavocCommand['command'];

export const havocCommandRejectionCodeSchema = z.enum([
  'duplicate-command',
  'stale-revision',
  'run-mismatch',
  'not-a-draft',
  'not-drafting',
  'offer-mismatch',
  'unknown-card',
  'card-unavailable',
  'illegal-claim',
  'illegal-position',
  'reroll-spent',
  'incomplete-lineup',
  'cursor-mismatch',
  'phase-mismatch',
  'digest-mismatch',
  'audit-failed',
  'version-mismatch',
  'already-complete',
]);
export type HavocCommandRejectionCode = z.infer<typeof havocCommandRejectionCodeSchema>;

export const havocCommandRejectionSchema = z.object({
  code: havocCommandRejectionCodeSchema,
  message: z.string().min(1).max(512),
});
export type HavocCommandRejection = z.infer<typeof havocCommandRejectionSchema>;

export const havocCommandResultSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
    commandId: commandIdSchema,
    runId: idSchema,
    status: z.enum(['accepted', 'rejected']),
    revisionBefore: z.number().int().nonnegative(),
    revisionAfter: z.number().int().nonnegative(),
    stateDigest: havocDigestSchema,
    rejection: havocCommandRejectionSchema.nullable(),
  })
  .superRefine((result, ctx) => {
    if (result.status === 'accepted' && result.rejection !== null) {
      ctx.addIssue({ code: 'custom', message: 'accepted commands carry no rejection' });
    }
    if (result.status === 'rejected' && result.rejection === null) {
      ctx.addIssue({ code: 'custom', message: 'rejected commands require a rejection' });
    }
  });
export type HavocCommandResult = z.infer<typeof havocCommandResultSchema>;
