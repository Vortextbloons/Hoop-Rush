import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { SEASON_DRAFT_VERSION } from './season-versions.ts';

/**
 * Authoritative Season Run draft command envelopes and their accepted or
 * rejected records (spec/2.0/07). Every meaningful transition — create, draw
 * an eight-card offer, pick, finalize, and AI league generation — flows
 * through one typed command with a `commandId` and the `expectedRevision` of
 * the state it was issued against. Duplicate command ids are idempotent;
 * stale revisions are rejected. Replaying the initial state plus the exact
 * command sequence reproduces every offer, pick, rejection, and the final
 * digest.
 *
 * M2.3.5 (season-draft-v2): the franchise-era reveal/claim commands are
 * removed from the current draft; the payload union keeps them as legacy
 * members so stored season-draft-v1 records (which embed their command logs)
 * continue to parse. The current engine rejects legacy commands with
 * `UNSUPPORTED_COMMAND`.
 */

export const seasonDraftCommandKindSchema = z.enum([
  'create-season-draft',
  'draw-season-offer',
  'select-draft-player',
  'finalize-human-rosters',
  'generate-ai-league',
  // Legacy season-draft-v1 commands (recovery reads only).
  'reveal-draft-roll',
  'claim-draft-pool',
]);
export type SeasonDraftCommandKind = z.infer<typeof seasonDraftCommandKindSchema>;

export const createSeasonDraftPayloadSchema = z.object({
  kind: z.literal('create-season-draft'),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  league: seasonLeagueSchema,
  /** One or two human participants; franchise assignments are seeded. */
  humanParticipantIds: z.array(z.string().min(1).max(64)).min(1).max(2),
  catalogVersion: z.literal(SEASON_DRAFT_VERSION),
});

export const drawSeasonOfferPayloadSchema = z.object({
  kind: z.literal('draw-season-offer'),
  participantId: z.string().min(1).max(64),
});

export const selectDraftPlayerPayloadSchema = z.object({
  kind: z.literal('select-draft-player'),
  participantId: z.string().min(1).max(64),
  playerVersionId: playerVersionIdSchema,
});

export const finalizeHumanRostersPayloadSchema = z.object({
  kind: z.literal('finalize-human-rosters'),
});

export const generateAiLeaguePayloadSchema = z.object({
  kind: z.literal('generate-ai-league'),
});

/** Legacy season-draft-v1 command payloads (stored-record reads only). */
export const revealDraftRollPayloadSchema = z.object({
  kind: z.literal('reveal-draft-roll'),
  participantId: z.string().min(1).max(64),
});

export const claimDraftPoolPayloadSchema = z.object({
  kind: z.literal('claim-draft-pool'),
  participantId: z.string().min(1).max(64),
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
});

export const seasonDraftCommandPayloadSchema = z.discriminatedUnion('kind', [
  createSeasonDraftPayloadSchema,
  drawSeasonOfferPayloadSchema,
  selectDraftPlayerPayloadSchema,
  finalizeHumanRostersPayloadSchema,
  generateAiLeaguePayloadSchema,
  revealDraftRollPayloadSchema,
  claimDraftPoolPayloadSchema,
]);
export type SeasonDraftCommandPayload = z.infer<typeof seasonDraftCommandPayloadSchema>;

export const seasonDraftCommandSchema = z.object({
  commandId: z.string().min(1).max(64),
  /** Revision of the draft state this command was issued against. */
  expectedRevision: z.number().int().nonnegative(),
  payload: seasonDraftCommandPayloadSchema,
});
export type SeasonDraftCommand = z.infer<typeof seasonDraftCommandSchema>;

/** Typed rejection codes; the domain never relaxes a rule to avoid one. */
export const seasonDraftErrorCodeSchema = z.enum([
  'STALE_REVISION',
  'WRONG_TURN',
  'NO_OFFER_DRAWN',
  'NO_FEASIBLE_GLOBAL_OFFER',
  'OWNED_VERSION',
  'ILLEGAL_PICK',
  'UNCOMPLETABLE_ROSTER',
  'INVALID_CATALOG',
  'GENERATION_EXHAUSTED',
  'UNSUPPORTED_COMMAND',
  // Legacy season-draft-v1 rejection code (recovery reads only).
  'UNAVAILABLE_POOL',
]);
export type SeasonDraftErrorCode = z.infer<typeof seasonDraftErrorCodeSchema>;

export const seasonDraftAcceptedRecordSchema = z.object({
  status: z.literal('accepted'),
  commandId: z.string().min(1).max(64),
  revisionBefore: z.number().int().nonnegative(),
  revisionAfter: z.number().int().nonnegative(),
  /** Canonical digest of the full state after this command. */
  stateDigest: seasonCheckpointDigestSchema,
  command: seasonDraftCommandSchema,
});
export type SeasonDraftAcceptedRecord = z.infer<typeof seasonDraftAcceptedRecordSchema>;

export const seasonDraftRejectedRecordSchema = z.object({
  status: z.literal('rejected'),
  commandId: z.string().min(1).max(64),
  /** Rejected commands never change the state or its revision. */
  revision: z.number().int().nonnegative(),
  errorCode: seasonDraftErrorCodeSchema,
  message: z.string().min(1).max(512),
  command: seasonDraftCommandSchema,
});
export type SeasonDraftRejectedRecord = z.infer<typeof seasonDraftRejectedRecordSchema>;

export const seasonDraftCommandRecordSchema = z.discriminatedUnion('status', [
  seasonDraftAcceptedRecordSchema,
  seasonDraftRejectedRecordSchema,
]);
export type SeasonDraftCommandRecord = z.infer<typeof seasonDraftCommandRecordSchema>;
