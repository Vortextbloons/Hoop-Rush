import { z } from 'zod';
import { commandIdSchema, idSchema, playerIdSchema, seedSchema } from './ids.ts';
import { capRushLeagueGameSchema } from './cap-rush-league.ts';
import { capRushPlayoffGameSummarySchema } from './cap-rush-postseason.ts';
import { capRushFranchiseAssignmentSchema } from './cap-rush-lock.ts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  capRushMultiplayerBlockChoiceSchema,
  capRushMultiplayerPhaseSchema,
  capRushMultiplayerSeatIdSchema,
  capRushMultiplayerSettingsSchema,
  type CapRushMultiplayerSeatId,
} from './cap-rush-multiplayer-versions.ts';
import {
  capRushMultiplayerLockedInputsSchema,
  capRushMultiplayerOutcomeSchema,
  capRushMultiplayerPlayoffStateSchema,
  capRushMultiplayerReportSchema,
  capRushMultiplayerSeasonStateSchema,
} from './cap-rush-multiplayer-league.ts';
import { capRushMultiplayerRecruitmentSchema } from './cap-rush-multiplayer-market.ts';
import { capRushSpinPurchaseSchema } from './cap-rush-versions.ts';

export const capRushMultiplayerCommandPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready'), ready: z.boolean() }),
  z.object({ kind: z.literal('start') }),
  z.object({
    kind: z.literal('end-auction-early'),
    round: z.number().int().min(0).max(4),
    agree: z.boolean(),
  }),
  z.object({
    kind: z.literal('cancel-bid'),
    round: z.number().int().min(0).max(4),
    playerId: playerIdSchema,
  }),
  z.object({
    kind: z.literal('bid'),
    round: z.number().int().min(0).max(4),
    playerId: playerIdSchema,
    totalDollars: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('close-due-auctions'),
    round: z.number().int().min(0).max(4),
  }),
  z.object({
    kind: z.literal('purchase-mutation'),
    purchase: capRushSpinPurchaseSchema,
    targetPlayerId: playerIdSchema,
  }),
  z.object({ kind: z.literal('skip-mutation') }),
  z.object({ kind: z.literal('confirm-lock'), stateDigest: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal('choose-block-plan'),
    block: z.number().int().min(0).max(3),
    choice: capRushMultiplayerBlockChoiceSchema,
  }),
  z.object({
    kind: z.literal('accept-slot'),
    throughSlot: z.number().int().min(1).max(82).optional(),
    slot: z.number().int().min(1).max(82),
    games: z.array(capRushLeagueGameSchema).min(1).max(75),
  }),
  z.object({
    kind: z.literal('simulate-range'),
    slot: z.number().int().min(1).max(82),
    throughSlot: z.number().int().min(1).max(82),
  }),
  z.object({ kind: z.literal('simulate-playoff-step'), round: z.number().int().min(1).max(4) }),
  z.object({ kind: z.literal('ack-slot'), slot: z.number().int().min(1).max(82) }),
  z.object({
    kind: z.literal('ack-broadcast'),
    gameId: z.string().min(1).max(80),
    cursor: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    resolved: z.boolean(),
  }),
  z.object({
    kind: z.literal('choose-playoff-plan'),
    round: z.number().int().min(1).max(4),
    choice: capRushMultiplayerBlockChoiceSchema,
  }),
  z.object({
    kind: z.literal('accept-playoff-step'),
    round: z.number().int().min(1).max(4),
    games: z.array(capRushPlayoffGameSummarySchema).min(1).max(8),
  }),
  z.object({
    kind: z.literal('ack-playoff-playback'),
    gameId: z.string().min(1).max(80),
    cursor: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    resolved: z.boolean(),
  }),
  z.object({ kind: z.literal('complete-league') }),
  z.object({ kind: z.literal('leave') }),
  z.object({
    kind: z.literal('remove-guest'),
    targetParticipantId: capRushMultiplayerSeatIdSchema,
  }),
  z.object({ kind: z.literal('rematch') }),
]);
export type CapRushMultiplayerCommandPayload = z.infer<
  typeof capRushMultiplayerCommandPayloadSchema
