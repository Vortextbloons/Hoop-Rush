import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seasonKeySchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_ROSTER_SIZE } from './season-versions.ts';

/**
 * Season Run roster and ownership contracts (spec/2.0/03, spec/2.0/07).
 * Ownership is keyed exclusively by `playerVersionId`, so two different
 * versions of the same person are distinct claims while every roster stays
 * deterministic. Shared by the run snapshot, the draft catalog, and the AI
 * league generation result.
 */

export const seasonRosterEntrySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  seasonKey: seasonKeySchema,
  displayName: z.string().min(1).max(96),
});
export type SeasonRosterEntry = z.infer<typeof seasonRosterEntrySchema>;

export const seasonRosterSchema = z.object({
  franchiseId: franchiseIdSchema,
  players: z.array(seasonRosterEntrySchema).length(SEASON_ROSTER_SIZE),
});
export type SeasonRoster = z.infer<typeof seasonRosterSchema>;

export const seasonOwnershipSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  ownerFranchiseId: franchiseIdSchema,
});
export type SeasonOwnership = z.infer<typeof seasonOwnershipSchema>;
