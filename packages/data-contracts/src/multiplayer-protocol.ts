import { z } from 'zod';
import {
  capRushMultiplayerCommandPayloadSchema,
  capRushMultiplayerCommandReceiptSchema,
  capRushMultiplayerCommandSchema,
  capRushMultiplayerRoomSnapshotSchema,
  capRushMultiplayerVerificationReceiptSchema,
} from './cap-rush-multiplayer.ts';
import { capRushMultiplayerSettingsSchema } from './cap-rush-multiplayer-versions.ts';
import {
  draftDuelCommandPayloadSchema,
  draftDuelCommandReceiptSchema,
  draftDuelCommandSchema,
  draftDuelRoomSettingsSchema,
  draftDuelRoomSnapshotSchema,
  draftDuelTransientEventSchema,
  draftDuelVerificationReceiptSchema,
} from './draft-duel.ts';
import {
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandReceiptSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomSettingsSchema,
  fixedFiveRoomSnapshotSchema,
  fixedFiveVerificationReceiptSchema,
} from './fixed-five-multiplayer.ts';
import {
  havocMultiplayerCommandPayloadSchema,
  havocMultiplayerCommandReceiptSchema,
  havocMultiplayerCommandSchema,
  havocMultiplayerRoomSettingsSchema,
  havocMultiplayerRoomSnapshotSchema,
  havocMultiplayerTransientEventSchema,
  havocMultiplayerVerificationReceiptSchema,
} from './havoc-multiplayer.ts';
import { multiplayerGameKindSchema } from './multiplayer-lobby.ts';

/**
 * One typed room protocol for every multiplayer mode.
 *
 * Milestone 3 of `spec/refactors/shared-mode-infrastructure.md`.
 *
 * This module is a **type and schema registry**, not an execution layer. It
 * says which settings, state, command, event, receipt, and rejection vocabulary
 * each mode owns, so one transport surface can be described once. Mode rules
 * stay in each mode.
 *
 * The spec's requirement that "a selected mode must determine all these types;
 * never accept unrelated mode/state pairs or `Record<string, unknown>`
 * payloads" is met by keying this map on the existing
 * `multiplayerGameKindSchema` and deriving per-mode schema pairs from it. There
 * is no second list of mode IDs and no open-ended payload type.
 */

/**
 * Bumped when room envelopes change shape. Distinct from:
 * - storage schema versions (`saveSchemaVersion`, `SAVE_SCHEMA_VERSION`)
 * - domain save versions per mode (`DRAFT_DUEL_SAVE_SCHEMA_VERSION`, ...)
 * - engine versions and rules locks
 *
 * The spec requires these stay separate so a rules change does not force a
 * storage migration, and vice versa.
 */
export const ROOM_PROTOCOL_VERSION = 2;

/** Room availability only. Mode phase names live in each mode's typed state. */
export const roomLifecycleStatusSchema = z.enum([
  'open',
  'full',
  'expired',
  'integrity-failed',
  'complete',
]);
export type RoomLifecycleStatus = z.infer<typeof roomLifecycleStatusSchema>;

export const roomParticipantIdSchema = z.enum(['p1', 'p2']);
export type RoomParticipantId = z.infer<typeof roomParticipantIdSchema>;

/** Membership as published on the common envelope. */
export const roomMemberEnvelopeSchema = z.object({
  participantId: roomParticipantIdSchema,
  online: z.boolean(),
});
export type RoomMemberEnvelope = z.infer<typeof roomMemberEnvelopeSchema>;

/**
 * Common command envelope, shared by every mode.
 *
 * `expectedRoomRevision` is the room revision the client believed it wrote
 * against. It is deliberately separate from the mode's own domain revision,
 * because presence changes advance the room revision without appending a
 * gameplay command.
 *
 * The authorized actor always comes from membership server-side; a supplied
 * actor is a claim, never authority.
 */
export const roomCommandEnvelopeSchema = z.object({
  protocolVersion: z.literal(ROOM_PROTOCOL_VERSION),
  mode: multiplayerGameKindSchema,
  roomId: z.string().min(1).max(64),
  commandId: z.string().min(1).max(128),
  actorParticipantId: roomParticipantIdSchema,
  expectedRoomRevision: z.number().int().nonnegative(),
});
export type RoomCommandEnvelope = z.infer<typeof roomCommandEnvelopeSchema>;

