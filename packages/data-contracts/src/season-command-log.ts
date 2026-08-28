import { z } from 'zod';
import { idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { seasonRunCommandSchema } from './season-commands.ts';
import { SEASON_COMMAND_LOG_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';
export const seasonCommandActorSourceSchema = z.enum(['human', 'timeout-default', 'ai-takeover']);
export type SeasonCommandActorSource = z.infer<typeof seasonCommandActorSourceSchema>;
export const seasonCommandActorSchema = z.object({
    participantId: z.enum(['p1', 'p2']).nullable(),
    franchiseId: z.string().min(1).max(64).nullable(),
    source: seasonCommandActorSourceSchema,
});
export type SeasonCommandActor = z.infer<typeof seasonCommandActorSchema>;
export const seasonCommandLogEntrySchema = z
    .object({
    runId: z.string().min(1).max(64),
    ordinal: z.number().int().nonnegative(),
    command: seasonRunCommandSchema,
    preStateRevision: z.number().int().nonnegative(),
    preStateDigest: seasonCheckpointDigestSchema,
    postStateRevision: z.number().int().nonnegative(),
    postStateDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    previousLogDigest: seasonCheckpointDigestSchema,
    relatedGameIds: z.array(z.string().min(1).max(64)),
    transactionIds: z.array(idSchema),
    actor: seasonCommandActorSchema.optional(),
})
    .superRefine((entry, ctx) => {
    if (entry.command.runId !== entry.runId) {
        ctx.addIssue({
            code: 'custom',
            message: 'the command payload must target the log run',
        });
    }
    if (entry.preStateRevision > entry.postStateRevision) {
        ctx.addIssue({
            code: 'custom',
            message: 'postStateRevision must not regress below preStateRevision',
        });
    }
});
export type SeasonCommandLogEntry = z.infer<typeof seasonCommandLogEntrySchema>;
export const seasonCommandLogSchema = z.object({
    schemaVersion: z.literal(1),
    commandLogVersion: z.union([
        z.literal(SEASON_COMMAND_LOG_VERSION),
        z.literal('command-log-v1'),
    ]),
    runId: z.string().min(1).max(64),
    entries: z.array(seasonCommandLogEntrySchema),
});
export type SeasonCommandLog = z.infer<typeof seasonCommandLogSchema>;
export const SEASON_EMPTY_COMMAND_LOG_DIGEST = seasonDigestHex(canonicalJson([]));
export function seasonCommandLogDigest(entries: readonly SeasonCommandLogEntry[]): string {
    return seasonDigestHex(canonicalJson(entries));
}
export function seasonCommandResultDigest(facts: {
    commandId: string;
    gameIds: readonly string[];
    summaryDigests: readonly string[];
}): string {
    return seasonDigestHex(canonicalJson({
        commandId: facts.commandId,
        gameIds: [...facts.gameIds].sort(),
        summaryDigests: [...facts.summaryDigests].sort(),
    }));
}
