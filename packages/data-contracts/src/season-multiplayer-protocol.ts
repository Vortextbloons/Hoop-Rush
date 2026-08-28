import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import {
    SEASON_MULTIPLAYER_VERSION,
    SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
    SEASON_TIMER_POLICY_VERSION,
} from './season-versions.ts';

export const seasonRoomPaceSchema = z.enum(['live', 'async']);
export type SeasonRoomPace = z.infer<typeof seasonRoomPaceSchema>;

export const seasonRoomPhaseSchema = z.enum([
    'waiting',
    'drafting',
    'league-verification',
    'checkpoint-setup',
    'market',
    'private-lock',
    'simulation',
    'hash-verification',
    'postseason',
    'completed',
    'integrity-failed',
    'expired',
]);
export type SeasonRoomPhase = z.infer<typeof seasonRoomPhaseSchema>;

export const seasonRoomCodeSchema = z.string().regex(/^[0-9]{4}$/);
export type SeasonRoomCode = z.infer<typeof seasonRoomCodeSchema>;

export const seasonRoomSettingsSchema = z.object({
    schemaVersion: z.literal(SEASON_ROOM_PROTOCOL_SCHEMA_VERSION),
    pace: seasonRoomPaceSchema,
    roomProtocolVersion: z.literal(SEASON_ROOM_PROTOCOL_SCHEMA_VERSION),
    multiplayerVersion: z.literal(SEASON_MULTIPLAYER_VERSION),
    timerPolicyVersion: z.literal(SEASON_TIMER_POLICY_VERSION),
});
export type SeasonRoomSettings = z.infer<typeof seasonRoomSettingsSchema>;

export const seasonRoomPublicSnapshotSchema = z.object({
    roomId: idSchema,
    settings: seasonRoomSettingsSchema,
    phase: seasonRoomPhaseSchema,
    cursor: z.string().min(1).max(64),
    revision: z.number().int().nonnegative(),
    digest: seasonCheckpointDigestSchema,
    memberCount: z.number().int().min(0).max(2),
    codeActive: z.boolean(),
    expiresAt: z.string().min(1).max(64).nullable(),
});
export type SeasonRoomPublicSnapshot = z.infer<typeof seasonRoomPublicSnapshotSchema>;

export const seasonRoomMemberPrivateSnapshotSchema = z.object({
    roomId: idSchema,
    participantId: z.enum(['p1', 'p2']),
    franchiseId: franchiseIdSchema,
    seat: z.enum(['p1', 'p2']),
    control: z.enum(['human', 'ai-takeover', 'surrendered']),
    missStreak: z.number().int().min(0).max(10),
    reclaimRequested: z.boolean(),
    revision: z.number().int().nonnegative(),
});
export type SeasonRoomMemberPrivateSnapshot = z.infer<
    typeof seasonRoomMemberPrivateSnapshotSchema
>;

export const seasonRoomMembershipSchema = z.object({
    roomId: idSchema,
    participantId: z.enum(['p1', 'p2']),
    franchiseId: franchiseIdSchema,
    uid: z.string().min(1).max(128),
    seat: z.enum(['p1', 'p2']),
});
export type SeasonRoomMembership = z.infer<typeof seasonRoomMembershipSchema>;

export const seasonDeadlineSchema = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    deadlineAt: z.string().min(1).max(64),
    fallbackDigest: seasonCheckpointDigestSchema,
    fallbackPayload: z.unknown(),
    resolutionSource: z.enum(['human', 'timeout-default', 'ai-takeover']).nullable(),
    graceEndsAt: z.string().min(1).max(64).nullable(),
});
export type SeasonDeadline = z.infer<typeof seasonDeadlineSchema>;

export const seasonPresenceHintSchema = z.object({
    roomId: idSchema,
    participantId: z.enum(['p1', 'p2']),
    online: z.boolean(),
    lastSeenAt: z.string().min(1).max(64),
});
export type SeasonPresenceHint = z.infer<typeof seasonPresenceHintSchema>;

export const seasonAuthorityTransitionSchema = z.object({
    roomId: idSchema,
    fromControl: z.enum(['human', 'ai-takeover', 'surrendered']),
    toControl: z.enum(['human', 'ai-takeover', 'surrendered']),
    participantId: z.enum(['p1', 'p2']),
    reason: z.enum(['miss-streak', 'reclaim', 'surrender', 'admin']),
    atRevision: z.number().int().nonnegative(),
});
export type SeasonAuthorityTransition = z.infer<typeof seasonAuthorityTransitionSchema>;