>;

export const capRushMultiplayerCommandSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
  roomId: idSchema,
  commandId: commandIdSchema,
  ordinal: z.number().int().nonnegative(),
  actorParticipantId: capRushMultiplayerSeatIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  acceptedAtIso: z.iso.datetime(),
  payload: capRushMultiplayerCommandPayloadSchema,
});
export type CapRushMultiplayerCommand = z.infer<typeof capRushMultiplayerCommandSchema>;

export const capRushMultiplayerCommandRejectionCodeSchema = z.enum([
  'not-a-member',
  'not-host',
  'invalid-phase',
  'stale-revision',
  'room-full',
  'expired',
  'command-conflict',
  'unknown-command',
  'not-ready',
  'round-mismatch',
  'auction-closed',
  'auction-not-due',
  'bid-too-low',
  'multiple-leads',
  'position-filled',
  'budget-rejected',
  'completion-rejected',
  'not-locked',
  'plan-missing',
  'frontier-gap',
  'result-mismatch',
  'verification-mismatch',
  'playoff-mismatch',
  'not-due',
]);
export type CapRushMultiplayerCommandRejectionCode = z.infer<
  typeof capRushMultiplayerCommandRejectionCodeSchema
>;

export const capRushMultiplayerCommandReceiptSchema = z.object({
  roomId: idSchema,
  commandId: commandIdSchema,
  ordinal: z.number().int().nonnegative(),
  accepted: z.boolean(),
  rejectionCode: z.string().min(1).max(64).nullable(),
  revision: z.number().int().nonnegative(),
});
export type CapRushMultiplayerCommandReceipt = z.infer<
  typeof capRushMultiplayerCommandReceiptSchema
>;

export const capRushMultiplayerMemberSnapshotSchema = z.object({
  participantId: capRushMultiplayerSeatIdSchema,
  displayName: z.string().min(1).max(64),
  online: z.boolean(),
  ready: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type CapRushMultiplayerMemberSnapshot = z.infer<
  typeof capRushMultiplayerMemberSnapshotSchema
>;

export const capRushMultiplayerDeadlineSchema = z.object({
  cursor: z.string().min(1).max(128),
  atIso: z.iso.datetime(),
});
export type CapRushMultiplayerDeadline = z.infer<typeof capRushMultiplayerDeadlineSchema>;

export const capRushMultiplayerStateSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
  phase: capRushMultiplayerPhaseSchema,
  rootSeed: seedSchema.nullable(),
  franchises: z
    .object({
      p1: capRushFranchiseAssignmentSchema,
      p2: capRushFranchiseAssignmentSchema,
    })
    .nullable(),
  ready: z.object({ p1: z.boolean(), p2: z.boolean() }),
  lockConfirmations: z.object({
    p1: z.string().max(64).nullable(),
    p2: z.string().max(64).nullable(),
  }),
  recruitment: capRushMultiplayerRecruitmentSchema.nullable(),
  locked: capRushMultiplayerLockedInputsSchema.nullable(),
  season: capRushMultiplayerSeasonStateSchema.nullable(),
  postseason: capRushMultiplayerPlayoffStateSchema.nullable(),
  completion: capRushMultiplayerOutcomeSchema.nullable(),
  report: capRushMultiplayerReportSchema.nullable(),
});
export type CapRushMultiplayerState = z.infer<typeof capRushMultiplayerStateSchema>;

