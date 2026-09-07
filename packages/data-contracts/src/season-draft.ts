import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_DRAFT_VERSION } from './season-versions.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { seasonDraftCommandRecordSchema } from './season-draft-command.ts';
import { seasonFrontOfficeIdSchema } from './season-evolution.ts';
import { SEASON_FRONT_OFFICE_VERSION } from './season-versions.ts';
import { seasonDraftOfferSchema } from './season-draft-offer.ts';
export const seasonDraftParticipantSchema = z.object({
  participantId: z.string().min(1).max(64),
  franchiseId: franchiseIdSchema,
});
export type SeasonDraftParticipant = z.infer<typeof seasonDraftParticipantSchema>;
export const seasonDraftPickSchema = z.object({
  participantId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10),
  pickOrdinal: z.number().int().min(1).max(10),
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  seedPath: z.array(z.string()).min(1),
});
export type SeasonDraftPick = z.infer<typeof seasonDraftPickSchema>;
export const seasonDraftStatusSchema = z.enum(['drafting', 'finalized', 'complete']);
export type SeasonDraftStatus = z.infer<typeof seasonDraftStatusSchema>;
export const seasonDraftStateSchema = z.object({
  schemaVersion: z.literal(2),
  draftVersion: z.literal(SEASON_DRAFT_VERSION),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  league: seasonLeagueSchema,
  catalogVersion: z.literal(SEASON_DRAFT_VERSION),
  participants: z.array(seasonDraftParticipantSchema).min(1).max(2),
  firstPickParticipantId: z.string().min(1).max(64),
  round: z.number().int().min(1).max(10),
  currentTurnParticipantId: z.string().min(1).max(64).nullable(),
  status: seasonDraftStatusSchema,
  revision: z.number().int().nonnegative(),
  currentOffer: seasonDraftOfferSchema.nullable(),
  offers: z.array(seasonDraftOfferSchema),
  picks: z.array(seasonDraftPickSchema),
  commandLog: z.array(seasonDraftCommandRecordSchema),
  frontOffice: z
    .object({
      executiveId: seasonFrontOfficeIdSchema,
      version: z.literal(SEASON_FRONT_OFFICE_VERSION),
      selectedByCommandId: z.string().min(1).max(64),
    })
    .nullable()
    .optional(),
});
export type SeasonDraftState = z.infer<typeof seasonDraftStateSchema>;
export const storedSeasonDraftStateSchema = seasonDraftStateSchema;
export type StoredSeasonDraftState = z.infer<typeof storedSeasonDraftStateSchema>;