export const seasonRoomExpirySchema = z.object({
    roomId: idSchema,
    expiresAt: z.string().min(1).max(64),
    reason: z.enum(['code-expiry', 'unresolved-grace', 'completed-retention']),
});
export type SeasonRoomExpiry = z.infer<typeof seasonRoomExpirySchema>;

export const seasonPublicCommandEnvelopeSchema = z.object({
    schemaVersion: z.literal(SEASON_ROOM_PROTOCOL_SCHEMA_VERSION),
    roomId: idSchema,
    commandId: commandIdSchema,
    ordinal: z.number().int().nonnegative(),
    runId: idSchema,
    payload: z.unknown(),
    actorParticipantId: z.enum(['p1', 'p2']),
    actorFranchiseId: franchiseIdSchema,
});
export type SeasonPublicCommandEnvelope = z.infer<typeof seasonPublicCommandEnvelopeSchema>;

export const seasonCommandReceiptSchema = z.object({
    roomId: idSchema,
    commandId: commandIdSchema,
    ordinal: z.number().int().nonnegative(),
    accepted: z.boolean(),
    rejectionCode: z.string().min(1).max(64).nullable(),
    resultDigest: seasonCheckpointDigestSchema.nullable(),
});
export type SeasonCommandReceipt = z.infer<typeof seasonCommandReceiptSchema>;

export const seasonPrivateDecisionSubmissionSchema = z.object({
    schemaVersion: z.literal(SEASON_ROOM_PROTOCOL_SCHEMA_VERSION),
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    participantId: z.enum(['p1', 'p2']),
    franchiseId: franchiseIdSchema,
    payloadDigest: seasonCheckpointDigestSchema,
    payload: z.unknown(),
});
export type SeasonPrivateDecisionSubmission = z.infer<
    typeof seasonPrivateDecisionSubmissionSchema
>;

export const seasonLockedDecisionPairSchema = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    p1Decision: seasonPrivateDecisionSubmissionSchema.nullable(),
    p2Decision: seasonPrivateDecisionSubmissionSchema.nullable(),
    revealed: z.boolean(),
    fallbackUsed: z.boolean(),
});
export type SeasonLockedDecisionPair = z.infer<typeof seasonLockedDecisionPairSchema>;

export const seasonVerifiedTimeoutFallbackSchema = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    participantId: z.enum(['p1', 'p2']),
    fallbackDigest: seasonCheckpointDigestSchema,
    verified: z.boolean(),
});
export type SeasonVerifiedTimeoutFallback = z.infer<typeof seasonVerifiedTimeoutFallbackSchema>;

export const seasonCheckpointAttestationSchema = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    attempt: z.number().int().min(1).max(3),
    participantId: z.enum(['p1', 'p2']),
    inputDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    runStateDigest: seasonCheckpointDigestSchema,
    versions: z.record(z.string(), z.string()),
});
export type SeasonCheckpointAttestation = z.infer<typeof seasonCheckpointAttestationSchema>;

export const seasonAcceptedCheckpointSchema = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    inputDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    acceptedAt: z.string().min(1).max(64),
});
export type SeasonAcceptedCheckpoint = z.infer<typeof seasonAcceptedCheckpointSchema>;

export const seasonRerunRequestSchema = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    reason: z.string().min(1).max(512),
    attempt: z.number().int().min(1).max(3),
});
export type SeasonRerunRequest = z.infer<typeof seasonRerunRequestSchema>;

export const seasonIntegrityFailureSchema2 = z.object({
    roomId: idSchema,
    cursor: z.string().min(1).max(64),
    expectedInputDigest: seasonCheckpointDigestSchema,
    expectedResultDigest: seasonCheckpointDigestSchema,
    attestations: z.array(seasonCheckpointAttestationSchema).length(2),
    terminal: z.boolean(),
});
export type SeasonIntegrityFailure2 = z.infer<typeof seasonIntegrityFailureSchema2>;

export const seasonDirectTradeProposalSchema = z.object({
    roomId: idSchema,
    negotiationId: z.string().regex(/^htn-[0-9a-f]{32}$/),
    windowIndex: z.number().int().min(0).max(2),
    fromParticipantId: z.enum(['p1', 'p2']),
    toParticipantId: z.enum(['p1', 'p2']),
    proposal: z.unknown(),
    fingerprint: z.string().min(1).max(128),
});
export type SeasonDirectTradeProposal = z.infer<typeof seasonDirectTradeProposalSchema>;

