import { z } from 'zod';
export const GENERATION_WORKER_WIRE_SCHEMA_VERSION = 2 as const;
export const generationWorkerRequestSchema = z.looseObject({
  schemaVersion: z.literal(GENERATION_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('generate'),
  requestId: z.string().min(1).max(64),
});
export const generationWorkerProgressSchema = z.looseObject({
  type: z.literal('progress'),
  requestId: z.string().min(1).max(64),
  phase: z.enum(['scouting', 'anchors', 'pool-fill', 'selection', 'rotations', 'done']),
  completed: z.number().int().min(0),
  total: z.number().int().min(1),
  teamsCompleted: z.array(z.string()).optional(),
});
export const generationWorkerResponseSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('complete'), requestId: z.string().min(1).max(64) }),
  z.looseObject({
    type: z.literal('error'),
    requestId: z.string().min(1).max(64),
    message: z.string(),
  }),
  generationWorkerProgressSchema,
]);
