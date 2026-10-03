import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonDraftCatalogSchema } from './season-draft-catalog.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { seasonRosterTargetsSchema, seasonLeagueGenerationResultSchema } from './season-ai.ts';
export const GENERATION_WORKER_WIRE_SCHEMA_VERSION = 2 as const;
export const generationWorkerHumanRosterSchema = z.object({
  franchiseId: franchiseIdSchema,
  playerVersionIds: z.array(playerVersionIdSchema).min(1).max(10),
});
export const generationWorkerInputSchema = z.object({
  seed: seedSchema,
  catalog: seasonDraftCatalogSchema,
  league: seasonLeagueSchema,
  humanFranchiseIds: z.array(franchiseIdSchema).min(1).max(2),
  humanRosters: z.array(generationWorkerHumanRosterSchema).min(1).max(2),
});
export const generationWorkerRequestSchema = z.object({
  schemaVersion: z.literal(GENERATION_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('generate'),
  requestId: z.string().min(1).max(64),
  input: generationWorkerInputSchema,
  targets: seasonRosterTargetsSchema,
});
export const generationWorkerProgressSchema = z.object({
  type: z.literal('progress'),
  requestId: z.string().min(1).max(64),
  phase: z.enum(['scouting', 'anchors', 'pool-fill', 'selection', 'rotations', 'done']),
  completed: z.number().int().min(0),
  total: z.number().int().min(1),
  teamsCompleted: z.array(z.string()).optional(),
});
export const generationWorkerCompleteSchema = z.object({
  type: z.literal('complete'),
  requestId: z.string().min(1).max(64),
  generation: seasonLeagueGenerationResultSchema,
});
export const generationWorkerErrorSchema = z.object({
  type: z.literal('error'),
  requestId: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});
export const generationWorkerResponseSchema = z.discriminatedUnion('type', [
  generationWorkerCompleteSchema,
  generationWorkerErrorSchema,
  generationWorkerProgressSchema,
]);