export const seasonDirectTradeResponseSchema = z.object({
    roomId: idSchema,
    negotiationId: z.string().regex(/^htn-[0-9a-f]{32}$/),
    responderParticipantId: z.enum(['p1', 'p2']),
    action: z.enum(['decline', 'accept-final', 'counter', 'walk-away']),
    counterProposal: z.unknown().nullable(),
});
export type SeasonDirectTradeResponse = z.infer<typeof seasonDirectTradeResponseSchema>;

export const seasonDirectTradeConfirmationSchema = z.object({
    roomId: idSchema,
    negotiationId: z.string().regex(/^htn-[0-9a-f]{32}$/),
    participantId: z.enum(['p1', 'p2']),
    fingerprint: z.string().min(1).max(128),
    confirmed: z.boolean(),
});
export type SeasonDirectTradeConfirmation = z.infer<typeof seasonDirectTradeConfirmationSchema>;

export const seasonDirectTradeCancellationSchema = z.object({
    roomId: idSchema,
    negotiationId: z.string().regex(/^htn-[0-9a-f]{32}$/),
    reason: z.enum(['timeout', 'walk-away', 'expiry', 'stale-state']),
});
export type SeasonDirectTradeCancellation = z.infer<typeof seasonDirectTradeCancellationSchema>;

export const seasonDirectTradeCommitSchema = z.object({
    roomId: idSchema,
    negotiationId: z.string().regex(/^htn-[0-9a-f]{32}$/),
    fingerprint: z.string().min(1).max(128),
    attestations: z.array(seasonCheckpointAttestationSchema).length(2),
});
export type SeasonDirectTradeCommit = z.infer<typeof seasonDirectTradeCommitSchema>;

export const seasonMultiplayerErrorCodeSchema = z.enum([
    'authorization',
    'membership',
    'phase',
    'turn',
    'stale-revision',
    'stale-digest',
    'expiry',
    'rate-limit',
    'duplicate-command',
    'unavailable-ownership',
    'unresolved-decision',
    'hash-mismatch',
    'invalid-code',
    'code-expired',
    'room-full',
    'negotiation-closed',
]);
export type SeasonMultiplayerErrorCode = z.infer<typeof seasonMultiplayerErrorCodeSchema>;

export const seasonMultiplayerErrorSchema = z.object({
    code: seasonMultiplayerErrorCodeSchema,
    message: z.string().min(1).max(512),
    retryable: z.boolean(),
});
export type SeasonMultiplayerError = z.infer<typeof seasonMultiplayerErrorSchema>;

export const SEASON_ENVELOPE_MAX_BYTES = 32 * 1024;
export const SEASON_CHECKPOINT_MAX_BYTES = 16 * 1024;

export interface SeasonMultiplayerTransport {
    create(settings: SeasonRoomSettings, rootSeed: string): Promise<SeasonRoomPublicSnapshot>;
    preview(code: string): Promise<SeasonRoomPublicSnapshot>;
    join(code: string): Promise<SeasonRoomMembership>;
    resume(roomId: string): Promise<SeasonRoomPublicSnapshot>;
    subscribe(
        roomId: string,
        handler: (snapshot: SeasonRoomPublicSnapshot) => void,
    ): { unsubscribe: () => void };
    refetch(roomId: string, afterOrdinal: number): Promise<SeasonPublicCommandEnvelope[]>;
    submitCommand(envelope: SeasonPublicCommandEnvelope): Promise<SeasonCommandReceipt>;
    submitPrivateDecision(
        submission: SeasonPrivateDecisionSubmission,
    ): Promise<{ locked: boolean }>;
    publishAttestation(attestation: SeasonCheckpointAttestation): Promise<SeasonAcceptedCheckpoint | SeasonRerunRequest | SeasonIntegrityFailure2>;
    requestReclaim(roomId: string, participantId: 'p1' | 'p2'): Promise<void>;
    surrender(roomId: string, participantId: 'p1' | 'p2'): Promise<void>;
    preDraftRemoval(roomId: string, targetParticipantId: 'p1' | 'p2'): Promise<SeasonRoomCode>;
    close(roomId: string): Promise<void>;
}
