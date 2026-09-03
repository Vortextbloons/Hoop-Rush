import { z } from 'zod';
import { franchiseIdSchema, idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { SEASON_AUTHORITY_VERSION, SEASON_MULTIPLAYER_VERSION, SEASON_TIMER_POLICY_VERSION, } from './season-versions.ts';
export const seasonParticipantIdSchema = z.enum(['p1', 'p2']);
export type SeasonParticipantId = z.infer<typeof seasonParticipantIdSchema>;
export const seasonRoomPaceSchema = z.enum(['live', 'async']);
export type SeasonRoomPace = z.infer<typeof seasonRoomPaceSchema>;
export const seasonParticipantControlSchema = z.enum(['human', 'ai-takeover', 'surrendered']);
export type SeasonParticipantControl = z.infer<typeof seasonParticipantControlSchema>;
export const seasonReclaimRequestSchema = z.object({
    requestedAt: z.string().min(1).max(64),
    resolvedAt: z.string().min(1).max(64).nullable(),
    resolved: z.boolean(),
});
export type SeasonReclaimRequest = z.infer<typeof seasonReclaimRequestSchema>;
export const seasonTimeoutEventSchema = z.object({
    participantId: seasonParticipantIdSchema,
    franchiseId: franchiseIdSchema,
    blockIndex: z.number().int().min(0).max(8).nullable(),
    fallbackDigest: seasonCheckpointDigestSchema,
    source: z.enum(['timeout-default', 'ai-takeover']),
    atRevision: z.number().int().nonnegative(),
});
export type SeasonTimeoutEvent = z.infer<typeof seasonTimeoutEventSchema>;
export const seasonCheckpointVerificationStateSchema = z.object({
    lastVerifiedCursor: z.string().min(1).max(64).nullable(),
    lastInputDigest: seasonCheckpointDigestSchema.nullable(),
    lastResultDigest: seasonCheckpointDigestSchema.nullable(),
    matched: z.boolean(),
    attempts: z.number().int().nonnegative(),
});
export type SeasonCheckpointVerificationState = z.infer<typeof seasonCheckpointVerificationStateSchema>;
export const seasonIntegrityFailureSchema = z.object({
    cursor: z.string().min(1).max(64),
    expectedInputDigest: seasonCheckpointDigestSchema,
    expectedResultDigest: seasonCheckpointDigestSchema,
    actualInputDigests: z.array(seasonCheckpointDigestSchema).length(2),
    actualResultDigests: z.array(seasonCheckpointDigestSchema).length(2),
    reason: z.string().min(1).max(512),
    failures: z.number().int().min(1).max(3),
});
export type SeasonIntegrityFailure = z.infer<typeof seasonIntegrityFailureSchema>;
export const seasonParticipantRecordSchema = z.object({
    participantId: seasonParticipantIdSchema,
    franchiseId: franchiseIdSchema,
    seat: seasonParticipantIdSchema,
});
export type SeasonParticipantRecord = z.infer<typeof seasonParticipantRecordSchema>;
export const seasonAuthorityLocalSoloSchema = z.object({
    kind: z.literal('local-solo'),
    soloFranchiseId: franchiseIdSchema.nullable(),
    authorityVersion: z.literal(SEASON_AUTHORITY_VERSION),
});
export type SeasonAuthorityLocalSolo = z.infer<typeof seasonAuthorityLocalSoloSchema>;
export const seasonAuthorityMultiplayerSchema = z.object({
    kind: z.literal('season-multiplayer'),
    p1: seasonParticipantRecordSchema,
    p2: seasonParticipantRecordSchema,
    pace: seasonRoomPaceSchema,
    timerPolicyVersion: z.literal(SEASON_TIMER_POLICY_VERSION),
    authorityVersion: z.literal(SEASON_AUTHORITY_VERSION),
    multiplayerVersion: z.literal(SEASON_MULTIPLAYER_VERSION),
    control: z.record(seasonParticipantIdSchema, seasonParticipantControlSchema),
    missStreak: z.record(seasonParticipantIdSchema, z.number().int().min(0).max(10)),
    reclaimRequests: z.record(seasonParticipantIdSchema, seasonReclaimRequestSchema.nullable()),
    timeoutEvents: z.array(seasonTimeoutEventSchema).max(64),
    checkpointVerification: seasonCheckpointVerificationStateSchema,
    integrityFailure: seasonIntegrityFailureSchema.nullable(),
    createdAtRevision: z.number().int().nonnegative(),
});
export type SeasonAuthorityMultiplayer = z.infer<typeof seasonAuthorityMultiplayerSchema>;
export const seasonRunAuthoritySchema = z.discriminatedUnion('kind', [
    seasonAuthorityLocalSoloSchema,
    seasonAuthorityMultiplayerSchema,
]);
export type SeasonRunAuthority = z.infer<typeof seasonRunAuthoritySchema>;
export function buildLocalSoloAuthority(soloFranchiseId: string | null): SeasonRunAuthority {
    return {
        kind: 'local-solo',
        soloFranchiseId,
        authorityVersion: SEASON_AUTHORITY_VERSION,
    };
}
export function buildMultiplayerAuthority(input: {
    p1FranchiseId: string;
    p2FranchiseId: string;
    pace: SeasonRoomPace;
    createdAtRevision: number;
}): SeasonRunAuthority {
    return {
        kind: 'season-multiplayer',
        p1: { participantId: 'p1', franchiseId: input.p1FranchiseId, seat: 'p1' },
        p2: { participantId: 'p2', franchiseId: input.p2FranchiseId, seat: 'p2' },
        pace: input.pace,
        timerPolicyVersion: SEASON_TIMER_POLICY_VERSION,
        authorityVersion: SEASON_AUTHORITY_VERSION,
        multiplayerVersion: SEASON_MULTIPLAYER_VERSION,
        control: { p1: 'human', p2: 'human' },
        missStreak: { p1: 0, p2: 0 },
        reclaimRequests: { p1: null, p2: null },
        timeoutEvents: [],
        checkpointVerification: {
            lastVerifiedCursor: null,
            lastInputDigest: null,
            lastResultDigest: null,
            matched: true,
            attempts: 0,
        },
        integrityFailure: null,
        createdAtRevision: input.createdAtRevision,
    };
}
export function participantFranchiseIdsOf(authority: SeasonRunAuthority): string[] {
    if (authority.kind === 'local-solo') {
        return authority.soloFranchiseId ? [authority.soloFranchiseId] : [];
    }
    return [authority.p1.franchiseId, authority.p2.franchiseId];
}
export function authorityForFranchise(authority: SeasonRunAuthority, franchiseId: string): SeasonParticipantId | null {
    if (authority.kind === 'local-solo') {
        return authority.soloFranchiseId === franchiseId ? 'p1' : null;
    }
    if (authority.p1.franchiseId === franchiseId)
        return 'p1';
    if (authority.p2.franchiseId === franchiseId)
        return 'p2';
    return null;
}
export function franchiseForParticipant(authority: SeasonRunAuthority, participantId: SeasonParticipantId): string | null {
    if (authority.kind === 'local-solo') {
        return authority.soloFranchiseId;
    }
    return participantId === 'p1' ? authority.p1.franchiseId : authority.p2.franchiseId;
}
