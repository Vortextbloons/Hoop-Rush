import { z } from 'zod';
import { franchiseIdSchema, seasonKeySchema, teamExternalIdSchema } from './ids.js';

/**
 * Franchise lineage is the authoritative identity spine. One franchiseId spans
 * relocations and renames (e.g. Minneapolis Lakers -> Los Angeles Lakers) and
 * is separate from display names and logos.
 */

export const franchiseNameSchema = z.object({
  name: z.string().min(1).max(64),
  fromSeasonKey: seasonKeySchema.nullable(),
  toSeasonKey: seasonKeySchema.nullable(),
});
export type FranchiseName = z.infer<typeof franchiseNameSchema>;

export const franchiseLineageEntrySchema = z.object({
  franchiseId: franchiseIdSchema,
  /** Current display name for the franchise. */
  displayName: z.string().min(1).max(64),
  /** NBA API team ID used to resolve logos and external records. */
  teamExternalId: teamExternalIdSchema,
  /** First NBA season of this franchise; earlier eras are unavailable. */
  firstNbaSeasonKey: seasonKeySchema.optional(),
  /** Known franchise identity history, oldest first. Ranges may leave gaps. */
  names: z.array(franchiseNameSchema).min(1),
});
export type FranchiseLineageEntry = z.infer<typeof franchiseLineageEntrySchema>;

export const franchiseLineageSchema = z.array(franchiseLineageEntrySchema);
export type FranchiseLineage = z.infer<typeof franchiseLineageSchema>;