export const capRushMultiplayerRoomSnapshotSchema = z.object({
  roomId: idSchema,
  code: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  codeActive: z.boolean(),
  settings: capRushMultiplayerSettingsSchema,
  phase: capRushMultiplayerPhaseSchema,
  revision: z.number().int().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  members: z.array(capRushMultiplayerMemberSnapshotSchema).length(2),
  rootSeed: seedSchema.nullable(),
  state: capRushMultiplayerStateSchema.nullable(),
  deadline: capRushMultiplayerDeadlineSchema.nullable(),
  resultDigest: z.string().min(1).max(64).nullable(),
  confirmedDigest: z.string().min(1).max(64).nullable(),
  successorRoomId: idSchema.nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type CapRushMultiplayerRoomSnapshot = z.infer<typeof capRushMultiplayerRoomSnapshotSchema>;

export const capRushMultiplayerRoomMembershipSchema = z.object({
  roomId: idSchema,
  participantId: capRushMultiplayerSeatIdSchema,
  code: z.string().regex(/^\d{4}$/),
});
export type CapRushMultiplayerRoomMembership = z.infer<
  typeof capRushMultiplayerRoomMembershipSchema
>;

export const capRushMultiplayerVerificationReceiptSchema = z.object({
  receiptId: z.string().min(1).max(128),
  challenge: z.string().min(1).max(256),
  receiptDigest: z.string().min(1).max(64),
  resultDigest: z.string().min(1).max(64),
  commandIds: z.array(commandIdSchema).min(1).max(4096),
  gameSeeds: z.array(z.object({ gameId: z.string().min(1).max(80), seed: seedSchema })),
});
export type CapRushMultiplayerVerificationReceipt = z.infer<
  typeof capRushMultiplayerVerificationReceiptSchema
>;

export const capRushMultiplayerErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(400),
  retryable: z.boolean(),
});
export type CapRushMultiplayerError = z.infer<typeof capRushMultiplayerErrorSchema>;

export const capRushMultiplayerCreateInputSchema = z.object({
  variant: capRushMultiplayerSettingsSchema.shape.variant,
  settings: capRushMultiplayerSettingsSchema.optional(),
});
export type CapRushMultiplayerCreateInput = z.infer<typeof capRushMultiplayerCreateInputSchema>;

export interface CapRushMultiplayerSync {
  readonly snapshot: CapRushMultiplayerRoomSnapshot;
  readonly commands: readonly CapRushMultiplayerCommand[];
  readonly commandCount: number;
}

export interface CapRushMultiplayerSubmitInput {
  readonly roomId: string;
  readonly commandId: string;
  readonly actorParticipantId: CapRushMultiplayerSeatId;
  readonly expectedRevision: number;
  readonly payload: CapRushMultiplayerCommandPayload;
}

export interface CapRushMultiplayerTransport {
  create(input: CapRushMultiplayerCreateInput): Promise<CapRushMultiplayerRoomMembership>;
  preview(code: string): Promise<CapRushMultiplayerRoomSnapshot>;
  join(code: string): Promise<CapRushMultiplayerRoomMembership>;
  resume(roomId: string): Promise<CapRushMultiplayerRoomMembership>;
  snapshot(roomId: string): Promise<CapRushMultiplayerRoomSnapshot>;
  sync(roomId: string, afterOrdinal?: number): Promise<CapRushMultiplayerSync>;
  subscribe(roomId: string, onChange: () => void, onError: (error: Error) => void): () => void;
  submitCommand(input: CapRushMultiplayerSubmitInput): Promise<CapRushMultiplayerCommandReceipt>;
  closeDueAuctions(roomId: string): Promise<CapRushMultiplayerCommandReceipt | null>;
  removeGuest(roomId: string, targetParticipantId: CapRushMultiplayerSeatId): Promise<void>;
  leave(roomId: string): Promise<void>;
  verificationChallenge(roomId: string): Promise<string>;
  submitVerification(
    roomId: string,
    participantId: CapRushMultiplayerSeatId,
    receipt: CapRushMultiplayerVerificationReceipt,
  ): Promise<void>;
  complete(roomId: string, resultDigest: string): Promise<void>;
  fail(roomId: string): Promise<void>;
}
