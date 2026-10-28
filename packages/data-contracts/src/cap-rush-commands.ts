import { z } from 'zod';
import { commandIdSchema, idSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import {
  CAP_RUSH_SCHEMA_VERSION,
  capRushDigestSchema,
  capRushVersionSetSchema,
  capRushVariantSchema,
} from './cap-rush-versions.ts';
import {
  capRushCatalogSourceSchema,
  capRushCardIdSchema,
  capRushOfferIdSchema,
} from './cap-rush-draft.ts';

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

export const capRushCommandSchema = z.discriminatedUnion('command', [
  capRushCreateDraftCommandSchema,
  capRushChoosePositionCommandSchema,
  capRushRerollOfferCommandSchema,
  capRushSignCardCommandSchema,
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
  'catalog-mismatch',
  'generation-failed',
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
