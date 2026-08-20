import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema } from './ids.ts';

export const seasonTransactionTypeSchema = z.enum([
  'trade',
  'objective-reward',
  'campaign-reward',
  'trade-cash-sent',
  'trade-cash-received',
  'trade-inquiry-purchase',
  'block-grant',
  'influence-spend',
  'initial-grant',
  'free-agent-signing',
]);
export type SeasonTransactionType = z.infer<typeof seasonTransactionTypeSchema>;

export const seasonTransactionEntrySchema = z.object({
  transactionId: idSchema,

  commandId: commandIdSchema.nullable(),

  franchiseId: franchiseIdSchema.nullable(),
  type: seasonTransactionTypeSchema,

  blockIndex: z.number().int().min(0).max(8).nullable(),

  appliedAtStateRevision: z.number().int().nonnegative(),

  payload: z.record(z.string(), z.unknown()),

  explanation: z.string().min(1).max(512),
});
export type SeasonTransactionEntry = z.infer<typeof seasonTransactionEntrySchema>;

export const seasonTransactionLogSchema = z.object({
  schemaVersion: z.literal(1),
  transactions: z.array(seasonTransactionEntrySchema),
});
export type SeasonTransactionLog = z.infer<typeof seasonTransactionLogSchema>;
