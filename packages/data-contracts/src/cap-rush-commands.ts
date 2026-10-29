import { z } from 'zod';
import { commandIdSchema, idSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import {
  CAP_RUSH_DRAFT_ROUNDS,
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_SCHEMA_VERSION,
  capRushCardIdSchema,
  capRushDigestSchema,
  capRushOfferIdSchema,
  capRushSpinPurchaseSchema,
  capRushVersionSetSchema,
  capRushVariantSchema,
} from './cap-rush-versions.ts';
import { capRushCatalogSourceSchema } from './cap-rush-versions.ts';
import { capRushGameSummarySchema } from './cap-rush-season.ts';

export const capRushCreateDraftCommandSchema = z.object({
  command: z.literal('create-cap-rush-draft'),
  commandId: commandIdSchema,
  runId: idSchema,
  runSeed: seedSchema,
  variant: capRushVariantSchema,
  versionSet: capRushVersionSetSchema,
  catalog: capRushCatalogSourceSchema,
});
export type CapRushCreateDraftCommand = z.infer<typeof capRushCreateDraftCommandSchema>;

export const capRushChoosePositionCommandSchema = z.object({
  command: z.literal('choose-cap-rush-position'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  slot: positionSchema,
});
export type CapRushChoosePositionCommand = z.infer<typeof capRushChoosePositionCommandSchema>;

export const capRushRerollOfferCommandSchema = z.object({
  command: z.literal('reroll-cap-rush-offer'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  offerId: capRushOfferIdSchema,
  protectedCardId: capRushCardIdSchema,
});
export type CapRushRerollOfferCommand = z.infer<typeof capRushRerollOfferCommandSchema>;

export const capRushSignCardCommandSchema = z.object({
  command: z.literal('sign-cap-rush-card'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  offerId: capRushOfferIdSchema,
  cardId: capRushCardIdSchema,
});
export type CapRushSignCardCommand = z.infer<typeof capRushSignCardCommandSchema>;

export const capRushPurchaseSpinCommandSchema = z.object({
  command: z.literal('purchase-cap-rush-spin'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  purchase: capRushSpinPurchaseSchema,
  targetCardId: capRushCardIdSchema,
});
export type CapRushPurchaseSpinCommand = z.infer<typeof capRushPurchaseSpinCommandSchema>;

export const capRushSkipSpinCommandSchema = z.object({
  command: z.literal('skip-cap-rush-spin'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type CapRushSkipSpinCommand = z.infer<typeof capRushSkipSpinCommandSchema>;

export const capRushLockLineupCommandSchema = z.object({
  command: z.literal('lock-cap-rush-lineup'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  picks: z
    .array(
      z.object({
        slot: positionSchema,
        cardId: capRushCardIdSchema,
      }),
    )
    .length(CAP_RUSH_DRAFT_ROUNDS),
});
export type CapRushLockLineupCommand = z.infer<typeof capRushLockLineupCommandSchema>;

export const capRushAcceptGameCommandSchema = z.object({
  command: z.literal('accept-cap-rush-game'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  cursor: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  inputDigest: capRushDigestSchema,
  resultDigest: capRushDigestSchema,
  isolations: z.number().int().nonnegative(),
  strikes: z.number().int().nonnegative(),
  summary: capRushGameSummarySchema,
});
export type CapRushAcceptGameCommand = z.infer<typeof capRushAcceptGameCommandSchema>;

export const capRushFinalizeSeasonCommandSchema = z.object({
  command: z.literal('finalize-cap-rush-season'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type CapRushFinalizeSeasonCommand = z.infer<typeof capRushFinalizeSeasonCommandSchema>;

export const capRushAbandonCommandSchema = z.object({
  command: z.literal('abandon-cap-rush-run'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type CapRushAbandonCommand = z.infer<typeof capRushAbandonCommandSchema>;

export const capRushCommandSchema = z.discriminatedUnion('command', [
  capRushCreateDraftCommandSchema,
  capRushChoosePositionCommandSchema,
  capRushRerollOfferCommandSchema,
  capRushSignCardCommandSchema,
  capRushPurchaseSpinCommandSchema,
  capRushSkipSpinCommandSchema,
  capRushLockLineupCommandSchema,
  capRushAcceptGameCommandSchema,
  capRushFinalizeSeasonCommandSchema,
  capRushAbandonCommandSchema,
]);
export type CapRushCommand = z.infer<typeof capRushCommandSchema>;

export const capRushCommandRejectionCodeSchema = z.enum([
  'run-mismatch',
  'stale-revision',
  'phase-mismatch',
  'position-taken',
  'offer-mismatch',
  'card-unknown',
  'reroll-spent',
  'protected-card-required',
  'budget-rejected',
  'spin-unavailable',
  'spin-ineligible',
  'target-unknown',
  'catalog-mismatch',
  'generation-failed',
  'incomplete-lineup',
  'already-locked',
  'not-locked',
  'stale-cursor',
  'digest-mismatch',
  'season-complete',
  'abandoned',
]);
export type CapRushCommandRejectionCode = z.infer<typeof capRushCommandRejectionCodeSchema>;

export const capRushCommandResultSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
  commandId: commandIdSchema,
  runId: idSchema,
  status: z.enum(['accepted', 'rejected']),
  revisionBefore: z.number().int().nonnegative(),
  revisionAfter: z.number().int().nonnegative(),
  stateDigest: capRushDigestSchema,
  rejection: z
    .object({
      code: capRushCommandRejectionCodeSchema,
      message: z.string().min(1).max(320),
    })
    .nullable(),
});
export type CapRushCommandResult = z.infer<typeof capRushCommandResultSchema>;
