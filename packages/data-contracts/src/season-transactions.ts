import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';
function fitsIdSchema(value: string): boolean {
    return idSchema.safeParse(value).success;
}
export function deriveSeasonTransactionId(logicalId: string): string {
    if (fitsIdSchema(logicalId))
        return logicalId;
    return `txn-${seasonDigestHex(`season-txn\u0000${logicalId}`)}`;
}
export function deriveSeasonInfluenceEntryId(logicalId: string): string {
    if (fitsIdSchema(logicalId))
        return logicalId;
    return `inf-${seasonDigestHex(`season-inf\u0000${logicalId}`)}`;
}
export function normalizeSeasonTransactionEntry(entry: SeasonTransactionEntry): SeasonTransactionEntry {
    return {
        ...entry,
        transactionId: deriveSeasonTransactionId(entry.transactionId),
    };
}
export interface SeasonTransactionEntryInput {
    transactionId: string;
    commandId: string | null;
    franchiseId: string | null;
    type: SeasonTransactionType;
    blockIndex: number | null;
    appliedAtStateRevision: number;
    payload: Record<string, unknown>;
    explanation: string;
}
export function seasonTransactionEntry(input: SeasonTransactionEntryInput): SeasonTransactionEntry {
    return seasonTransactionEntrySchema.parse({
        ...input,
        transactionId: deriveSeasonTransactionId(input.transactionId),
    });
}
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
