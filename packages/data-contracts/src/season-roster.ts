import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seasonKeySchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_ROSTER_MAX_SIZE, SEASON_ROSTER_MIN_SIZE } from './season-versions.ts';

export const seasonRosterEntrySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  seasonKey: seasonKeySchema,
  displayName: z.string().min(1).max(96),
});
export type SeasonRosterEntry = z.infer<typeof seasonRosterEntrySchema>;

export const seasonRosterSchema = z
  .object({
    franchiseId: franchiseIdSchema,
    players: z
      .array(seasonRosterEntrySchema)
      .min(SEASON_ROSTER_MIN_SIZE)
      .max(SEASON_ROSTER_MAX_SIZE),
  })
  .superRefine((roster, ctx) => {
    const versions = new Set<string>();
    for (const player of roster.players) {
      if (versions.has(player.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate roster version ${player.playerVersionId}`,
        });
      }
      versions.add(player.playerVersionId);
    }
  });
export type SeasonRoster = z.infer<typeof seasonRosterSchema>;

export const seasonOwnershipSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  ownerFranchiseId: franchiseIdSchema,
});
export type SeasonOwnership = z.infer<typeof seasonOwnershipSchema>;
