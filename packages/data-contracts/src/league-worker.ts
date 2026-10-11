import { z } from 'zod';
import { opponentBracketCoreSchema } from './bracket.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { seedSchema } from './ids.ts';
import { leagueRecordSchema } from './league.ts';

export const LEAGUE_WORKER_WIRE_SCHEMA_VERSION = 1 as const;

export const leagueWorkerComputeRequestSchema = z.object({
  schemaVersion: z.literal(LEAGUE_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('compute'),
  requestId: z.string().min(1).max(64),
  seed: seedSchema,
  bracket: opponentBracketCoreSchema,
  profile: eraSimulationProfileSchema,
});
export type LeagueWorkerComputeRequest = z.infer<typeof leagueWorkerComputeRequestSchema>;

export const leagueWorkerCancelRequestSchema = z.object({
  schemaVersion: z.literal(LEAGUE_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('cancel'),
  requestId: z.string().min(1).max(64),
});
export type LeagueWorkerCancelRequest = z.infer<typeof leagueWorkerCancelRequestSchema>;

export const leagueWorkerRequestSchema = z.discriminatedUnion('type', [
  leagueWorkerComputeRequestSchema,
  leagueWorkerCancelRequestSchema,
]);
export type LeagueWorkerRequest = z.infer<typeof leagueWorkerRequestSchema>;

export const leagueWorkerProgressMessageSchema = z.object({
  schemaVersion: z.literal(LEAGUE_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('progress'),
  requestId: z.string().min(1).max(64),
  gamesDone: z.number().int().nonnegative(),
  gamesTotal: z.number().int().positive(),
});
export type LeagueWorkerProgressMessage = z.infer<typeof leagueWorkerProgressMessageSchema>;

export const leagueWorkerResultMessageSchema = z.object({
  schemaVersion: z.literal(LEAGUE_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('result'),
  requestId: z.string().min(1).max(64),
  record: leagueRecordSchema,
});
export type LeagueWorkerResultMessage = z.infer<typeof leagueWorkerResultMessageSchema>;

export const leagueWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(LEAGUE_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('error'),
  requestId: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});
export type LeagueWorkerErrorMessage = z.infer<typeof leagueWorkerErrorMessageSchema>;

export const leagueWorkerMessageSchema = z.discriminatedUnion('type', [
  leagueWorkerProgressMessageSchema,
  leagueWorkerResultMessageSchema,
  leagueWorkerErrorMessageSchema,
]);
export type LeagueWorkerMessage = z.infer<typeof leagueWorkerMessageSchema>;
