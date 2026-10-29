import { z } from 'zod';
import {
  commandIdSchema,
  contentHashSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seedSchema,
} from './ids.ts';
import { classicVariantSchema } from './classic.ts';
import { gameResultSchema } from './result.ts';
import { gameTapeEventSchema } from './game-tape.ts';
import { lineupSchema } from './lineup.ts';
import { simulationPlayerSchema } from './simulation.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { CLASSIC_ROLL_VERSION } from './versions.ts';
import {
  FIXED_FIVE_DUEL_TAPE_VERSION,
  FIXED_FIVE_MULTIPLAYER_VERSION,
} from './fixed-five-versions.ts';
export {
  FIXED_FIVE_ROOM_SCHEMA_VERSION,
  FIXED_FIVE_ROOM_PROTOCOL_VERSION,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  FIXED_FIVE_AUTOPICK_VERSION,
  FIXED_FIVE_WORKER_WIRE_VERSION,
  FIXED_FIVE_ENVELOPE_MAX_BYTES,
  FIXED_FIVE_CODE_TTL_MS,
  FIXED_FIVE_ROOM_RETENTION_MS,
  FIXED_FIVE_CLASSIC_PICK_TIMEOUT_MS,
  FIXED_FIVE_DUEL_PICK_TIMEOUT_MS,
  FIXED_FIVE_SANDBOX_BUILD_TIMEOUT_MS,
  FIXED_FIVE_DUEL_BROADCAST_MS,
  FIXED_FIVE_DUEL_GAME_READY_TIMEOUT_MS,
  FIXED_FIVE_DUEL_GAME_RESULTS_HOLD_MS,
  FIXED_FIVE_DUEL_TAPE_VERSION,
} from './fixed-five-versions.ts';
export const fixedFiveRoomModeSchema = z.enum(['classic-shared-82', 'sandbox-shared-82', 'duel']);
export type FixedFiveRoomMode = z.infer<typeof fixedFiveRoomModeSchema>;
export const fixedFiveSourceModeSchema = z.enum(['classic', 'sandbox']);
export type FixedFiveSourceMode = z.infer<typeof fixedFiveSourceModeSchema>;
export const fixedFiveRoomPhaseSchema = z.enum([
  'lobby',
  'drafting',
  'simulating',
  'preparing-game',
  'broadcasting',
  'game-results',
  'awaiting-confirmation',
  'completed',
  'integrity-failed',
  'expired',
]);
export type FixedFiveRoomPhase = z.infer<typeof fixedFiveRoomPhaseSchema>;
export const fixedFiveParticipantIdSchema = z.enum(['p1', 'p2']);
export type FixedFiveParticipantId = z.infer<typeof fixedFiveParticipantIdSchema>;
export const fixedFiveRoomCodeSchema = z.string().regex(/^[0-9]{4}$/);
export type FixedFiveRoomCode = z.infer<typeof fixedFiveRoomCodeSchema>;
export const fixedFiveVersionLocksSchema = z.object({
  dataVersion: z.string().min(1).max(64),
  ratingVersion: z.string().min(1).max(64),
  positionNormalizationVersion: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  seedDerivationVersion: z.string().min(1).max(64),
  classicRollVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  multiplayerVersion: z.string().min(1).max(64),
  autopickVersion: z.string().min(1).max(64),
});
export type FixedFiveVersionLocks = z.infer<typeof fixedFiveVersionLocksSchema>;
export function defaultFixedFiveVersionLocks(
  overrides: Partial<FixedFiveVersionLocks>,
): FixedFiveVersionLocks {
  return {
    dataVersion: overrides.dataVersion ?? 'unknown',
    ratingVersion: overrides.ratingVersion ?? 'unknown',
    positionNormalizationVersion: overrides.positionNormalizationVersion ?? 'unknown',
    engineVersion: overrides.engineVersion ?? 'unknown',
    bracketVersion: overrides.bracketVersion ?? 'unknown',
    scheduleVersion: overrides.scheduleVersion ?? 'schedule-v1',
    seedDerivationVersion: overrides.seedDerivationVersion ?? 'seed-v1',
    classicRollVersion: overrides.classicRollVersion ?? CLASSIC_ROLL_VERSION,
    profileVersion: overrides.profileVersion ?? 'unknown',
    multiplayerVersion: overrides.multiplayerVersion ?? FIXED_FIVE_MULTIPLAYER_VERSION,
    autopickVersion: overrides.autopickVersion ?? 'fixed-five-autopick-v1',
  };
}
export const fixedFiveRoomSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  mode: fixedFiveRoomModeSchema,
  sourceMode: fixedFiveSourceModeSchema,
  variant: classicVariantSchema,
  timerPolicyVersion: z.literal('fixed-five-autopick-v1'),
  versions: fixedFiveVersionLocksSchema,
});
export type FixedFiveRoomSettings = z.infer<typeof fixedFiveRoomSettingsSchema>;
export const fixedFiveReadyPayloadSchema = z.object({
  kind: z.literal('ready'),
  ready: z.boolean(),
});
export const fixedFiveStartPayloadSchema = z.object({
  kind: z.literal('start'),
});
export const fixedFiveRerollPayloadSchema = z.object({
  kind: z.literal('reroll'),
  axis: z.enum(['franchise', 'era']),
});
export const fixedFiveClassicPickPayloadSchema = z.object({
  kind: z.literal('classic-pick'),
  playerId: playerIdSchema,
  slotIndex: z.number().int().min(0).max(4),
});
export const fixedFiveClassicRepositionPayloadSchema = z.object({
  kind: z.literal('classic-reposition'),
  playerId: playerIdSchema,
  slotIndex: z.number().int().min(0).max(4),
});
export const fixedFiveDuelClaimPayloadSchema = z.object({
  kind: z.literal('duel-claim'),
  playerId: playerIdSchema,
  slotIndex: z.number().int().min(0).max(4),
  franchiseId: franchiseIdSchema,
  eraId: z.string().min(1).max(64),
});
export const fixedFiveDuelRepositionPayloadSchema = z.object({
  kind: z.literal('duel-reposition'),
  playerId: playerIdSchema,
  slotIndex: z.number().int().min(0).max(4),
});
export const fixedFiveSandboxPlacePayloadSchema = z.object({
  kind: z.literal('sandbox-place'),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.optional(),
  slotIndex: z.number().int().min(0).max(4),
});
export const fixedFiveSandboxRepositionPayloadSchema = z.object({
  kind: z.literal('sandbox-reposition'),
  playerId: playerIdSchema,
  slotIndex: z.number().int().min(0).max(4),
});
export const fixedFiveSandboxRemovePayloadSchema = z.object({
  kind: z.literal('sandbox-remove'),
  slotIndex: z.number().int().min(0).max(4),
});
export const fixedFiveSandboxLockPayloadSchema = z.object({
  kind: z.literal('sandbox-lock'),
});
export const fixedFiveTimeoutAutopickPayloadSchema = z.object({
  kind: z.literal('timeout-autopick'),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.optional(),
  slotIndex: z.number().int().min(0).max(4),
  pickOrdinal: z.number().int().nonnegative(),
  seedPath: z.string().min(1).max(256),
});
export const fixedFiveReadyNextGamePayloadSchema = z.object({
  kind: z.literal('ready-next-game'),
  gameNumber: z.number().int().min(1).max(7),
  ready: z.boolean(),
});
export const fixedFiveBroadcastStartPayloadSchema = z.object({
  kind: z.literal('broadcast-start'),
  gameNumber: z.number().int().min(1).max(82),
  eligibleGameNumbers: z.array(z.number().int().min(1).max(82)).min(1).max(82).optional(),
  auto: z.boolean().optional(),
});
export const fixedFiveProposeGameResultPayloadSchema = z.object({
  kind: z.literal('propose-game-result'),
  gameNumber: z.number().int().min(1).max(82),
  winner: fixedFiveParticipantIdSchema,
  resultDigest: contentHashSchema,
  tapeDigest: contentHashSchema,
  inputDigest: contentHashSchema,
});
export const fixedFiveConfirmGameResultPayloadSchema = z.object({
  kind: z.literal('confirm-game-result'),
  gameNumber: z.number().int().min(1).max(82),
  resultDigest: contentHashSchema,
  verified: z.boolean(),
});
export const fixedFiveProposeResultPayloadSchema = z.object({
  kind: z.literal('propose-result'),
  resultDigest: contentHashSchema,
});
export const fixedFiveConfirmResultPayloadSchema = z.object({
  kind: z.literal('confirm-result'),
  resultDigest: contentHashSchema,
  verified: z.boolean(),
});
export const fixedFiveRematchRequestPayloadSchema = z.object({
  kind: z.literal('rematch-request'),
});
export const fixedFiveRematchConfirmPayloadSchema = z.object({
  kind: z.literal('rematch-confirm'),
});
export const fixedFiveLeavePayloadSchema = z.object({
  kind: z.literal('leave'),
});
export const fixedFiveRemoveGuestPayloadSchema = z.object({
  kind: z.literal('remove-guest'),
  targetParticipantId: fixedFiveParticipantIdSchema,
});
export const fixedFiveCommandPayloadSchema = z.discriminatedUnion('kind', [
  fixedFiveReadyPayloadSchema,
  fixedFiveStartPayloadSchema,
  fixedFiveRerollPayloadSchema,
  fixedFiveClassicPickPayloadSchema,
  fixedFiveClassicRepositionPayloadSchema,
  fixedFiveDuelClaimPayloadSchema,
  fixedFiveDuelRepositionPayloadSchema,
  fixedFiveSandboxPlacePayloadSchema,
  fixedFiveSandboxRepositionPayloadSchema,
  fixedFiveSandboxRemovePayloadSchema,
  fixedFiveSandboxLockPayloadSchema,
  fixedFiveTimeoutAutopickPayloadSchema,
  fixedFiveReadyNextGamePayloadSchema,
  fixedFiveBroadcastStartPayloadSchema,
  fixedFiveProposeGameResultPayloadSchema,
  fixedFiveConfirmGameResultPayloadSchema,
  fixedFiveProposeResultPayloadSchema,
  fixedFiveConfirmResultPayloadSchema,
  fixedFiveRematchRequestPayloadSchema,
  fixedFiveRematchConfirmPayloadSchema,
  fixedFiveLeavePayloadSchema,
  fixedFiveRemoveGuestPayloadSchema,
]);
export type FixedFiveCommandPayload = z.infer<typeof fixedFiveCommandPayloadSchema>;
export type FixedFiveCommandKind = FixedFiveCommandPayload['kind'];
export const fixedFiveCommandSchema = z.object({
  schemaVersion: z.literal(1),
  roomId: idSchema,
  commandId: commandIdSchema,
  ordinal: z.number().int().nonnegative(),
  actorParticipantId: fixedFiveParticipantIdSchema,
  payload: fixedFiveCommandPayloadSchema,
});
export type FixedFiveCommand = z.infer<typeof fixedFiveCommandSchema>;
export const fixedFiveCommandReceiptSchema = z.object({
  roomId: idSchema,
  commandId: commandIdSchema,
  ordinal: z.number().int().nonnegative(),
  accepted: z.boolean(),
  rejectionCode: z.string().min(1).max(64).nullable(),
  revision: z.number().int().nonnegative(),
});
export type FixedFiveCommandReceipt = z.infer<typeof fixedFiveCommandReceiptSchema>;
export const fixedFiveMemberSnapshotSchema = z.object({
  participantId: fixedFiveParticipantIdSchema,
  online: z.boolean(),
  ready: z.boolean(),
  picksCommitted: z.number().int().min(0).max(10),
  locked: z.boolean(),
  nextGameReady: z.number().int().min(0).max(7).nullable().default(null),
  lastSeenAt: z.string().min(1).max(64).nullable(),
});
export type FixedFiveMemberSnapshot = z.infer<typeof fixedFiveMemberSnapshotSchema>;
export const fixedFiveDeadlineSchema = z.object({
  roomId: idSchema,
  cursor: z.string().min(1).max(128),
  participantId: fixedFiveParticipantIdSchema,
  deadlineAt: z.string().min(1).max(64),
  fallback: fixedFiveCommandPayloadSchema.nullable(),
  pickOrdinal: z.number().int().nonnegative(),
});
export type FixedFiveDeadline = z.infer<typeof fixedFiveDeadlineSchema>;
export const fixedFiveDuelSeriesGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  homeParticipantId: fixedFiveParticipantIdSchema,
  awayParticipantId: fixedFiveParticipantIdSchema,
  winner: fixedFiveParticipantIdSchema,
});
export type FixedFiveDuelSeriesGame = z.infer<typeof fixedFiveDuelSeriesGameSchema>;
export const fixedFiveDuelSeriesSchema = z.object({
  games: z.array(fixedFiveDuelSeriesGameSchema).max(7),
  p1Wins: z.number().int().min(0).max(4),
  p2Wins: z.number().int().min(0).max(4),
  currentGameNumber: z.number().int().min(1).max(7).nullable(),
  champion: fixedFiveParticipantIdSchema.nullable(),
});
export type FixedFiveDuelSeries = z.infer<typeof fixedFiveDuelSeriesSchema>;
export const fixedFiveBroadcastSchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  startedAtIso: z.string().min(1).max(64),
  durationMs: z.number().int().positive(),
});
export type FixedFiveBroadcast = z.infer<typeof fixedFiveBroadcastSchema>;
export const fixedFiveShared82BroadcastStateSchema = z
  .object({
    eligibleGameNumbers: z.array(z.number().int().min(1).max(82)).min(1).max(82),
    lastCompletedGameNumber: z.number().int().min(1).max(82).nullable(),
  })
  .superRefine((state, context) => {
    for (let index = 1; index < state.eligibleGameNumbers.length; index += 1) {
      const previous = state.eligibleGameNumbers[index - 1];
      const current = state.eligibleGameNumbers[index];
      if (previous === undefined || current === undefined || previous >= current) {
        context.addIssue({ code: 'custom', message: 'eligible game numbers must be ordered' });
        break;
      }
    }
    if (
      state.lastCompletedGameNumber !== null &&
      !state.eligibleGameNumbers.includes(state.lastCompletedGameNumber)
    ) {
      context.addIssue({ code: 'custom', message: 'last completed game must be eligible' });
    }
  });
