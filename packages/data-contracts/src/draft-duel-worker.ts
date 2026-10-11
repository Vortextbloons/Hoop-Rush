import { z } from 'zod';
import { idSchema } from './ids.ts';
import { gameSimulationInputSchema } from './simulation.ts';
import { draftDuelGameOutputSchema } from './draft-duel.ts';
import { DRAFT_DUEL_WORKER_WIRE_VERSION } from './draft-duel-versions.ts';

export const draftDuelWorkerRequestSchema = z.object({
  schemaVersion: z.literal(DRAFT_DUEL_WORKER_WIRE_VERSION),
  kind: z.literal('draft-duel-game'),
  requestId: z.string().min(1).max(64),
  roomId: idSchema,
  input: gameSimulationInputSchema,
});
export type DraftDuelWorkerRequest = z.infer<typeof draftDuelWorkerRequestSchema>;
export const draftDuelWorkerResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(DRAFT_DUEL_WORKER_WIRE_VERSION),
    kind: z.literal('draft-duel-game'),
    requestId: z.string().min(1).max(64),
    output: draftDuelGameOutputSchema,
  }),
  z.object({
    schemaVersion: z.literal(DRAFT_DUEL_WORKER_WIRE_VERSION),
    kind: z.literal('draft-duel-error'),
    requestId: z.string().min(1).max(64),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  }),
]);
export type DraftDuelWorkerResponse = z.infer<typeof draftDuelWorkerResponseSchema>;
