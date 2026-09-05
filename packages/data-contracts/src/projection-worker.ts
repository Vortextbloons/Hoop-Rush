import { z } from 'zod';
import { seasonRotationSchema } from './season-rotation.ts';
export const PROJECTION_WORKER_WIRE_SCHEMA_VERSION = 2 as const;
export const PROJECTION_WORKER_WIRE_SCHEMA_VERSION_V1 = 1 as const;
const requestIdSchema = z.string().min(1).max(64);
const urlSchema = z.string().min(1).max(512);
const hashSchema = z.string().min(1).max(512);
const seedStringSchema = z.string().min(1).max(128);
export const projectionRotationLoadRowSchema = z
  .object({
    playerVersionId: z.string().min(1).max(128),
    staminaRating: z.number().int().min(0).max(100),
    durability: z.number().int().min(0).max(100),
    fatigueBasisPoints: z.number().int().nonnegative(),
    recentLoadBasisPoints: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectionRotationLoadRow = z.infer<typeof projectionRotationLoadRowSchema>;
export const projectionRosterBuildRequestSchema = z
  .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('build-roster'),
    requestId: requestIdSchema,
    catalogUrl: urlSchema,
    catalogHash: hashSchema,
    modelUrl: urlSchema,
    modelHash: hashSchema,
    eraProfileUrl: urlSchema,
    eraProfileHash: hashSchema,
    locked: z.array(z.string().min(1).max(128)),
    available: z.array(z.string().min(1).max(128)),
    seed: seedStringSchema,
    lens: z.unknown().optional(),
  })
  .strict();
export type ProjectionRosterBuildRequest = z.infer<typeof projectionRosterBuildRequestSchema>;
export const projectionRotationOptimizeRequestSchema = z
  .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('optimize-rotation'),
    requestId: requestIdSchema,
    catalogUrl: urlSchema,
    catalogHash: hashSchema,
    modelUrl: urlSchema,
    modelHash: hashSchema,
    eraProfileUrl: urlSchema,
    eraProfileHash: hashSchema,
    roster: z.array(z.string().min(1).max(128)).min(10).max(15),
    structure: seasonRotationSchema,
    load: z.array(projectionRotationLoadRowSchema).min(10).max(15),
    horizon: z.number().int().positive(),
    seed: seedStringSchema,
  })
  .strict();
export type ProjectionRotationOptimizeRequest = z.infer<
  typeof projectionRotationOptimizeRequestSchema
>;
export const projectionRotationRecommendRequestSchema = z
  .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('recommend-rotation'),
    requestId: requestIdSchema,
    catalogUrl: urlSchema,
    catalogHash: hashSchema,
    modelUrl: urlSchema.optional(),
    modelHash: hashSchema.optional(),
    eraProfileUrl: urlSchema,
    eraProfileHash: hashSchema,
    franchiseId: z.string().min(1).max(64),
    roster: z.array(z.string().min(1).max(128)).min(10).max(15),
    unavailable: z.array(z.string().min(1).max(128)).max(15),
    current: seasonRotationSchema,
    load: z.array(projectionRotationLoadRowSchema).min(10).max(15),
    overall: z
      .array(
        z
          .object({
            playerVersionId: z.string().min(1).max(128),
            overall: z.number().min(0).max(100),
          })
          .strict(),
      )
      .max(15),
    horizon: z.number().int().positive(),
    seed: seedStringSchema,
    scope: z.enum(['full', 'minutes-only']),
    keepActive10: z.boolean(),
  })
  .strict();
export type ProjectionRotationRecommendRequest = z.infer<
  typeof projectionRotationRecommendRequestSchema
>;
export const projectionWorkerRequestSchema = z.discriminatedUnion('type', [
  projectionRosterBuildRequestSchema,
  projectionRotationOptimizeRequestSchema,
  projectionRotationRecommendRequestSchema,
]);
export type ProjectionWorkerRequest = z.infer<typeof projectionWorkerRequestSchema>;
export const projectionLegacyRosterBuildRequestSchema = z.looseObject({
  schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION_V1),
  type: z.literal('build-roster'),
  requestId: requestIdSchema,
});
export const projectionLegacyRotationOptimizeRequestSchema = z.looseObject({
  schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION_V1),
  type: z.literal('optimize-rotation'),
  requestId: requestIdSchema,
});
export const projectionLegacyRotationRecommendRequestSchema = z.looseObject({
  schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION_V1),
  type: z.literal('recommend-rotation'),
  requestId: requestIdSchema,
});
export const projectionWorkerLegacyRequestSchema = z.discriminatedUnion('type', [
  projectionLegacyRosterBuildRequestSchema,
  projectionLegacyRotationOptimizeRequestSchema,
  projectionLegacyRotationRecommendRequestSchema,
]);
export const projectionWorkerCompleteResponseSchema = z
  .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION).optional(),
    type: z.literal('complete'),
    requestId: requestIdSchema,
    result: z.unknown(),
  })
  .strict();
export const projectionWorkerErrorResponseSchema = z
  .object({
    schemaVersion: z.literal(PROJECTION_WORKER_WIRE_SCHEMA_VERSION).optional(),
    type: z.literal('error'),
    requestId: requestIdSchema,
    message: z.string().min(1).max(1024),
  })
  .strict();
export const projectionWorkerResponseSchema = z.discriminatedUnion('type', [
  projectionWorkerCompleteResponseSchema,
  projectionWorkerErrorResponseSchema,
]);
export type ProjectionWorkerResponse = z.infer<typeof projectionWorkerResponseSchema>;
export function isLiveProjectionWorkerRequest(request: { schemaVersion: number }): boolean {
  return request.schemaVersion === PROJECTION_WORKER_WIRE_SCHEMA_VERSION;
}
export const LIVE_PROJECTION_WORKER_VERSION_MESSAGE =
  'projection worker message uses an outdated wire version (expected v2); discard and retry with the current worker';