export type FixedFiveShared82BroadcastState = z.infer<typeof fixedFiveShared82BroadcastStateSchema>;
export const fixedFiveRoomSnapshotSchema = z.object({
  roomId: idSchema,
  code: fixedFiveRoomCodeSchema.nullable(),
  codeActive: z.boolean(),
  settings: fixedFiveRoomSettingsSchema,
  phase: fixedFiveRoomPhaseSchema,
  revision: z.number().int().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  digest: contentHashSchema.nullable(),
  members: z.array(fixedFiveMemberSnapshotSchema).length(2),
  rootSeed: seedSchema.nullable(),
  deadline: fixedFiveDeadlineSchema.nullable(),
  series: fixedFiveDuelSeriesSchema.nullable().default(null),
  broadcast: fixedFiveBroadcastSchema.nullable().default(null),
  seasonBroadcast: fixedFiveShared82BroadcastStateSchema.nullable().default(null),
  resultDigest: contentHashSchema.nullable(),
  confirmedDigest: contentHashSchema.nullable(),
  successorRoomId: idSchema.nullable(),
  expiresAt: z.string().min(1).max(64),
  createdAt: z.string().min(1).max(64),
});
export type FixedFiveRoomSnapshot = z.infer<typeof fixedFiveRoomSnapshotSchema>;
export const fixedFiveRoomMembershipSchema = z.object({
  roomId: idSchema,
  participantId: fixedFiveParticipantIdSchema,
  code: fixedFiveRoomCodeSchema,
});
export type FixedFiveRoomMembership = z.infer<typeof fixedFiveRoomMembershipSchema>;
export const fixedFiveLineupEntrySchema = z.object({
  lineup: lineupSchema,
  players: z.array(simulationPlayerSchema).length(5),
});
export type FixedFiveLineupEntry = z.infer<typeof fixedFiveLineupEntrySchema>;
export const fixedFiveShared82ParticipantSummarySchema = z.object({
  participantId: fixedFiveParticipantIdSchema,
  wins: z.number().int().min(0).max(82),
  losses: z.number().int().min(0).max(82),
  differential: z.number().int(),
  h2hWins: z.number().int().min(0).max(3),
});
export type FixedFiveShared82ParticipantSummary = z.infer<
  typeof fixedFiveShared82ParticipantSummarySchema
