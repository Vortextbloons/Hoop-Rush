import { z } from 'zod';
import { idSchema } from './ids.ts';
import { havocDigestSchema } from './havoc-versions.ts';
import {
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
} from './havoc-battle.ts';
import {
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
} from './havoc-multiplayer-versions.ts';

export const havocMultiplayerWorkerRequestSchema = z.object({
  schemaVersion: z.literal(HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('havoc-multiplayer-game'),
  requestId: z.string().min(1).max(64),
  roomId: idSchema,
  gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
  input: havocBattleInputSchema,
});
export type HavocMultiplayerWorkerRequest = z.infer<typeof havocMultiplayerWorkerRequestSchema>;

export const havocMultiplayerWorkerGameOutputSchema = z.object({
  result: havocBattleResultSchema,
  tape: havocBattleTapeSchema,
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  tapeDigest: havocDigestSchema,
});
export type HavocMultiplayerWorkerGameOutput = z.infer<
  typeof havocMultiplayerWorkerGameOutputSchema
>;

export const havocMultiplayerWorkerResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
    kind: z.literal('havoc-multiplayer-game'),
    requestId: z.string().min(1).max(64),
    output: havocMultiplayerWorkerGameOutputSchema,
  }),
  z.object({
    schemaVersion: z.literal(HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
    kind: z.literal('havoc-multiplayer-error'),
    requestId: z.string().min(1).max(64),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  }),
]);
export type HavocMultiplayerWorkerResponse = z.infer<typeof havocMultiplayerWorkerResponseSchema>;