/** Why a command was refused, independent of any mode's published spelling. */
export const roomCommandRejectionReasonSchema = z.enum([
  'invalid-command-id',
  'payload-too-large',
  'actor-mismatch',
  'payload-mismatch',
  'stale-revision',
  'illegal-payload',
  'phase',
  'not-ready',
  'expired',
  'integrity-failed',
]);
export type RoomCommandRejectionReason = z.infer<typeof roomCommandRejectionReasonSchema>;

/**
 * Common receipt shape.
 *
 * `ordinal` is nullable because not every mode numbers commands; Havoc
 * multiplayer omits it today. That difference is preserved rather than
 * invented away, per the spec's instruction not to add authoritative ordinals
 * where no ordering rule exists.
 */
export const roomCommandReceiptSchema = z
  .object({
    protocolVersion: z.literal(ROOM_PROTOCOL_VERSION),
    mode: multiplayerGameKindSchema,
    roomId: z.string().min(1).max(64),
    commandId: z.string().min(1).max(128),
    accepted: z.boolean(),
    /** Authoritative room revision after the attempt. */
    roomRevision: z.number().int().nonnegative(),
    /** Accepted ordinal, when the mode numbers commands. */
    ordinal: z.number().int().nonnegative().nullable(),
    rejectionReason: roomCommandRejectionReasonSchema.nullable(),
    /** The mode's own published code, preserved until vocabularies are unified. */
    modeRejectionCode: z.string().min(1).max(64).nullable(),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.accepted && receipt.rejectionReason !== null) {
      ctx.addIssue({ code: 'custom', message: 'accepted receipts carry no rejection reason' });
    }
    if (!receipt.accepted && receipt.rejectionReason === null) {
      ctx.addIssue({ code: 'custom', message: 'rejected receipts require a rejection reason' });
    }
  });
export type RoomCommandReceipt = z.infer<typeof roomCommandReceiptSchema>;

/** Sync cursor semantics: an authoritative cursor plus a bounded suffix. */
export const roomSyncCursorSchema = z.object({
  /** Commands at or below this ordinal are omitted from `commands`. */
  afterOrdinal: z.number().int().min(-1),
  /** Highest accepted ordinal the server holds, or -1 when none. */
  authoritativeOrdinal: z.number().int().min(-1),
  /** True when earlier history exists but was not sent. */
  truncated: z.boolean(),
});
export type RoomSyncCursor = z.infer<typeof roomSyncCursorSchema>;

/**
 * The per-mode protocol table.
 *
 * Each entry is a bundle of that mode's real contracts. Adding a mode is one
 * entry here and nothing else; there is no second registration point.
 */
export const roomProtocolSchema = {
  'fixed-five': {
    protocolVersion: ROOM_PROTOCOL_VERSION,
    settings: fixedFiveRoomSettingsSchema,
    state: fixedFiveRoomSnapshotSchema,
    command: fixedFiveCommandSchema,
    commandPayload: fixedFiveCommandPayloadSchema,
    commandReceipt: fixedFiveCommandReceiptSchema,
    /** Fixed-five publishes no transient events; realtime is snapshot-driven. */
    transientEvent: null,
    verificationReceipt: fixedFiveVerificationReceiptSchema,
  },
  'draft-duel': {
    protocolVersion: ROOM_PROTOCOL_VERSION,
    settings: draftDuelRoomSettingsSchema,
    state: draftDuelRoomSnapshotSchema,
    command: draftDuelCommandSchema,
    commandPayload: draftDuelCommandPayloadSchema,
    commandReceipt: draftDuelCommandReceiptSchema,
    transientEvent: draftDuelTransientEventSchema,
    verificationReceipt: draftDuelVerificationReceiptSchema,
  },
  havoc: {
    protocolVersion: ROOM_PROTOCOL_VERSION,
    settings: havocMultiplayerRoomSettingsSchema,
    state: havocMultiplayerRoomSnapshotSchema,
    command: havocMultiplayerCommandSchema,
    commandPayload: havocMultiplayerCommandPayloadSchema,
    commandReceipt: havocMultiplayerCommandReceiptSchema,
    transientEvent: havocMultiplayerTransientEventSchema,
    verificationReceipt: havocMultiplayerVerificationReceiptSchema,
  },
  'cap-rush': {
    protocolVersion: ROOM_PROTOCOL_VERSION,
    settings: capRushMultiplayerSettingsSchema,
    state: capRushMultiplayerRoomSnapshotSchema,
    command: capRushMultiplayerCommandSchema,
    commandPayload: capRushMultiplayerCommandPayloadSchema,
    commandReceipt: capRushMultiplayerCommandReceiptSchema,
    transientEvent: null,
    verificationReceipt: capRushMultiplayerVerificationReceiptSchema,
  },
} as const;

