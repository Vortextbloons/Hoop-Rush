import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, seedSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_DRAFT_LEGACY_VERSION, SEASON_DRAFT_VERSION } from './season-versions.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { seasonDraftCommandRecordSchema } from './season-draft-command.ts';
import { seasonDraftOfferSchema } from './season-draft-offer.ts';

/**
 * Season Run ten-round draft state (spec/2.0/03). One revisioned snapshot
 * carries participants, the snake turn, every drawn eight-card offer, picks,
 * and completion status. The full command log lives beside the state in the
 * persisted record (see season-draft-command). The state is a pure function
 * of (create inputs, seed, command sequence), which makes interrupted and
 * persisted/resumed replays byte-identical.
 *
 * M2.3.5 (season-draft-v2): `seasonDraftStateSchema` describes the global
 * eight-card offer draft. The legacy M2.1-M2.3 franchise-era roll draft is
 * preserved as `seasonDraftLegacyStateSchema` so unfinished v1 drafts can be
 * detected and recovered explicitly; they are never convertible.
 */

/** One human participant and their seeded franchise assignment. */
export const seasonDraftParticipantSchema = z.object({
  participantId: z.string().min(1).max(64),
  franchiseId: franchiseIdSchema,
});
export type SeasonDraftParticipant = z.infer<typeof seasonDraftParticipantSchema>;

/** One accepted selection of a player version (season-draft-v2). */
export const seasonDraftPickSchema = z.object({
  participantId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10),
  pickOrdinal: z.number().int().min(1).max(10),
  playerVersionId: playerVersionIdSchema,
  /** Source franchise and era; presentation facts from the picked card. */
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  /** The seed path of the offer the pick came from (reproduction). */
  seedPath: z.array(z.string()).min(1),
});
export type SeasonDraftPick = z.infer<typeof seasonDraftPickSchema>;

export const seasonDraftStatusSchema = z.enum(['drafting', 'finalized', 'complete']);
export type SeasonDraftStatus = z.infer<typeof seasonDraftStatusSchema>;

/** Current authoritative draft state (season-draft-v2, M2.3.5). */
export const seasonDraftStateSchema = z.object({
  schemaVersion: z.literal(2),
  draftVersion: z.literal(SEASON_DRAFT_VERSION),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  league: seasonLeagueSchema,
  /** Draft catalog artifact version the state was created against. */
  catalogVersion: z.literal(SEASON_DRAFT_VERSION),
  participants: z.array(seasonDraftParticipantSchema).min(1).max(2),
  firstPickParticipantId: z.string().min(1).max(64),
  /** Current snake round; 10 when drafting the final round, else completed. */
  round: z.number().int().min(1).max(10),
  currentTurnParticipantId: z.string().min(1).max(64).nullable(),
  status: seasonDraftStatusSchema,
  /** Incremented by every accepted command; rejected commands do not bump it. */
  revision: z.number().int().nonnegative(),
  /** The current turn's drawn eight-card offer, once drawn. */
  currentOffer: seasonDraftOfferSchema.nullable(),
  /** Every drawn offer, in draw order, for reproduction and audit. */
  offers: z.array(seasonDraftOfferSchema),
  picks: z.array(seasonDraftPickSchema),
  /**
   * Every executed command record (accepted and rejected), in execution
   * order. Full records make duplicate command ids idempotent and replay
   * byte-faithful.
   */
  commandLog: z.array(seasonDraftCommandRecordSchema),
});
export type SeasonDraftState = z.infer<typeof seasonDraftStateSchema>;

// ---------------------------------------------------------------------------
// Legacy season-draft-v1 state (M2.1-M2.3 franchise-era rolls). Read-only
// recovery target: unfinished v1 drafts surface an explicit recovery screen,
// and v1 facts inside completed runs parse through `seasonLegacyDraftFacts`.
// ---------------------------------------------------------------------------

/** One attempted franchise-era roll during a reveal (legacy v1). */
export const seasonDraftRollAttemptSchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  attemptIndex: z.number().int().nonnegative(),
  /** False when the pair held no unowned feasibility-preserving selection. */
  usable: z.boolean(),
});
export type SeasonDraftRollAttempt = z.infer<typeof seasonDraftRollAttemptSchema>;

/** The pool revealed for the current turn after deterministic recovery (legacy v1). */
export const seasonDraftRevealSchema = z.object({
  participantId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10),
  pickOrdinal: z.number().int().min(1).max(10),
  attempts: z.array(seasonDraftRollAttemptSchema).min(1),
});
export type SeasonDraftReveal = z.infer<typeof seasonDraftRevealSchema>;

/** Exact franchise-era pair claimed by a participant (legacy v1). */
export const seasonDraftClaimSchema = z.object({
  participantId: z.string().min(1).max(64),
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
});
export type SeasonDraftClaim = z.infer<typeof seasonDraftClaimSchema>;

/** One accepted selection of a player version (legacy v1). */
export const seasonDraftLegacyPickSchema = z.object({
  participantId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10),
  pickOrdinal: z.number().int().min(1).max(10),
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  /** Number of roll attempts recorded by the reveal that produced the pool. */
  rollAttempts: z.number().int().positive(),
});
export type SeasonDraftLegacyPick = z.infer<typeof seasonDraftLegacyPickSchema>;

/** Legacy season-draft-v1 state (recovery reads only; never written). */
export const seasonDraftLegacyStateSchema = z.object({
  schemaVersion: z.literal(1),
  draftVersion: z.literal(SEASON_DRAFT_LEGACY_VERSION),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  league: seasonLeagueSchema,
  catalogVersion: z.literal(SEASON_DRAFT_LEGACY_VERSION),
  participants: z.array(seasonDraftParticipantSchema).min(1).max(2),
  firstPickParticipantId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10),
  currentTurnParticipantId: z.string().min(1).max(64).nullable(),
  status: seasonDraftStatusSchema,
  revision: z.number().int().nonnegative(),
  currentReveal: seasonDraftRevealSchema.nullable(),
  rolls: z.array(seasonDraftRollAttemptSchema),
  claims: z.array(seasonDraftClaimSchema),
  picks: z.array(seasonDraftLegacyPickSchema),
  commandLog: z.array(seasonDraftCommandRecordSchema),
});
export type SeasonDraftLegacyState = z.infer<typeof seasonDraftLegacyStateSchema>;

/** Discriminated stored draft state: current v2 or legacy v1. */
export const storedSeasonDraftStateSchema = z.discriminatedUnion('schemaVersion', [
  seasonDraftStateSchema,
  seasonDraftLegacyStateSchema,
]);
export type StoredSeasonDraftState = z.infer<typeof storedSeasonDraftStateSchema>;
