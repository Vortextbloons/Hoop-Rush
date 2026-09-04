import { z } from 'zod';
export const GENERATION_WORKER_WIRE_SCHEMA_VERSION = 1 as const;
export const generationWorkerRequestSchema = z.looseObject({
    schemaVersion: z.literal(GENERATION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('generate'),
    requestId: z.string().min(1).max(64),
});
export const generationWorkerResponseSchema = z.discriminatedUnion('type', [
    z.looseObject({ type: z.literal('complete'), requestId: z.string().min(1).max(64) }),
    z.looseObject({
        type: z.literal('error'),
        requestId: z.string().min(1).max(64),
        message: z.string(),
    }),
]);