export type RoomProtocolTable = typeof roomProtocolSchema;
export type RoomProtocolMode = keyof RoomProtocolTable;

/** Settings type a given mode must supply. */
export type RoomSettingsOf<Mode extends RoomProtocolMode> = z.infer<
  RoomProtocolTable[Mode]['settings']
>;
/** Typed state for a given mode. */
export type RoomStateOf<Mode extends RoomProtocolMode> = z.infer<RoomProtocolTable[Mode]['state']>;
/** Typed command payload for a given mode. */
export type RoomCommandPayloadOf<Mode extends RoomProtocolMode> = z.infer<
  RoomProtocolTable[Mode]['commandPayload']
>;
/** Verification receipt for a given mode. */
export type RoomVerificationReceiptOf<Mode extends RoomProtocolMode> = z.infer<
  RoomProtocolTable[Mode]['verificationReceipt']
>;

const protocolModeSchema = multiplayerGameKindSchema;

/**
 * The common room envelope: one shape, mode-discriminated state.
 *
 * Room revision, command cursor, and lifecycle status are shared. Phase names
 * stay inside `state`.
 */
export const roomEnvelopeSchema = z.object({
  protocolVersion: z.literal(ROOM_PROTOCOL_VERSION),
  mode: protocolModeSchema,
  roomId: z.string().min(1).max(64),
  revision: z.number().int().nonnegative(),
  commandOrdinal: z.number().int().min(-1),
  lifecycle: roomLifecycleStatusSchema,
  members: z.array(roomMemberEnvelopeSchema).length(2),
  expiresAt: z.string().min(1).max(64),
  createdAt: z.string().min(1).max(64),
});
export type RoomEnvelope = z.infer<typeof roomEnvelopeSchema>;

/** A new client refuses a room it cannot speak to, with a reason it can show. */
export const roomProtocolMismatchReasonSchema = z.enum([
  'unsupported-version',
  'unsupported-mode',
  'malformed-envelope',
]);
export type RoomProtocolMismatchReason = z.infer<typeof roomProtocolMismatchReasonSchema>;

export type RoomProtocolCheck =
  { ok: true } | { ok: false; reason: RoomProtocolMismatchReason; detail: string };

/**
 * Validate a wire room envelope and its typed state together.
 *
 * A mode/state mismatch is rejected rather than coerced, which is what the spec
 * means by "never accept unrelated mode/state pairs".
 */
export function checkRoomProtocol(input: {
  mode: unknown;
  protocolVersion: unknown;
  state: unknown;
}): RoomProtocolCheck {
  const mode = protocolModeSchema.safeParse(input.mode);
  if (!mode.success) {
    return { ok: false, reason: 'unsupported-mode', detail: 'unknown multiplayer mode' };
  }
  if (input.protocolVersion !== ROOM_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-version',
      detail: `room speaks protocol ${String(input.protocolVersion)}; this client requires ${String(ROOM_PROTOCOL_VERSION)}`,
    };
  }
  const entry = roomProtocolSchema[mode.data];
  const state = entry.state.safeParse(input.state);
  if (!state.success) {
    return {
      ok: false,
      reason: 'malformed-envelope',
      detail: `state does not match the ${mode.data} protocol`,
    };
  }
  return { ok: true };
}

/**
 * Reject a legacy room outright rather than half-serving it.
 *
 * The spec requires old clients be told to start a new room, not silently
 * misinterpreted. Server-side enforcement is what stops a stale tab from
 * mutating new room state; this is the client-side half of the same rule.
 */
export function describeLegacyRoomRejection(roomProtocolVersion: number): string {
  return `This room uses protocol ${String(roomProtocolVersion)}, which is no longer supported. Start a new room to play.`;
}
