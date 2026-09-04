import { z } from 'zod';
export const PROJECTION_WORKER_WIRE_SCHEMA_VERSION = 1 as const;
export const projectionRosterBuildRequestSchema = z.looseObject({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('build-roster'),
    requestId: z.string().min(1).max(64),
});
export const projectionRotationOptimizeRequestSchema = z.looseObject({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('optimize-rotation'),
    requestId: z.string().min(1).max(64),
});
export const projectionWorkerRequestSchema = z.discriminatedUnion('type', [
    projectionRosterBuildRequestSchema,
    projectionRotationOptimizeRequestSchema,
]);
export const projectionWorkerResponseSchema = z.discriminatedUnion('type', [
    z.looseObject({ type: z.literal('complete'), requestId: z.string().min(1).max(64) }),
    z.looseObject({
        type: z.literal('error'),
        requestId: z.string().min(1).max(64),
        message: z.string(),
    }),
]);
