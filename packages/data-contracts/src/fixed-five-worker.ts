import { z } from 'zod';
import { contentHashSchema, idSchema, seedSchema } from './ids.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { gameResultSchema } from './result.ts';
import { simulationPlayerSchema } from './simulation.ts';
import { opponentBracketCoreSchema, opponentBracketSchema } from './bracket.ts';
import { FIXED_FIVE_WORKER_WIRE_VERSION } from './fixed-five-versions.ts';
import {
  fixedFiveCommandSchema,
  fixedFiveCompetitionResultSchema,
  fixedFiveLineupEntrySchema,
  fixedFiveVerificationReceiptSchema,
  fixedFiveVersionLocksSchema,
} from './fixed-five-multiplayer.ts';
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
export const fixedFiveWorkerVerifyRequestSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-verify'),
  requestId: z.string().min(1).max(64),
  roomId: idSchema,
  competition: z.enum(['shared-82', 'duel']),
  rootSeed: seedSchema,
  versions: fixedFiveVersionLocksSchema,
  challenge: z.string().min(1).max(256),
  acceptedCommands: z.array(fixedFiveCommandSchema),
  lineups: z.object({
    p1: fixedFiveLineupEntrySchema,
    p2: fixedFiveLineupEntrySchema,
  }),
  result: fixedFiveCompetitionResultSchema,
  resultDigest: contentHashSchema,
  bracket: opponentBracketSchema,
  profile: eraSimulationProfileSchema,
  dataVersion: z.string().min(1).max(64),
});
export type FixedFiveWorkerVerifyRequest = z.infer<typeof fixedFiveWorkerVerifyRequestSchema>;
export const fixedFiveWorkerRequestSchema = z.discriminatedUnion('type', [
  fixedFiveWorkerShared82RequestSchema,
  fixedFiveWorkerDuelRequestSchema,
  fixedFiveWorkerVerifyRequestSchema,
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
export const fixedFiveWorkerResultTagSchema = z.enum(['p1', 'p2', 'h2h', 'duel']);
export type FixedFiveWorkerResultTag = z.infer<typeof fixedFiveWorkerResultTagSchema>;
export const fixedFiveWorkerResultEntrySchema = z.object({
  tag: fixedFiveWorkerResultTagSchema,
  game: gameResultSchema,
});
export type FixedFiveWorkerResultEntry = z.infer<typeof fixedFiveWorkerResultEntrySchema>;
export const fixedFiveWorkerResultsSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-results'),
  requestId: z.string().min(1).max(64),
  entries: z.array(fixedFiveWorkerResultEntrySchema).min(1).max(8),
});
export type FixedFiveWorkerResults = z.infer<typeof fixedFiveWorkerResultsSchema>;
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
export const fixedFiveWorkerVerifiedSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-verified'),
  requestId: z.string().min(1).max(64),
  receipt: fixedFiveVerificationReceiptSchema,
});
export type FixedFiveWorkerVerified = z.infer<typeof fixedFiveWorkerVerifiedSchema>;
export const fixedFiveWorkerVerificationFailedSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_WORKER_WIRE_VERSION),
  type: z.literal('fixed-five-verification-failed'),
  requestId: z.string().min(1).max(64),
  failures: z.array(z.string().min(1).max(1024)).min(1),
});
export type FixedFiveWorkerVerificationFailed = z.infer<
  typeof fixedFiveWorkerVerificationFailedSchema
>;
export const fixedFiveWorkerMessageSchema = z.discriminatedUnion('type', [
  fixedFiveWorkerProgressSchema,
  fixedFiveWorkerResultsSchema,
  fixedFiveWorkerCompleteSchema,
  fixedFiveWorkerErrorSchema,
  fixedFiveWorkerVerifiedSchema,
  fixedFiveWorkerVerificationFailedSchema,
]);
export type FixedFiveWorkerMessage = z.infer<typeof fixedFiveWorkerMessageSchema>;
export const FIXED_FIVE_WORKER_PROGRESS_MIN_INTERVAL_MS = 250;
