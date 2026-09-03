import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { simulationPlayerSchema } from './simulation.ts';
import { opponentBracketCoreSchema } from './bracket.ts';
import { FIXED_FIVE_WORKER_WIRE_VERSION } from './fixed-five-versions.ts';

export const fixedFiveWorkerTeamSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  players: z.array(simulationPlayerSchema).length(5),
});
export type FixedFiveWorkerTeam = z.infer<typeof fixedFiveWorkerTeamSchema>;

export const fixedFiveWorkerShared82RequestSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-shared-82'),
  requestId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  p1Team: fixedFiveWorkerTeamSchema,
  p2Team: fixedFiveWorkerTeamSchema,
  bracket: opponentBracketCoreSchema,
  profile: eraSimulationProfileSchema,
  dataVersion: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  startGameNumber: z.number().int().min(1).max(82).default(1),
});
export type FixedFiveWorkerShared82Request = z.infer<typeof fixedFiveWorkerShared82RequestSchema>;

export const fixedFiveWorkerDuelRequestSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-duel'),
  requestId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  p1Team: fixedFiveWorkerTeamSchema,
  p2Team: fixedFiveWorkerTeamSchema,
  profile: eraSimulationProfileSchema,
  dataVersion: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
});
export type FixedFiveWorkerDuelRequest = z.infer<typeof fixedFiveWorkerDuelRequestSchema>;

export const fixedFiveWorkerCancelSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-cancel'),
  requestId: z.string().min(1).max(64),
});
export type FixedFiveWorkerCancel = z.infer<typeof fixedFiveWorkerCancelSchema>;

export const fixedFiveWorkerRequestSchema = z.discriminatedUnion('type', [
  fixedFiveWorkerShared82RequestSchema,
  fixedFiveWorkerDuelRequestSchema,
  fixedFiveWorkerCancelSchema,
]);
export type FixedFiveWorkerRequest = z.infer<typeof fixedFiveWorkerRequestSchema>;

export const fixedFiveWorkerProgressSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-progress'),
  requestId: z.string().min(1).max(64),
  completedGames: z.number().int().nonnegative(),
  totalGames: z.number().int().positive(),
});
export type FixedFiveWorkerProgress = z.infer<typeof fixedFiveWorkerProgressSchema>;

export const fixedFiveWorkerCompleteSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-complete'),
  requestId: z.string().min(1).max(64),
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
});
export type FixedFiveWorkerComplete = z.infer<typeof fixedFiveWorkerCompleteSchema>;

export const fixedFiveWorkerErrorSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-error'),
  requestId: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});
export type FixedFiveWorkerError = z.infer<typeof fixedFiveWorkerErrorSchema>;

export const fixedFiveWorkerMessageSchema = z.discriminatedUnion('type', [
  fixedFiveWorkerProgressSchema,
  fixedFiveWorkerCompleteSchema,
  fixedFiveWorkerErrorSchema,
]);
export type FixedFiveWorkerMessage = z.infer<typeof fixedFiveWorkerMessageSchema>;

export const FIXED_FIVE_WORKER_PROGRESS_MIN_INTERVAL_MS = 250;
