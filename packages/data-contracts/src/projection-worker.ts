import { z } from 'zod';
export const PROJECTION_WORKER_WIRE_SCHEMA_VERSION = 1 as const;
export const projectionRosterBuildRequestSchema = z
    .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('build-roster'),
    requestId: z.string().min(1).max(64),
})
    .passthrough();
export const projectionRotationOptimizeRequestSchema = z
    .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('optimize-rotation'),
    requestId: z.string().min(1).max(64),
})
    .passthrough();
export const projectionWorkerRequestSchema = z.discriminatedUnion('type', [
    projectionRosterBuildRequestSchema,
    projectionRotationOptimizeRequestSchema,
]);
export const projectionWorkerResponseSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('complete'), requestId: z.string().min(1).max(64) }).passthrough(),
    z
        .object({ type: z.literal('error'), requestId: z.string().min(1).max(64), message: z.string() })
        .passthrough(),
]);