>;
export const fixedFiveShared82ResultSchema = z.object({
  competition: z.literal('shared-82'),
  gamesPerParticipant: z.literal(82),
  uniqueSimulations: z.number().int(),
  weakestReplacedOpponentId: z.string().min(1).max(64),
  h2hGameNumbers: z.array(z.number().int().min(1).max(82)),
  participants: z.array(fixedFiveShared82ParticipantSummarySchema).length(2),
  ranking: z.array(fixedFiveParticipantIdSchema).length(2),
  tiebreakPath: z.string().min(1).max(256),
});
export type FixedFiveShared82Result = z.infer<typeof fixedFiveShared82ResultSchema>;
export const fixedFiveDuelGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  seed: seedSchema,
  winner: fixedFiveParticipantIdSchema,
});
export type FixedFiveDuelGame = z.infer<typeof fixedFiveDuelGameSchema>;
export const fixedFiveDuelResultSchema = z.object({
  competition: z.literal('duel'),
  games: z.array(fixedFiveDuelGameSchema).min(4).max(7),
  p1Wins: z.number().int().min(0).max(4),
  p2Wins: z.number().int().min(0).max(4),
  winner: fixedFiveParticipantIdSchema,
  stoppedAtGame: z.number().int().min(4).max(7),
});
export type FixedFiveDuelResult = z.infer<typeof fixedFiveDuelResultSchema>;
export const fixedFiveDuelGameOutputSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_DUEL_TAPE_VERSION),
  roomId: idSchema,
  gameNumber: z.number().int().min(1).max(7),
  homeParticipantId: fixedFiveParticipantIdSchema,
  awayParticipantId: fixedFiveParticipantIdSchema,
  seed: seedSchema,
  result: gameResultSchema,
  tape: z.array(gameTapeEventSchema).min(1),
  inputDigest: contentHashSchema,
  resultDigest: contentHashSchema,
  tapeDigest: contentHashSchema,
});
export type FixedFiveDuelGameOutput = z.infer<typeof fixedFiveDuelGameOutputSchema>;
export const fixedFiveShared82H2HGameOutputSchema = z.object({
  schemaVersion: z.literal(FIXED_FIVE_DUEL_TAPE_VERSION),
  gameNumber: z.number().int().min(1).max(82),
  homeParticipantId: z.literal('p1'),
  awayParticipantId: z.literal('p2'),
  seed: seedSchema,
  result: gameResultSchema,
  tape: z.array(gameTapeEventSchema).min(1),
  inputDigest: contentHashSchema,
  resultDigest: contentHashSchema,
  tapeDigest: contentHashSchema,
});
export type FixedFiveShared82H2HGameOutput = z.infer<typeof fixedFiveShared82H2HGameOutputSchema>;
export const fixedFiveCompetitionResultSchema = z.discriminatedUnion('competition', [
  fixedFiveShared82ResultSchema,
  fixedFiveDuelResultSchema,
]);
export type FixedFiveCompetitionResult = z.infer<typeof fixedFiveCompetitionResultSchema>;
export const fixedFiveCompetitionRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: idSchema,
  roomId: idSchema,
  mode: fixedFiveSourceModeSchema,
  competition: z.enum(['shared-82', 'duel']),
  lineups: z.object({
    p1: fixedFiveLineupEntrySchema,
    p2: fixedFiveLineupEntrySchema,
  }),
  rootSeed: seedSchema,
  versions: fixedFiveVersionLocksSchema,
  acceptedCommands: z.array(fixedFiveCommandSchema),
  authorityFacts: z.object({
    tiebreakPath: z.string().min(1).max(256),
    tiebreakWinner: fixedFiveParticipantIdSchema,
    weakestReplacedOpponentId: z.string().min(1).max(64).nullable(),
  }),
  resultDigest: contentHashSchema,
  result: fixedFiveCompetitionResultSchema,
});
export type FixedFiveCompetitionRun = z.infer<typeof fixedFiveCompetitionRunSchema>;
const receiptHexSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const fixedFiveReceiptGameSeedSchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  seed: seedSchema,
  tag: z.enum(['h2h', 'p1', 'p2', 'duel']),
});
export type FixedFiveReceiptGameSeed = z.infer<typeof fixedFiveReceiptGameSeedSchema>;
export const fixedFiveVerificationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  roomId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  versions: fixedFiveVersionLocksSchema,
  challenge: z.string().min(1).max(256),
  participantIds: z.tuple([fixedFiveParticipantIdSchema, fixedFiveParticipantIdSchema]),
  commandIds: z.array(z.string().min(1).max(64)),
  gameSeeds: z.array(fixedFiveReceiptGameSeedSchema),
  resultDigest: receiptHexSchema,
  receiptDigest: receiptHexSchema,
});
export type FixedFiveVerificationReceipt = z.infer<typeof fixedFiveVerificationReceiptSchema>;
export const fixedFiveMultiplayerErrorCodeSchema = z.enum([
  'authorization',
  'membership',
  'phase',
  'turn',
  'stale-revision',
  'expiry',
  'rate-limit',
  'duplicate-command',
  'invalid-code',
  'code-expired',
  'room-full',
  'outdated-room',
  'payload-too-large',
  'illegal-move',
  'reroll-exhausted',
  'claim-taken',
  'not-ready',
  'already-locked',
]);
export type FixedFiveMultiplayerErrorCode = z.infer<typeof fixedFiveMultiplayerErrorCodeSchema>;
export const fixedFiveMultiplayerErrorSchema = z.object({
  code: fixedFiveMultiplayerErrorCodeSchema,
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
});
export type FixedFiveMultiplayerError = z.infer<typeof fixedFiveMultiplayerErrorSchema>;
export interface FixedFiveMultiplayerTransport {
  create(
    settings: Omit<FixedFiveRoomSettings, 'schemaVersion' | 'timerPolicyVersion'> &
      Partial<Pick<FixedFiveRoomSettings, 'schemaVersion' | 'timerPolicyVersion'>>,
  ): Promise<{
    snapshot: FixedFiveRoomSnapshot;
    code: FixedFiveRoomCode;
    membership: FixedFiveRoomMembership;
  }>;
  preview(code: string): Promise<FixedFiveRoomSnapshot>;
  join(code: string): Promise<{
    snapshot: FixedFiveRoomSnapshot;
    membership: FixedFiveRoomMembership;
  }>;
  resume(roomId: string): Promise<{
    snapshot: FixedFiveRoomSnapshot;
    membership: FixedFiveRoomMembership;
  }>;
  snapshot(roomId: string): Promise<FixedFiveRoomSnapshot>;
  sync(
    roomId: string,
    afterOrdinal: number,
  ): Promise<{
    snapshot: FixedFiveRoomSnapshot;
    commands: FixedFiveCommand[];
  }>;
  subscribe(
    roomId: string,
    handler: () => void,
    onError?: (error: Error) => void,
  ): {
    unsubscribe: () => void;
  };
  refetch(roomId: string, afterOrdinal: number): Promise<FixedFiveCommand[]>;
  submitCommand(
    command: Omit<FixedFiveCommand, 'ordinal'> & {
      ordinal?: number;
      expectedRevision?: number;
    },
  ): Promise<FixedFiveCommandReceipt>;
  verificationChallenge(roomId: string): Promise<string>;
  submitVerification(
    roomId: string,
    receipt: FixedFiveVerificationReceipt,
    expectedRevision?: number,
  ): Promise<{
    receiptId: string;
    revision: number;
  }>;
  commitFallback(
    roomId: string,
    cursor: string,
    payload: FixedFiveCommandPayload,
    expectedRevision?: number,
  ): Promise<{
    stored: boolean;
    revision: number;
  }>;
  resolveTimeout(roomId: string): Promise<FixedFiveCommandReceipt | null>;
  removeGuest(
    roomId: string,
    targetParticipantId: FixedFiveParticipantId,
  ): Promise<FixedFiveRoomSnapshot>;
  leave(roomId: string, participantId: FixedFiveParticipantId): Promise<void>;
  rematch(roomId: string): Promise<{
    snapshot: FixedFiveRoomSnapshot;
    code: FixedFiveRoomCode;
  }>;
  complete(
    roomId: string,
    receiptId: string,
  ): Promise<{
    completed: boolean;
    phase: FixedFiveRoomPhase;
  }>;
  fail(roomId: string): Promise<{
    failed: boolean;
    phase: FixedFiveRoomPhase;
  }>;
}
export function fixedFiveTimeoutMsForMode(mode: FixedFiveRoomMode): number {
  if (mode === 'sandbox-shared-82') return 5 * 60 * 1000;
  return 90 * 1000;
}
