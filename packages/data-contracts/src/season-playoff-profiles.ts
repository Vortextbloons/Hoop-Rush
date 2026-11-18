import { z } from 'zod';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_DRAFT_CATALOG_VERSION } from './season-versions.ts';
import { playoffPerformanceSchema } from './postseason-evidence.ts';
import type { SeasonDraftCatalog } from './season-draft-catalog.ts';

/**
 * Playoff evidence is optional for drafting, so it is packaged separately from
 * the draft catalog and roster details. Both consumers key it by exact player
 * version id; the manifest hash pins the asset itself.
 */
export const seasonPlayoffProfileSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playoffPerformance: playoffPerformanceSchema,
});
export type SeasonPlayoffProfile = z.infer<typeof seasonPlayoffProfileSchema>;

export const seasonPlayoffProfilesSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogVersion: z.literal(SEASON_DRAFT_CATALOG_VERSION),
    dataVersion: z.string().min(1).max(64),
    profiles: z.array(seasonPlayoffProfileSchema).min(1),
  })
  .superRefine((artifact, context) => {
    const seen = new Set<string>();
    for (const profile of artifact.profiles) {
      if (seen.has(profile.playerVersionId)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate playoff profile ${profile.playerVersionId}`,
        });
      }
      seen.add(profile.playerVersionId);
    }
  });
export type SeasonPlayoffProfiles = z.infer<typeof seasonPlayoffProfilesSchema>;

/**
 * Returns a catalog whose candidates carry their pinned playoff evidence. The
 * source catalog is left untouched so cached indexes keep their identity; the
 * merged object is only used where lock/playoff inputs are built.
 */
export function applySeasonPlayoffProfiles(
  catalog: SeasonDraftCatalog,
  profiles: SeasonPlayoffProfiles,
): SeasonDraftCatalog {
  if (
    (profiles.catalogVersion as string) !== (catalog.catalogVersion as string) ||
    profiles.dataVersion !== catalog.dataVersion
  ) {
    throw new Error(
      `playoff profiles ${profiles.catalogVersion}/${profiles.dataVersion} do not match catalog ${catalog.catalogVersion}/${catalog.dataVersion}`,
    );
  }
  const byVersion = new Map(
    profiles.profiles.map((profile) => [profile.playerVersionId, profile.playoffPerformance]),
  );
  if (byVersion.size === 0) return catalog;
  return {
    ...catalog,
    candidates: catalog.candidates.map((candidate) => {
      const playoffPerformance = byVersion.get(candidate.playerVersionId);
      return playoffPerformance === undefined ? candidate : { ...candidate, playoffPerformance };
    }),
  };
}
