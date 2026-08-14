import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seasonKeySchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_ROSTER_MAX_SIZE, SEASON_ROSTER_MIN_SIZE } from './season-versions.ts';

/**
 * Season Run roster and ownership contracts (spec/2.0/03, spec/2.0/07,
 * spec/2.0/15 M2.6.5). Ownership is keyed exclusively by `playerVersionId`,
 * so two different versions of the same person are distinct claims while
 * every roster stays deterministic. Shared by the run snapshot, the draft
 * catalog, and the AI league generation result.
 *
 * season-roster-v2 (M2.6.5): a roster contains 10-15 distinct
 * player-season versions; coverage, legal-five, contingency, minutes,
 * closing-five, availability, and game validation apply to its
 * exactly-ten-member rotation (`SEASON_ROTATION_SIZE`). Drafts and AI
 * generation still produce exactly `SEASON_DRAFT_SIZE` players. Ownership
 * is by version, so two historical versions of the same person may share
 * a roster.
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

/**
 * One franchise roster with 10-15 distinct versions. Rotation legality is
 * an engine invariant; the schema refines distinct-version and capacity
 * facts. Same-person versions (`playerId` repeats, `playerVersionId` does
 * not) are legal.
 */
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
